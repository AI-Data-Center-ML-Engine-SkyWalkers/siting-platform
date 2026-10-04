"""Minimal ML scoring service with the exact contract the SitewellEco² backend expects.

    pip install fastapi uvicorn
    uvicorn main:app --port 8001

Then in backend/.env: SCORING_PROVIDER=http and ML_SERVICE_URL=http://localhost:8001
Replace score() with the real model; keep the response shape.
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Scoring model")

# Replace with your candidate table (H3 cells, counties or parcels) and model features.
CANDIDATES = [
    {"site_id": "51107", "name": "Loudoun County, VA", "state": "VA", "county_fips": "51107", "lat": 39.09, "lon": -77.64,
     "features": {"power": 0.4, "water": 0.7, "climate": 0.8, "cooling": 0.6, "land": 0.3, "community": 0.3}},
    {"site_id": "19153", "name": "Polk County, IA", "state": "IA", "county_fips": "19153", "lat": 41.68, "lon": -93.57,
     "features": {"power": 0.7, "water": 0.8, "climate": 0.6, "cooling": 0.8, "land": 0.5, "community": 0.7}},
]


class RankRequest(BaseModel):
    n: int = 10
    weights: dict[str, float] | None = None


def score(candidate: dict, weights: dict[str, float] | None) -> tuple[float, dict]:
    """Stand-in for the real model: weighted mean of 0-1 pillar features."""
    w = weights or {k: 1.0 for k in candidate["features"]}
    total = sum(w.get(k, 0) for k in candidate["features"]) or 1.0
    s = sum(candidate["features"][k] * w.get(k, 0) for k in candidate["features"]) / total
    return round(100 * s, 1), {k: round(100 * v, 1) for k, v in candidate["features"].items()}


def to_site(c: dict, weights) -> dict:
    s, pillars = score(c, weights)
    return {k: c[k] for k in ("site_id", "name", "state", "county_fips", "lat", "lon")} | {
        "score": s, "pillars": pillars, "factors": {}, "pros": [], "cons": [], "excluded": False, "attributes": {},
    }


@app.post("/rank")
def rank(body: RankRequest):
    sites = sorted((to_site(c, body.weights) for c in CANDIDATES), key=lambda s: s["score"], reverse=True)
    for i, s in enumerate(sites, start=1):
        s["rank"] = i
    return {"model_version": "example-0.1", "illustrative": True, "sites": sites[: body.n]}


@app.get("/sites/{site_id}")
def site(site_id: str):
    for c in CANDIDATES:
        if c["site_id"] == site_id:
            return to_site(c, None)
    raise HTTPException(404, "Site not found")
