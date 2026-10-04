# Groundwork

Where should America's next sustainable data center be built? Groundwork ranks candidate sites, adjusts the
ranking with live community signals, lets site engineers and developers weigh trade-offs, and alerts them when
local sentiment, laws or incentives change.

```
backend/              FastAPI: awareness pipeline, scoring integration, trade-off engine, API
frontend/             React + Vite: landing page, Site finder, Trade-offs, Community pulse
ml_service_example/   Stub ML service with the exact contract the backend expects
docs/                 DATA_SOURCES.md (step 5) and INTEGRATION.md (steps 2-3, for the ML team)
```

## Run it

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # add keys as you get them; everything is optional
uvicorn app.main:app --reload   # http://localhost:8000/docs
```

Frontend (Node 18+), in a second terminal:

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173, proxies /api to :8000
```

With the backend down, the frontend shows built-in sample data and says so on every page.

## Collect real data

```bash
cd backend
python -m app.cli sources                    # what is enabled, and which keys are missing
python -m app.cli collect --source gdelt     # one source now (no key needed)
python -m app.cli collect                    # every enabled source, then AI analysis
python -m app.cli live                       # Bluesky posts in real time
python -m app.cli features --fips 51107      # community features for one county
```

Sources that work with no key: GDELT, Google News RSS, curated RSS, Federal Register, Mastodon, Bluesky live
stream. Add `OPENSTATES_API_KEY` and `LEGISCAN_API_KEY` (both free) for state bills, and `GEMINI_API_KEY` for AI
analysis. To keep collecting in the background, set `ENABLE_SCHEDULER=true` and `ENABLE_JETSTREAM=true`.

## Plug in the ML model

See `docs/INTEGRATION.md`. In short: return `RankResponse` JSON from `POST /rank`, set
`SCORING_PROVIDER=http` and `ML_SERVICE_URL`, and the site finder, trade-offs and community re-ranking use it.

## Deploy as one server

```bash
cd frontend && npm run build   # writes frontend/dist
cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

FastAPI serves the built frontend at `/` and the API at `/api`. Protect `POST /api/awareness/run` before
exposing the server publicly.

## Tests

```bash
cd backend && pytest
```

Tests run offline: collector parsers use recorded-shape payloads and the pipeline runs on keyword rules.

## API at a glance

| Route | What it does |
| --- | --- |
| `GET /api/scoring/top?n=10&community=true` | Top sites, re-ranked with community signals |
| `POST /api/scoring/rank` | Same, with pillar weights from the sliders |
| `GET /api/scoring/sites/{id}` | One site with its community pulse |
| `POST /api/tradeoff/evaluate` | Shortlist for your objectives, ecosystem values and limits |
| `GET /api/awareness/search` | Search news, bills and posts (semantic or keyword) with filters |
| `GET /api/awareness/regions/{state or FIPS}` | Pros, cons, policies and upcoming events for a place |
| `GET /api/awareness/map` | Community indices by state or county |
| `GET /api/awareness/alerts`, `GET /api/awareness/stream` | Alert history, and live alerts (server-sent events) |
| `GET/POST/DELETE /api/awareness/watchlists` | Regions and alert types to watch, with optional webhooks |
| `GET /api/integration/community-features` | Per-county features for the ML team |
| `GET /api/awareness/status` | Source health, counts, AI chain |

Sample sites in the mock scoring provider and sample items in the frontend are illustrative, not real data.
