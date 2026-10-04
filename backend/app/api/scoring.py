"""Scoring API (steps 2 and 3): the ML model's ranking, optionally re-ranked with community signals."""
from __future__ import annotations

import inspect

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..awareness.insights import region_summary
from ..db import get_session
from ..scoring.rerank import rerank
from ..scoring.sample_sites import FACTORS, PILLARS
from ..scoring.schemas import RerankResponse
from ..models import Item
from .deps import betas, community_lookup, get_pipeline, get_scoring, item_to_dict

router = APIRouter(prefix="/api/scoring", tags=["scoring"])


class RankBody(BaseModel):
    n: int = Field(10, ge=1, le=300)
    weights: dict[str, float] | None = None
    community: bool = True


@router.get("/meta")
async def meta(request: Request):
    scoring = get_scoring(request)
    provider_meta = getattr(scoring, "meta", None)
    if provider_meta is not None:
        try:
            m = await provider_meta() if inspect.iscoroutinefunction(provider_meta) else provider_meta()
        except Exception as exc:
            raise HTTPException(502, f"Scoring provider '{scoring.name}' meta failed: {exc}")
        return {
            "provider": scoring.name,
            "model_version": m.get("model_version"),
            "pillars": m.get("pillars", []),
            "presets": m.get("presets", []),
            "factors": m.get("factors", []),
            "metrics": m.get("metrics", []),
            "betas": betas(),
        }
    return {
        "provider": scoring.name,
        "pillars": [{"id": k, "label": v} for k, v in PILLARS.items()],
        "factors": [{"id": f[0], "pillar": f[1], "label": f[2], "better": f[3], "unit": f[4]} for f in FACTORS],
        "betas": betas(),
    }


async def _rank(request: Request, session: Session, n: int, weights: dict | None, community: bool):
    scoring = get_scoring(request)
    try:
        ranked = await scoring.candidates(weights) if community else await scoring.rank(n, weights)
    except Exception as exc:
        raise HTTPException(502, f"Scoring provider '{scoring.name}' failed: {exc}")
    if not community:
        return ranked.model_dump()
    lookup = community_lookup(get_pipeline(request), session, scoring)
    sites = rerank(ranked.sites, lookup, betas())[:n]
    return RerankResponse(model_version=ranked.model_version, illustrative=ranked.illustrative, betas=betas(), sites=sites).model_dump()


@router.get("/top")
async def top(
    request: Request,
    n: int = Query(10, ge=1, le=300),
    community: bool = True,
    session: Session = Depends(get_session),
):
    """Top-n sites. With community=true, re-ranked with awareness signals (step 3)."""
    return await _rank(request, session, n, None, community)


@router.post("/rank")
async def rank(body: RankBody, request: Request, session: Session = Depends(get_session)):
    """Same as /top but accepts pillar weights from the frontend sliders."""
    return await _rank(request, session, body.n, body.weights, body.community)


@router.get("/sites/{site_id}")
async def site(site_id: str, request: Request, session: Session = Depends(get_session)):
    scoring = get_scoring(request)
    s = await scoring.site(site_id)
    if not s:
        raise HTTPException(404, "Site not found")
    lookup = community_lookup(get_pipeline(request), session, scoring)
    community = lookup(s.county_fips, s).as_dict() if s.county_fips else None
    pulse = region_summary(session, get_pipeline(request).features, fips=s.county_fips) if s.county_fips else None
    if pulse:
        ids = pulse.pop("recent_item_ids", [])[:5]
        items = {i.id: i for i in session.scalars(select(Item).where(Item.id.in_(ids))).all()} if ids else {}
        pulse["recent"] = [item_to_dict(items[i]) for i in ids if i in items]
    return {"site": s.model_dump(), "community": community, "pulse": pulse}
