"""Shared dependencies for the routers."""
from __future__ import annotations

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..awareness.analyze import TOPIC_LABELS
from ..awareness.alerts import region_label
from ..awareness.features import RegionFeatures
from ..awareness.geo import coords_for
from ..config import settings
from ..models import Item


def get_pipeline(request: Request):
    return request.app.state.pipeline


def get_scoring(request: Request):
    return request.app.state.scoring


def betas() -> dict[str, float]:
    return {
        "sentiment": settings.rerank_beta_sentiment,
        "incentive": settings.rerank_beta_incentive,
        "restriction": settings.rerank_beta_restriction,
    }


def community_lookup(pipeline, session: Session, scoring):
    """Returns fips -> RegionFeatures. With the mock scoring provider and no collected signals,
    falls back to the sample site's illustrative hint, clearly flagged."""
    illustrative_ok = getattr(scoring, "name", "") == "mock"

    def lookup(fips: str | None, site=None) -> RegionFeatures:
        f = pipeline.features.for_fips(session, fips) if fips else RegionFeatures(region="", level="county")
        if f.coverage == 0 and f.confidence == 0 and illustrative_ok and site is not None:
            attrs = site.attributes if hasattr(site, "attributes") else site.get("attributes", {})
            hint = float((attrs or {}).get("community_hint") or 0)
            return RegionFeatures(
                region=fips or "", level="county", net_sentiment=hint, opposition_index=max(0.0, -hint),
                support_index=max(0.0, hint), confidence=0.6, illustrative=True,
            )
        return f

    return lookup


def item_to_dict(item: Item, corroborated: bool = False, score: float | None = None) -> dict:
    a = item.analysis
    is_social = item.source_type == "social"
    lat, lon = coords_for(item.state, item.county_fips)
    return {
        "id": item.id,
        "source": item.source,
        "source_type": item.source_type,
        "url": item.url,
        "title": item.title or (item.text[:120] + ("..." if len(item.text) > 120 else "")),
        "excerpt": (item.text or "")[:400],
        "outlet": item.outlet,
        "author": None if is_social else item.author,  # we do not surface individual social users
        "published_at": item.published_at.isoformat() if item.published_at else None,
        "state": item.state,
        "county_fips": item.county_fips,
        "region": region_label(item.state, item.county_fips) if (item.state or item.county_fips) else None,
        "lat": lat,
        "lon": lon,
        "credibility": item.credibility,
        "cluster_id": item.cluster_id,
        "corroborated": corroborated,
        "bill": {k: (item.extra or {}).get(k) for k in ("bill_number", "latest_action", "latest_action_date")} if item.source_type == "legislation" else None,
        "score": round(score, 4) if score is not None else None,
        "analysis": None if a is None else {
            "provider": a.provider,
            "model": a.model,
            "relevant": a.relevant,
            "stance": a.stance,
            "topics": a.topics,
            "topic_labels": [TOPIC_LABELS.get(t, t) for t in a.topics],
            "event_type": a.event_type,
            "severity": a.severity,
            "summary": a.summary,
            "evidence": a.evidence,
            "evidence_verified": a.evidence_verified,
            "confidence": a.confidence,
            "entities": a.entities,
        },
    }


def corroborated_clusters(session: Session, cluster_ids: list[int]) -> set[int]:
    if not cluster_ids:
        return set()
    rows = session.execute(
        select(Item.cluster_id, func.count(func.distinct(Item.outlet)))
        .where(Item.cluster_id.in_(cluster_ids))
        .group_by(Item.cluster_id)
    ).all()
    return {cid for cid, n in rows if n >= 2}


OPPOSE_EVENTS = {"moratorium", "restriction", "lawsuit", "protest", "project_canceled"}
SUPPORT_EVENTS = {"incentive", "project_approved", "project_announced"}


def event_tone(event_type: str, stance: str) -> str:
    """Map color group for an event: against, for, watch (process steps) or info."""
    if event_type in OPPOSE_EVENTS or (stance == "oppose" and event_type != "other"):
        return "against"
    if event_type in SUPPORT_EVENTS or stance == "support":
        return "for"
    if event_type in {"public_hearing", "zoning_decision", "bill_introduced", "bill_advanced", "bill_passed"}:
        return "watch"
    return "info"
