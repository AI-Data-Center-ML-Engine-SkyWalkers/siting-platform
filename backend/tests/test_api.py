"""API tests against the mock scoring provider and an empty awareness database."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_api.db"
os.environ["SCORING_PROVIDER"] = "mock"

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c
    if os.path.exists("test_api.db"):
        os.remove("test_api.db")


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["scoring_provider"] == "mock" and body["ai_chain"][-1] == "rules"


def test_scoring_top_with_and_without_community(client):
    base = client.get("/api/scoring/top", params={"n": 5, "community": False}).json()
    assert len(base["sites"]) == 5 and base["illustrative"] is True
    adj = client.get("/api/scoring/top", params={"n": 5}).json()
    assert {"base_rank", "final_rank", "rank_change", "community"} <= set(adj["sites"][0])
    assert adj["sites"][0]["community"]["illustrative"] is True  # no collected signals yet


def test_rank_with_weights(client):
    water = client.post("/api/scoring/rank", json={"n": 3, "weights": {"water": 5}, "community": False}).json()
    assert water["sites"][0]["pillars"]["water"] >= 50


def test_site_detail(client):
    body = client.get("/api/scoring/sites/fairbanks").json()
    assert body["site"]["state"] == "AK" and body["pulse"]["name"].startswith("Fairbanks North Star")


def test_tradeoff_accord_floor_and_dimensions(client):
    presets = client.get("/api/tradeoff/presets").json()["presets"]
    assert set(presets) == {"balanced", "economic", "social", "ecological"}
    eco = client.post("/api/tradeoff/evaluate", json={"params": presets["ecological"]}).json()
    assert eco["disclaimer"].startswith("SitewellEco² does not rate communities")
    assert len(eco["indicators"]) == 18
    assert {i["dimension"] for i in eco["indicators"]} == {"economic", "social", "ecological"}
    first = eco["results"][0]
    assert {"indicators", "baseline", "best", "dimensions", "tensions"} <= set(first)
    assert first["utility"] >= 0
    dry = next((e for e in eco["excluded"] if e["site_id"] in {"amarillo", "phoenix", "abilene"}), None)
    assert dry is not None
    no_floor = {**presets["economic"], "min_indicator": None}
    jobs = client.post("/api/tradeoff/evaluate", json={"params": no_floor}).json()
    assert any(r["site_id"] == "williamson" for r in jobs["results"])


def test_engine_needs_scoring_service(client):
    for response in (
        client.post("/api/engine/solve", json={"objective": "score"}),
        client.get("/api/engine/pareto", params={"x": "co2_t", "y": "energy_cost_musd"}),
        client.get("/api/engine/meta"),
    ):
        assert response.status_code == 503
        assert response.json()["detail"] == "Trade-off engine needs the scoring service"


def test_meta_uses_provider_meta_when_available(client):
    scoring = client.app.state.scoring

    async def fake_meta():
        return {
            "model_version": "test",
            "pillars": [{"id": "carbon", "label": "Carbon", "hint": "Grid CO2"}],
            "presets": [{"id": "base", "label": "Balanced", "weights": {"carbon": 100}}],
            "factors": [{"id": "co2_t", "pillar": "carbon", "label": "CO2", "better": "low", "unit": "tCO2/yr"}],
            "metrics": [{"id": "co2_t", "label": "CO2", "unit": "tCO2/yr", "better": "low", "judgment": False}],
        }

    scoring.meta = fake_meta
    try:
        body = client.get("/api/scoring/meta").json()
    finally:
        del scoring.meta
    assert body["pillars"][0]["hint"] == "Grid CO2"
    assert body["presets"][0]["id"] == "base" and body["metrics"][0]["id"] == "co2_t"
    assert body["provider"] == "mock" and "betas" in body
    fallback = client.get("/api/scoring/meta").json()
    assert "presets" not in fallback and len(fallback["pillars"]) == 6


def test_awareness_endpoints_empty(client):
    assert client.get("/api/awareness/search", params={"q": "moratorium"}).json()["total"] == 0
    assert client.get("/api/awareness/regions/VA").json()["level"] == "state"
    assert client.get("/api/awareness/alerts").json()["alerts"] == []
    events = client.get("/api/awareness/events").json()
    assert events["type"] == "FeatureCollection" and events["features"] == []
    status = client.get("/api/awareness/status").json()
    assert any(s["source"] == "gdelt" and s["enabled"] for s in status["sources"])
    created = client.post("/api/awareness/watchlists", json={"name": "Virginia", "states": ["va"], "kinds": ["moratorium"]})
    assert created.status_code == 201 and created.json()["states"] == ["VA"]
    feats = client.get("/api/integration/community-features", params={"fips": ["51107"]}).json()
    assert "51107" in feats["features"]
