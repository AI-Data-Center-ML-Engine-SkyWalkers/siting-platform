"""Endpoints for the ML team: community features per county, to train on or to join at scoring time."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_session
from .deps import get_pipeline

router = APIRouter(prefix="/api/integration", tags=["integration"])

FEATURE_DOCS = {
    "opposition_index": "0-1. Weighted, time-decayed opposition in local coverage.",
    "support_index": "0-1. Same for support.",
    "net_sentiment": "-1 to 1. (support - opposition) / (support + opposition + 1), shrunk toward the state when coverage is thin.",
    "incentive_signal": "0-1. Tax incentives proposed or in place (county or its state).",
    "restriction_signal": "0-1. Moratoria, restrictions or opposing bills.",
    "active_moratorium": "true when an official or established source reports a moratorium within the last year.",
    "momentum": "-1 to 1. Opposition in the last 30 days versus the 60 days before.",
    "coverage": "Number of relevant items behind the numbers.",
    "confidence": "0-1. coverage / (coverage + 3). Multiply sentiment by this before using it.",
}


@router.get("/community-features")
def community_features(
    request: Request,
    fips: list[str] = Query(default_factory=list, description="Repeat for several counties"),
    session: Session = Depends(get_session),
):
    """Features for the given counties, or for every county with coverage when none are given.
    Counties without their own coverage inherit their state's signals at reduced confidence."""
    store = get_pipeline(request).features
    if fips:
        features = {f: store.for_fips(session, f).as_dict() for f in fips}
    else:
        counties, _ = store.compute(session)
        features = {k: v.as_dict() for k, v in counties.items()}
    return {"half_life_days": settings.half_life_days, "fields": FEATURE_DOCS, "features": features}
