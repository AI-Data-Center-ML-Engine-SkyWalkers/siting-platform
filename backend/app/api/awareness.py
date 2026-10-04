"""Awareness engine API: search, region pulse, alerts (live), watchlists and pipeline control."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..awareness.alerts import alert_to_dict, broker, region_label
from ..awareness.analyze import TOPIC_LABELS
from ..awareness.geo import ABBR_TO_NAME, ABBR_TO_FIPS, county as county_info
from ..awareness.insights import region_summary
from ..awareness.search import SearchFilters, keyword_search, semantic_search
from ..db import get_session
from ..models import Alert, AlertRule, Item
from .deps import corroborated_clusters, get_pipeline, item_to_dict

router = APIRouter(prefix="/api/awareness", tags=["awareness"])

STATE_CENTROIDS = {  # for state-level bubbles on the map
    "AL": (32.8, -86.8), "AK": (64.2, -149.5), "AZ": (34.3, -111.7), "AR": (34.9, -92.4), "CA": (37.2, -119.5),
    "CO": (39.0, -105.5), "CT": (41.6, -72.7), "DE": (39.0, -75.5), "DC": (38.9, -77.0), "FL": (28.6, -82.4),
    "GA": (32.7, -83.4), "HI": (20.8, -156.3), "ID": (44.4, -114.6), "IL": (40.0, -89.2), "IN": (39.9, -86.3),
    "IA": (42.1, -93.5), "KS": (38.5, -98.4), "KY": (37.5, -85.3), "LA": (31.1, -92.0), "ME": (45.4, -69.2),
    "MD": (39.0, -76.8), "MA": (42.3, -71.8), "MI": (44.3, -85.4), "MN": (46.3, -94.3), "MS": (32.7, -89.7),
    "MO": (38.4, -92.5), "MT": (47.0, -109.6), "NE": (41.5, -99.8), "NV": (39.3, -116.6), "NH": (43.7, -71.6),
    "NJ": (40.2, -74.7), "NM": (34.4, -106.1), "NY": (42.9, -75.5), "NC": (35.6, -79.4), "ND": (47.5, -100.5),
    "OH": (40.3, -82.8), "OK": (35.6, -97.5), "OR": (43.9, -120.6), "PA": (40.9, -77.8), "RI": (41.7, -71.5),
    "SC": (33.9, -80.9), "SD": (44.4, -100.2), "TN": (35.9, -86.4), "TX": (31.5, -99.3), "UT": (39.3, -111.7),
    "VT": (44.1, -72.7), "VA": (37.5, -78.9), "WA": (47.4, -120.5), "WV": (38.6, -80.6), "WI": (44.6, -89.9),
    "WY": (43.0, -107.6), "PR": (18.2, -66.5),
}


@router.get("/topics")
def topics():
    return {"topics": [{"id": k, "label": v} for k, v in TOPIC_LABELS.items()]}


@router.get("/search")
async def search(
    request: Request,
    q: str | None = None,
    semantic: bool = True,
    state: str | None = None,
    county: str | None = Query(None, description="5-digit county FIPS"),
    stance: str | None = None,
    topic: str | None = None,
    event_type: str | None = None,
    source_type: str | None = None,
    days: int | None = Query(None, ge=1, le=3650),
    min_severity: int | None = Query(None, ge=1, le=5),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    session: Session = Depends(get_session),
):
    pipeline = get_pipeline(request)
    filters = SearchFilters(
        state=state, county_fips=county, stance=stance, topic=topic, event_type=event_type, source_type=source_type,
        since=datetime.now(timezone.utc) - timedelta(days=days) if days else None, min_severity=min_severity,
    )
    mode = "recent"
    scored: list[tuple[Item, float | None]]
    if q and semantic:
        try:
            vector = (await pipeline.embedder.aembed([q], "query"))[0]
            pairs, total = semantic_search(session, vector, pipeline.embedder.name, filters, page, size)
            scored, mode = [(i, s) for i, s in pairs], "semantic"
        except Exception:
            items, total = keyword_search(session, q, filters, page, size)
            scored, mode = [(i, None) for i in items], "keyword"
        if not scored and page == 1:  # nothing embedded yet: fall back to keywords
            items, total = keyword_search(session, q, filters, page, size)
            scored, mode = [(i, None) for i in items], "keyword"
    else:
        items, total = keyword_search(session, q, filters, page, size)
        scored, mode = [(i, None) for i in items], "keyword" if q else "recent"
    confirmed = corroborated_clusters(session, [i.cluster_id for i, _ in scored if i.cluster_id])
    return {
        "mode": mode,
        "total": total,
        "page": page,
        "size": size,
        "results": [item_to_dict(i, i.cluster_id in confirmed, s) for i, s in scored],
    }


@router.get("/items/{item_id}")
def get_item(item_id: int, session: Session = Depends(get_session)):
    item = session.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    confirmed = corroborated_clusters(session, [item.cluster_id] if item.cluster_id else [])
    related = session.scalars(
        select(Item).where(Item.cluster_id == item.cluster_id, Item.id != item.id).limit(10)
    ).all() if item.cluster_id else []
    data = item_to_dict(item, item.cluster_id in confirmed)
    data["text"] = item.text
    data["related"] = [{"id": r.id, "title": r.title, "outlet": r.outlet, "url": r.url} for r in related]
    return data


@router.get("/regions/{region}")
def region(region: str, request: Request, session: Session = Depends(get_session)):
    pipeline = get_pipeline(request)
    if len(region) == 5 and region.isdigit():
        if not county_info(region):
            raise HTTPException(404, "Unknown county FIPS")
        summary = region_summary(session, pipeline.features, fips=region)
    elif region.upper() in ABBR_TO_FIPS:
        summary = region_summary(session, pipeline.features, state=region.upper())
    else:
        raise HTTPException(400, "Use a 2-letter state code or a 5-digit county FIPS")
    ids = summary.pop("recent_item_ids")
    items = session.scalars(select(Item).where(Item.id.in_(ids))).all() if ids else []
    order = {i: n for n, i in enumerate(ids)}
    summary["recent"] = [item_to_dict(i) for i in sorted(items, key=lambda i: order[i.id])]
    return summary


@router.get("/map")
def map_layer(request: Request, level: str = "state", session: Session = Depends(get_session)):
    """Community indices per state or county, with coordinates, for the map."""
    pipeline = get_pipeline(request)
    counties, states = pipeline.features.compute(session)
    rows = []
    if level == "county":
        for fips, f in counties.items():
            info = county_info(fips)
            if info:
                rows.append({**f.as_dict(), "name": region_label(None, fips), "lat": info.lat, "lon": info.lon})
    else:
        for st, f in states.items():
            lat, lon = STATE_CENTROIDS.get(st, (None, None))
            if lat is not None:
                rows.append({**f.as_dict(), "name": ABBR_TO_NAME.get(st, st), "lat": lat, "lon": lon})
    return {"level": level, "regions": rows}


@router.get("/alerts")
def list_alerts(
    limit: int = Query(50, ge=1, le=500),
    after_id: int | None = None,
    state: str | None = None,
    kind: str | None = None,
    session: Session = Depends(get_session),
):
    query = select(Alert).order_by(Alert.id.desc()).limit(limit)
    if after_id:
        query = query.where(Alert.id > after_id)
    if state:
        query = query.where(Alert.state == state.upper())
    if kind:
        query = query.where(Alert.kind == kind)
    return {"alerts": [alert_to_dict(a) for a in session.scalars(query).all()]}


@router.get("/stream")
async def stream(request: Request):
    """Server-sent events: one `alert` event per new alert, plus a heartbeat every 20 seconds."""

    async def events():
        queue = broker.subscribe()
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"event: alert\ndata: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            broker.unsubscribe(queue)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class WatchlistIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    states: list[str] = Field(default_factory=list)
    county_fips: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    kinds: list[str] = Field(default_factory=list)
    min_severity: int = Field(1, ge=1, le=5)
    webhook_url: str | None = None


def rule_to_dict(r: AlertRule) -> dict:
    return {
        "id": r.id, "name": r.name, "states": r.states, "county_fips": r.county_fips, "topics": r.topics,
        "kinds": r.kinds, "min_severity": r.min_severity, "has_webhook": bool(r.webhook_url), "active": r.active,
    }


@router.get("/watchlists")
def list_watchlists(session: Session = Depends(get_session)):
    return {"watchlists": [rule_to_dict(r) for r in session.scalars(select(AlertRule).order_by(AlertRule.id)).all()]}


@router.post("/watchlists", status_code=201)
def create_watchlist(body: WatchlistIn, session: Session = Depends(get_session)):
    rule = AlertRule(**{**body.model_dump(), "states": [s.upper() for s in body.states]})
    session.add(rule)
    session.commit()
    return rule_to_dict(rule)


@router.delete("/watchlists/{rule_id}", status_code=204)
def delete_watchlist(rule_id: int, session: Session = Depends(get_session)):
    rule = session.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(404, "Watchlist not found")
    session.delete(rule)
    session.commit()


@router.get("/status")
def status(request: Request):
    return get_pipeline(request).status()


@router.post("/run")
async def run(request: Request, source: str | None = None, process: bool = True):
    """Run one source (or all) now. Protect this route before deploying publicly."""
    pipeline = get_pipeline(request)
    if source:
        if source not in pipeline.collectors:
            raise HTTPException(404, f"Unknown source. Choose from: {', '.join(pipeline.collectors)}")
        report = await pipeline.run_source(source)
        processed = await pipeline.process_pending() if process else {}
        return {"sources": [report], "processed": processed}
    return await pipeline.run_all(process=process)


@router.post("/process")
async def process(request: Request, limit: int = Query(200, ge=1, le=2000)):
    return await get_pipeline(request).process_pending(limit=limit)
