# Awareness engine: sources, scraping and AI (step 5)

Researched October 2026. Access rules change, so re-check a source's terms before relying on it.

## Sources

| Layer | Source | Collector | Access | Cadence | What it gives us |
| --- | --- | --- | --- | --- | --- |
| Legislation | Open States API v3 (Plural Policy) | `openstates` | Free key, `X-API-KEY` header | 6 h | Bills in all 50 state legislatures: tax exemptions, moratoria, large-load tariffs |
| Legislation | LegiScan API | `legiscan` | Free key, 10,000 queries/month, data CC BY 4.0 (credit LegiScan) | 12 h | Full-text bill search across all states and Congress, with change hashes for status updates |
| Federal | Federal Register API | `federal_register` | No key | 24 h | Federal rules and notices (energy, permitting, large-load interconnection) |
| Local government | Legistar Web API (Granicus) | `legistar` | Public for most councils; some need a token | 12 h | City and county council matters: rezonings, ordinances, hearings. Configure councils in `LEGISTAR_CLIENTS` |
| News | GDELT DOC 2.0 API | `gdelt` | No key; returns 429 if hit too fast | 15 min | Worldwide news incl. local US outlets; rolling 3-month window, up to 250 articles per query |
| News | Media Cloud | `mediacloud` | Free key | 1 h | Curated US national and state/local news collections |
| News | Google News RSS search | `google_news` | No key | 20 min | Up to 100 items per query. Discovery only: always link to the original outlet |
| News and advocacy | Curated RSS feeds | `rss` | None | 30 min | Data Center Watch, Good Jobs First, plus local papers you add in `RSS_FEEDS` |
| Social | Bluesky Jetstream | live stream | No key | Real time | Every new public post (WebSocket), filtered by our keywords |
| Social | Bluesky searchPosts | `bluesky` | App password: Bluesky refuses anonymous search | 15 min | Backfill keyword search |
| Social | Reddit Data API | `reddit` | Requires approval under Reddit's Responsible Builder Policy | 30 min once approved | Local subreddits and opposition threads |
| Social | Mastodon hashtag timelines | `mastodon` | None on most servers | 30 min | Posts tagged #datacenter, #datacenters |

Deliberately excluded: X (paid API), Facebook and Nextdoor (no lawful API), unofficial Reddit scraping
(against Reddit's policy), and any scraping that ignores robots.txt.

Worth adding next: state utility commission dockets (large-load tariffs; no common API, scrape per state with
Scrapy), Regulations.gov comments (free api.data.gov key), and YouTube transcripts of county board meetings.

## Scraping stack (no AI)

| Job | Tool |
| --- | --- |
| HTTP and APIs | httpx (async), retries on 429/5xx with `Retry-After`, a pause between requests |
| RSS and Atom | feedparser |
| Article text | trafilatura, only where robots.txt allows (`enrich.py`) |
| Real-time stream | websockets for Bluesky Jetstream, with cursor resume on reconnect |
| Sites without an API | Scrapy (respects robots.txt); Playwright only for JavaScript-only pages |
| Scheduling | APScheduler in the API process; move to Celery + Redis when scaling out |
| Storage | SQLite for the hackathon; Postgres + pgvector at scale (`DATABASE_URL`) |

## Pipeline

```
collect (no AI) -> keyword gate -> canonical URL + dedupe -> geotag (state, county FIPS)
  -> store -> fetch article text -> AI analysis -> embeddings -> community features -> alerts
```

- **Keyword gate:** news and social items must mention a data center before anything is stored, so the AI
  never pays for off-topic items. Official records pass through.
- **Dedupe:** tracking parameters stripped from URLs; syndicated copies (same text hash) reuse one analysis;
  near-duplicate headlines (word-shingle Jaccard >= 0.6 within 7 days) share a cluster. A cluster reported by
  two or more outlets is shown as "Reported by 2+ outlets".
- **Bill updates:** when a bill's status changes (Open States action, LegiScan change hash, Legistar status),
  the item is updated and re-analyzed instead of duplicated, and can raise a new alert.
- **Geotagging:** source metadata first (a state bill, a county council), then a US county gazetteer
  (3,200+ counties with FIPS and centroids), then the AI's extracted location.

## AI analysis

- **Gemini first** (`GEMINI_MODEL`, default `gemini-3.8-flash`), structured JSON output, 8 items per call.
- **Claude as fallback** (`CLAUDE_MODEL`, default `claude-haiku-4-5-20251001`) when Gemini errors or is
  rate-limited, using a forced tool call for structured output.
- **Keyword rules last**, so the pipeline runs with no API keys at all.
- **Embeddings:** `gemini-embedding-2`, falling back to `gemini-embedding-001`. `text-embedding-004` was shut
  down on January 14, 2026. Without a key, a local hashing embedder keeps search working.

Each item gets: relevance, stance (support, oppose, neutral, mixed), up to 4 topics, an event type,
severity 1-5, state/county/city, a one-sentence summary, a verbatim evidence quote, companies, bill number,
and the date of any upcoming hearing, vote or protest.

## What keeps it legitimate

- Every item links to its source and publication time.
- The AI must quote the sentence it relied on. Quotes not found in the source are flagged in the UI, halve
  the item's confidence, and reduce its weight in community features.
- Sources carry credibility weights: official 1.0, government 0.95, news 0.8, advocacy 0.6, social 0.4.
- A single social post never raises an event alert; social posts only feed regional sentiment.
- Moratorium flags require an official or established news source.
- Social authors are not shown or profiled; posts are aggregated by region.
- Official APIs only, within their rate limits and terms, with an honest `USER_AGENT`.

## Alerts

Event alerts (moratorium, restriction, incentive, bill introduced or advancing, law passed, hearing,
zoning decision, protest, lawsuit, project canceled) fire from new analyses at severity 3+ or from any
official record. Sentiment-shift alerts fire when a region's opposition index rises 0.2 above its 90-day
baseline (daily snapshots in `region_snapshots`). Alerts stream to the app over server-sent events
(`/api/awareness/stream`) and post to Slack or Discord webhooks, globally or per watchlist.
