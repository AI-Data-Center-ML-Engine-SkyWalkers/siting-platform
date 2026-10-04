"""Limits engine API: proxies the scoring service's trade-off solver (/engine/*)."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from .deps import get_scoring

router = APIRouter(prefix="/api/engine", tags=["engine"])


def _base_url(request: Request) -> str:
    scoring = get_scoring(request)
    if getattr(scoring, "name", "") != "http" or not getattr(scoring, "base_url", None):
        raise HTTPException(503, "Trade-off engine needs the scoring service")
    return scoring.base_url


def _service_error(response: httpx.Response) -> HTTPException:
    try:
        detail = response.json().get("detail", response.text)
    except ValueError:
        detail = response.text
    return HTTPException(502, f"Scoring service error ({response.status_code}): {detail}")


async def _forward(request: Request, method: str, path: str, body: bytes | None = None, params=None):
    url = f"{_base_url(request)}{path}"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.request(
                method, url, content=body, params=params,
                headers={"content-type": "application/json"} if body is not None else None,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Scoring service unreachable: {exc}")
    if response.status_code >= 400:
        raise _service_error(response)
    return response.json()


@router.post("/solve")
async def solve(request: Request):
    return JSONResponse(await _forward(request, "POST", "/engine/solve", await request.body()))


@router.post("/sweep")
async def sweep(request: Request):
    return JSONResponse(await _forward(request, "POST", "/engine/sweep", await request.body()))


@router.get("/pareto")
async def pareto(request: Request):
    return JSONResponse(await _forward(request, "GET", "/engine/pareto", params=request.url.query))


@router.get("/meta")
async def meta(request: Request):
    m = await _forward(request, "GET", "/meta")
    return {"model_version": m.get("model_version"), "metrics": m.get("metrics", []), "pillars": m.get("pillars", [])}
