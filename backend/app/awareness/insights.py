"""Plain-language pros and cons of a region for site planners, built from features and items."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..models import Analysis, Item
from .alerts import region_label
from .analyze import TOPIC_LABELS
from .features import FeatureStore, RegionFeatures
from .geo import ABBR_TO_NAME
from .geo import county as county_info


def describe_level(value: float) -> str:
    return "high" if value >= 0.6 else "moderate" if value >= 0.3 else "low"


def region_items(session: Session, state: str | None, fips: str | None, limit: int = 200) -> list[Item]:
    query = select(Item).join(Analysis).options(joinedload(Item.analysis)).where(Analysis.relevant.is_(True))
    if fips:
        query = query.where(Item.county_fips == fips)
    elif state:
        query = query.where(Item.state == state)
    return list(session.scalars(query.order_by(Item.published_at.desc()).limit(limit)).unique().all())


def pros_cons(features: RegionFeatures, items: list[Item]) -> tuple[list[dict], list[dict]]:
    pros, cons = [], []
    for topic, weight in features.concerns[:3]:
        n = sum(1 for i in items if topic in i.analysis.topics and i.analysis.stance in ("oppose", "mixed"))
        cons.append({"text": f"Community concern: {TOPIC_LABELS.get(topic, topic).lower()}", "detail": f"{n} item(s) raise it", "weight": round(weight, 3)})
    for topic, weight in features.positives[:3]:
        n = sum(1 for i in items if topic in i.analysis.topics and i.analysis.stance in ("support", "mixed"))
        pros.append({"text": f"Local support around {TOPIC_LABELS.get(topic, topic).lower()}", "detail": f"{n} item(s)", "weight": round(weight, 3)})
    if features.incentive_signal >= 0.2:
        bills = [i for i in items if i.analysis.event_type in ("incentive", "bill_introduced", "bill_advanced", "bill_passed") and "tax_breaks" in i.analysis.topics]
        pros.insert(0, {"text": "Tax incentives proposed or in place", "detail": ", ".join((b.extra or {}).get("bill_number") or b.title[:40] for b in bills[:3]) or "see items", "weight": round(features.incentive_signal, 3)})
    if features.active_moratorium:
        cons.insert(0, {"text": "Active moratorium on new data centers", "detail": "from an official or established news source", "weight": 1.0})
    elif features.restriction_signal >= 0.2:
        cons.insert(0, {"text": "Restrictions proposed or in place", "detail": "bills, ordinances or zoning limits", "weight": round(features.restriction_signal, 3)})
    if features.momentum >= 0.4:
        cons.append({"text": "Opposition is growing", "detail": "more opposing items in the last 30 days than before", "weight": round(features.momentum, 3)})
    return pros, cons


def upcoming_events(items: list[Item]) -> list[dict]:
    today = date.today().isoformat()
    events = []
    for i in items:
        d = (i.analysis.entities or {}).get("event_date")
        if d and d >= today and i.analysis.event_type in ("public_hearing", "protest", "zoning_decision", "bill_advanced"):
            events.append({"date": d, "event_type": i.analysis.event_type, "summary": i.analysis.summary, "item_id": i.id, "url": i.url})
    return sorted(events, key=lambda e: e["date"])[:10]


def region_summary(session: Session, store: FeatureStore, state: str | None = None, fips: str | None = None) -> dict:
    counties, states = store.compute(session)
    if fips:
        features = store.for_fips(session, fips)
        info = county_info(fips)
        name = region_label(None, fips) if info else fips
        state = info.state if info else state
    else:
        features = states.get(state or "") or RegionFeatures(region=state or "", level="state")
        name = ABBR_TO_NAME.get(state or "", state or "")
    items = region_items(session, state, fips)
    pros, cons = pros_cons(features, items)
    stance_counts = {s: sum(1 for i in items if i.analysis.stance == s) for s in ("support", "oppose", "neutral", "mixed")}
    if features.coverage == 0 and not items:
        headline = f"No community signals collected for {name} yet."
    else:
        headline = (
            f"Opposition is {describe_level(features.opposition_index)} and support is {describe_level(features.support_index)} "
            f"in {name}, based on {features.coverage or len(items)} items."
        )
    return {
        "region": fips or state,
        "name": name,
        "level": "county" if fips else "state",
        "headline": headline,
        "features": features.as_dict(),
        "stance_counts": stance_counts,
        "pros": pros,
        "cons": cons,
        "upcoming": upcoming_events(items),
        "policies": [
            {"item_id": i.id, "title": i.title, "status": (i.extra or {}).get("latest_action"), "date": (i.extra or {}).get("latest_action_date"), "url": i.url, "stance": i.analysis.stance}
            for i in items if i.source_type == "legislation"
        ][:10],
        "recent_item_ids": [i.id for i in items[:20]],
    }
