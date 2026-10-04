"""Where scores come from. Swap providers with SCORING_PROVIDER without touching the rest of the app.

- mock:   built-in illustrative sites (works today)
- http:   your teammates' ML service, called over HTTP (POST {ML_SERVICE_URL}/rank)
- python: import a function in-process, e.g. ML_PYTHON_ENTRYPOINT=ml_model.rank:rank_sites
"""
from __future__ import annotations

import asyncio
import importlib
import inspect

import httpx

from .sample_sites import score_sites
from .schemas import RankResponse, SiteScore


class MockScoringProvider:
    name = "mock"

    async def rank(self, n: int = 10, weights: dict | None = None) -> RankResponse:
        sites = [SiteScore(**s) for s in score_sites(weights) if not s["excluded"]][:n]
        return RankResponse(model_version="mock-geomean-v1", illustrative=True, sites=sites)

    async def candidates(self, weights: dict | None = None) -> RankResponse:
        return RankResponse(model_version="mock-geomean-v1", illustrative=True, sites=[SiteScore(**s) for s in score_sites(weights)])

    async def site(self, site_id: str) -> SiteScore | None:
        return next((SiteScore(**s) for s in score_sites() if s["site_id"] == site_id), None)


class HttpScoringProvider:
    """Calls the ML service. Contract (see docs/INTEGRATION.md):
        POST /rank        {"n": 10, "weights": {...}}  -> RankResponse
        GET  /sites/{id}                               -> SiteScore
    """

    name = "http"

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    async def rank(self, n: int = 10, weights: dict | None = None) -> RankResponse:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(f"{self.base_url}/rank", json={"n": n, "weights": weights})
            response.raise_for_status()
            return RankResponse.model_validate(response.json())

    async def candidates(self, weights: dict | None = None) -> RankResponse:
        return await self.rank(100, weights)

    async def site(self, site_id: str) -> SiteScore | None:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(f"{self.base_url}/sites/{site_id}")
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return SiteScore.model_validate(response.json())


class PythonScoringProvider:
    """Imports `module:function`. The function takes (n: int, weights: dict | None) and returns
    a RankResponse-like dict or a list of SiteScore-like dicts. It may be sync or async."""

    name = "python"

    def __init__(self, entrypoint: str):
        module_name, _, func_name = entrypoint.partition(":")
        self.func = getattr(importlib.import_module(module_name), func_name)

    async def _call(self, n: int, weights: dict | None):
        if inspect.iscoroutinefunction(self.func):
            return await self.func(n, weights)
        return await asyncio.to_thread(self.func, n, weights)

    async def rank(self, n: int = 10, weights: dict | None = None) -> RankResponse:
        result = await self._call(n, weights)
        if isinstance(result, list):
            result = {"model_version": getattr(self.func, "__name__", "python"), "sites": result}
        return RankResponse.model_validate(result)

    async def candidates(self, weights: dict | None = None) -> RankResponse:
        return await self.rank(100, weights)

    async def site(self, site_id: str) -> SiteScore | None:
        ranked = await self.candidates()
        return next((s for s in ranked.sites if s.site_id == site_id), None)


def build_provider(settings):
    if settings.scoring_provider == "http" and settings.ml_service_url:
        return HttpScoringProvider(settings.ml_service_url)
    if settings.scoring_provider == "python" and settings.ml_python_entrypoint:
        return PythonScoringProvider(settings.ml_python_entrypoint)
    return MockScoringProvider()
