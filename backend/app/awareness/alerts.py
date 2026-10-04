"""Real-time alerts: event alerts from new analyses, sentiment-shift alerts from daily snapshots,
watchlist matching, a live broker for the app (server-sent events) and Slack/Discord webhooks."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Alert, AlertRule, Item, RegionSnapshot
from .base import log
from .geo import county as county_info
from .geo import state_name

# event_type -> (alert kind, label shown to people)
EVENT_ALERTS = {
    "moratorium": ("moratorium", "Moratorium"),
    "restriction": ("restriction", "New restriction"),
    "incentive": ("incentive", "Incentive"),
    "bill_introduced": ("bill", "Bill introduced"),
    "bill_advanced": ("bill", "Bill advancing"),
    "bill_passed": ("policy_change", "Law passed"),
    "public_hearing": ("hearing", "Public hearing"),
    "zoning_decision": ("zoning", "Zoning decision"),
    "protest": ("protest", "Protest"),
    "lawsuit": ("lawsuit", "Lawsuit"),
    "project_canceled": ("project_canceled", "Project canceled"),
}


class AlertBroker:
    """Fan-out of new alerts to every open browser tab."""

    def __init__(self):
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def publish(self, payload: dict) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                pass


broker = AlertBroker()


def region_label(state: str | None, fips: str | None) -> str:
    info = county_info(fips)
    if info:
        suffix = "" if info.name.endswith(("Parish", "Borough", "Area")) else " County"
        return f"{info.name}{suffix}, {info.state}"
    return state_name(state) or "United States"


def alert_to_dict(alert: Alert) -> dict:
    return {
        "id": alert.id,
        "created_at": alert.created_at.isoformat(),
        "kind": alert.kind,
        "severity": alert.severity,
        "title": alert.title,
        "body": alert.body,
        "state": alert.state,
        "county_fips": alert.county_fips,
        "region": region_label(alert.state, alert.county_fips),
        "item_ids": alert.item_ids,
    }


def _save(session: Session, alert: Alert) -> Alert | None:
    try:
        with session.begin_nested():
            session.add(alert)
            session.flush()
        return alert
    except IntegrityError:  # same dedupe_key already alerted
        return None


def event_alerts(session: Session, item_ids: list[int]) -> list[Alert]:
    created = []
    for item in session.scalars(select(Item).where(Item.id.in_(item_ids))).all():
        a = item.analysis
        if not a or not a.relevant or a.event_type not in EVENT_ALERTS:
            continue
        official = item.source_type in ("legislation", "government")
        if a.severity < 3 and not official:
            continue
        if item.source_type == "social":
            continue  # single posts never raise event alerts; they count toward sentiment-shift alerts instead
        kind, label = EVENT_ALERTS[a.event_type]
        where = region_label(item.state, item.county_fips)
        version = item.version_key or ""
        alert = Alert(
            kind=kind,
            severity=a.severity,
            title=f"{label} in {where}",
            body=f"{a.summary} Source: {item.outlet or item.source}.",
            state=item.state,
            county_fips=item.county_fips,
            item_ids=[item.id],
            dedupe_key=f"event:{item.cluster_id or item.id}:{kind}:{version}"[:200],
        )
        if _save(session, alert):
            created.append(alert)
    return created


def sentiment_alerts(session: Session, county_features: dict, state_features: dict) -> list[Alert]:
    """Snapshot today's indices and alert when opposition jumps above the 90-day baseline."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    since = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")
    created = []
    for region, f in list(county_features.items()) + list(state_features.items()):
        history = session.scalars(
            select(RegionSnapshot).where(RegionSnapshot.region == region, RegionSnapshot.day >= since, RegionSnapshot.day < today)
        ).all()
        snap = session.scalar(select(RegionSnapshot).where(RegionSnapshot.region == region, RegionSnapshot.day == today))
        if snap is None:
            snap = RegionSnapshot(region=region, day=today)
            session.add(snap)
        snap.opposition, snap.support, snap.net, snap.coverage = f.opposition_index, f.support_index, f.net_sentiment, f.coverage
        if f.coverage < 3:
            continue
        is_county = f.level == "county"
        where = region_label(None if is_county else region, region if is_county else None)
        week = datetime.now(timezone.utc).strftime("%G-W%V")
        if len(history) >= 7:
            baseline = sum(h.opposition for h in history) / len(history)
            if f.opposition_index - baseline >= 0.2:
                alert = Alert(
                    kind="sentiment_shift",
                    severity=4 if f.opposition_index - baseline >= 0.35 else 3,
                    title=f"Opposition rising in {where}",
                    body=f"Opposition index {f.opposition_index:.2f}, up from a 90-day average of {baseline:.2f}, across {f.coverage} recent items.",
                    state=None if is_county else region,
                    county_fips=region if is_county else None,
                    item_ids=f.item_ids[:5],
                    dedupe_key=f"shift:{region}:{week}",
                )
                if _save(session, alert):
                    created.append(alert)
        elif f.opposition_index >= 0.6 and f.coverage >= 5:
            alert = Alert(
                kind="sentiment_shift",
                severity=3,
                title=f"Strong opposition in {where}",
                body=f"Opposition index {f.opposition_index:.2f} across {f.coverage} items. No 90-day baseline yet.",
                state=None if is_county else region,
                county_fips=region if is_county else None,
                item_ids=f.item_ids[:5],
                dedupe_key=f"high:{region}:{week}",
            )
            if _save(session, alert):
                created.append(alert)
    return created


def matching_rules(session: Session, alert: Alert, topics: list[str] | None = None) -> list[AlertRule]:
    out = []
    for rule in session.scalars(select(AlertRule).where(AlertRule.active.is_(True))).all():
        if alert.severity < rule.min_severity:
            continue
        if rule.kinds and alert.kind not in rule.kinds:
            continue
        if rule.states and alert.state not in rule.states and not (
            alert.county_fips and county_info(alert.county_fips) and county_info(alert.county_fips).state in rule.states
        ):
            continue
        if rule.county_fips and alert.county_fips not in rule.county_fips:
            continue
        if rule.topics and not set(rule.topics) & set(topics or []):
            continue
        out.append(rule)
    return out


async def dispatch(session: Session, alerts: list[Alert], default_webhook: str | None) -> None:
    if not alerts:
        return
    async with httpx.AsyncClient(timeout=10) as client:
        for alert in alerts:
            topics = []
            if alert.item_ids:
                item = session.get(Item, alert.item_ids[0])
                topics = item.analysis.topics if item and item.analysis else []
            rules = matching_rules(session, alert, topics)
            alert.rule_ids = [r.id for r in rules]
            payload = alert_to_dict(alert)
            broker.publish(payload)
            hooks = {r.webhook_url for r in rules if r.webhook_url}
            if default_webhook:
                hooks.add(default_webhook)
            text = f"*{alert.title}*\n{alert.body}"
            for url in hooks:
                try:  # Slack uses "text", Discord uses "content"
                    await client.post(url, json={"text": text, "content": text})
                except httpx.HTTPError as exc:
                    log.warning("webhook failed: %s", exc)
    session.commit()
