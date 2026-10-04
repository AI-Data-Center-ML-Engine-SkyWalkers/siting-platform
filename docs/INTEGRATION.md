# Integrating the ML scoring model (steps 2 and 3)

The backend never needs to know how the model works. It needs one thing: a ranked list of sites in the
`RankResponse` shape below. Pick whichever connection is easiest for the ML team.

## Option A: HTTP service (recommended for separate repos)

Run the model as its own service and set in `backend/.env`:

```
SCORING_PROVIDER=http
ML_SERVICE_URL=http://localhost:8001
```

The service must expose two routes:

| Route | Body | Returns |
| --- | --- | --- |
| `POST /rank` | `{"n": 10, "weights": {"power": 50, "water": 80, ...} or null}` | `RankResponse` |
| `GET /sites/{site_id}` | none | `SiteScore`, or 404 |

`ml_service_example/main.py` is a working stub with exactly this contract. Replace its `score()` function
with the real model and the whole app (site finder, trade-offs, re-ranking) works unchanged.

## Option B: import a Python function (same repo)

```
SCORING_PROVIDER=python
ML_PYTHON_ENTRYPOINT=ml_model.rank:rank_sites
```

`rank_sites(n: int, weights: dict | None)` returns a `RankResponse` dict, or just the list of sites.
It can be sync or async.

## The shapes

```json
// RankResponse
{
  "model_version": "xgb-2026-10-04",
  "illustrative": false,
  "sites": [SiteScore, ...]          // best first
}

// SiteScore
{
  "site_id": "h3-862a1072fffffff",   // any stable id: H3 cell, county FIPS, parcel id
  "name": "Loudoun County, VA",
  "state": "VA",
  "county_fips": "51107",            // REQUIRED for community re-ranking (5-digit FIPS)
  "lat": 39.09, "lon": -77.64,
  "score": 71.4,                     // 0-100, higher is better
  "rank": 1,
  "pillars": {"power": 62, "water": 88, "climate": 90, "cooling": 70, "land": 55, "community": 40},
  "factors": {"carbon": 520, "water_stress": 1.8},   // raw values, any keys
  "pros": ["Low water stress"], "cons": ["Carbon-heavy grid"],
  "excluded": false, "exclusion_reason": null,
  "attributes": {                    // optional, feeds the trade-off engine
    "time_to_power_years": 6, "tx_km": 2, "water_stress": 1.8,
    "heat_need": 50, "climate_adversity": 20, "land_cost_index": 95, "unemployment": 2.6
  }
}
```

Pillar ids the frontend sliders send as `weights`: `power`, `water`, `climate`, `cooling`, `land`, `community`.

## Step 3: community signals

Two ways to use the awareness engine. Use both.

**1. Re-ranking (no model change).** `GET /api/scoring/top?n=10&community=true` calls the model, then
adjusts each score with the county's community features:

```
final = score x exp(0.3 x net_sentiment x confidence) x (1 + 0.1 x incentive) x (1 - 0.3 x restriction) x (0 if moratorium)
```

The betas are `RERANK_BETA_*` in `.env`. The response keeps `base_rank`, `final_rank`, `rank_change`
and plain-language `notes` for each site, so the UI can show why a site moved.

**2. Features for training.** `GET /api/integration/community-features?fips=51107&fips=13077` returns per
county: `opposition_index`, `support_index`, `net_sentiment`, `incentive_signal`, `restriction_signal`,
`active_moratorium`, `momentum`, `coverage`, `confidence`. Call it without `fips` to get every county with
coverage. Counties with no coverage inherit their state's signal at reduced confidence.

How they are computed (backend/app/awareness/features.py): each analyzed item counts by
source credibility (official 1.0, news 0.8, advocacy 0.6, social 0.4) x severity x recency
(half-life `HALF_LIFE_DAYS`, default 30) x 0.6 if its evidence quote could not be verified.
County values are shrunk toward the state average until a county has a few items of its own.

## Checklist for the ML team

- [ ] Return `county_fips` on every site (needed to join community signals).
- [ ] Keep `score` on 0-100.
- [ ] Mark excluded sites with `excluded: true` and a reason instead of dropping them.
- [ ] Bump `model_version` on every retrain; the UI shows it.
- [ ] Set `illustrative: false` once real data is in.
