"""API tests against the mock scoring provider and an empty awareness database."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_api.db"

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


def test_tradeoff_ecosystem_lifts_alaska(client):
    def rank_of(preset):
        params = client.get("/api/tradeoff/presets").json()["presets"][preset]
        res = client.post("/api/tradeoff/evaluate", json={"params": params}).json()
        return next(r["rank"] for r in res["results"] if r["site_id"] == "fairbanks")

    assert rank_of("ecosystem") < rank_of("speed")


def test_awareness_endpoints_empty(client):
    assert client.get("/api/awareness/search", params={"q": "moratorium"}).json()["total"] == 0
    assert client.get("/api/awareness/regions/VA").json()["level"] == "state"
    assert client.get("/api/awareness/alerts").json()["alerts"] == []
    status = client.get("/api/awareness/status").json()
    assert any(s["source"] == "gdelt" and s["enabled"] for s in status["sources"])
    created = client.post("/api/awareness/watchlists", json={"name": "Virginia", "states": ["va"], "kinds": ["moratorium"]})
    assert created.status_code == 201 and created.json()["states"] == ["VA"]
    feats = client.get("/api/integration/community-features", params={"fips": ["51107"]}).json()
    assert "51107" in feats["features"]
