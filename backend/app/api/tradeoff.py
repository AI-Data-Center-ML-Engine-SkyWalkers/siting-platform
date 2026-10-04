"""Trade-off engine API (step 4)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_session
from ..scoring.rerank import rerank
from ..tradeoff.engine import PRESETS, TradeoffParams, evaluate
from .deps import betas, community_lookup, get_pipeline, get_scoring

router = APIRouter(prefix="/api/tradeoff", tags=["tradeoff"])


class EvaluateBody(BaseModel):
    params: TradeoffParams = TradeoffParams()
    use_community: bool = True


@router.get("/presets")
def presets():
    return {"presets": {name: p.model_dump() for name, p in PRESETS.items()}}


@router.post("/evaluate")
async def evaluate_route(body: EvaluateBody, request: Request, session: Session = Depends(get_session)):
    scoring = get_scoring(request)
    try:
        ranked = await scoring.candidates()
    except Exception as exc:
        raise HTTPException(502, f"Scoring provider '{scoring.name}' failed: {exc}")
    lookup = community_lookup(get_pipeline(request), session, scoring)
    if body.use_community:
        adjusted = {s.site_id: s for s in rerank(ranked.sites, lookup, betas())}
        sites = [adjusted[s.site_id].model_dump() if s.site_id in adjusted else s.model_dump() for s in ranked.sites]
    else:
        sites = [s.model_dump() for s in ranked.sites]
    by_id = {s.site_id: s for s in ranked.sites}

    def community_for(fips, site_dict):
        site = by_id.get(site_dict["site_id"])
        return lookup(fips, site).as_dict() if fips else {}

    result = evaluate(sites, community_for, body.params)
    result["illustrative"] = ranked.illustrative
    result["model_version"] = ranked.model_version
    return result
