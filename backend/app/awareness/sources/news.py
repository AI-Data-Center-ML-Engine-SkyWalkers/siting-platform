"""News collectors: GDELT, Google News RSS, curated RSS feeds and Media Cloud."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from urllib.parse import quote_plus

import feedparser
import httpx

from ..base import Collector, RawItem, log, parse_dt
from ..keywords import GDELT_QUERY, GOOGLE_NEWS_QUERIES, LEGISLATION_QUERY, is_data_center_news
from ..normalize import clean_text, domain_of, strip_outlet_suffix

# Curated feeds that track data center fights and subsidies. Add local papers via RSS_FEEDS.
DEFAULT_FEEDS = [
    ("https://datacenterwatch.substack.com/feed", "advocacy", "Data Center Watch"),
    ("https://goodjobsfirst.org/feed/", "advocacy", "Good Jobs First"),
]


class GdeltCollector(Collector):
    """GDELT DOC 2.0: global news, updated every 15 minutes, rolling 3-month window, no key."""

    name = "gdelt"
    source_type = "news"
    interval_minutes = 15
    min_seconds_between_requests = 5.0  # GDELT returns 429 when hit too fast
    URL = "https://api.gdeltproject.org/api/v2/doc/doc"

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        minutes = max(15, int((datetime.now(timezone.utc) - since).total_seconds() // 60))
        timespan = f"{minutes}min" if minutes <= 1440 else f"{min(minutes // 1440, 90)}d"
        params = {
            "query": GDELT_QUERY,
            "mode": "ArtList",
            "format": "json",
            "maxrecords": "250",
            "sort": "DateDesc",
            "timespan": timespan,
        }
        response = await self.polite_get(client, self.URL, params=params)
        response.raise_for_status()
        try:
            data = response.json()
        except ValueError:  # GDELT answers query errors in plain text
            raise RuntimeError(f"GDELT error: {response.text[:200]}")
        return [self.parse(a) for a in data.get("articles", []) if a.get("url")]

    def parse(self, a: dict) -> RawItem:
        return RawItem(
            source=self.name,
            source_type=self.source_type,
            url=a["url"],
            title=clean_text(a.get("title")),
            published_at=parse_dt(a.get("seendate")),
            outlet=a.get("domain") or domain_of(a["url"]),
            extra={k: a.get(k) for k in ("language", "sourcecountry", "socialimage") if a.get(k)},
        )


class GoogleNewsCollector(Collector):
    """Google News RSS search: up to 100 items per query. Used for discovery; we link to the original."""

    name = "google_news"
    source_type = "news"
    interval_minutes = 20
    BASE = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        hours = max(1, int((datetime.now(timezone.utc) - since).total_seconds() // 3600))
        window = f"when:{hours}h" if hours <= 48 else f"when:{min(hours // 24, 30)}d"
        items: list[RawItem] = []
        for query in GOOGLE_NEWS_QUERIES:
            url = self.BASE.format(q=quote_plus(f"{query} {window}"))
            response = await self.polite_get(client, url)
            if response.status_code != 200:
                log.warning("google_news: HTTP %s for %s", response.status_code, query)
                continue
            items.extend(self.parse_feed(response.text))
        return items

    def parse_feed(self, xml: str) -> list[RawItem]:
        feed = feedparser.parse(xml)
        out = []
        for entry in feed.entries:
            title, outlet = strip_outlet_suffix(entry.get("title", ""))
            source = entry.get("source") or {}
            out.append(
                RawItem(
                    source=self.name,
                    source_type=self.source_type,
                    url=entry.get("link", ""),
                    title=clean_text(title),
                    text=clean_text(entry.get("summary", "")),
                    published_at=parse_dt(entry.get("published")),
                    outlet=(source.get("title") if isinstance(source, dict) else None) or outlet,
                    extra={"source_url": source.get("href")} if isinstance(source, dict) and source.get("href") else {},
                )
            )
        return [i for i in out if i.url]


class RssCollector(Collector):
    """Curated RSS/Atom feeds (advocacy groups, local papers). Keeps only data center stories."""

    name = "rss"
    source_type = "news"
    interval_minutes = 30

    def feeds(self) -> list[tuple[str, str, str | None]]:
        extra = [(url, "news", None) for url in self.settings.csv(self.settings.rss_feeds)]
        return DEFAULT_FEEDS + extra

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        items: list[RawItem] = []
        for url, kind, outlet in self.feeds():
            try:
                response = await self.polite_get(client, url)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                log.warning("rss: %s failed: %s", url, exc)
                continue
            for item in self.parse_feed(response.text, kind, outlet):
                if item.when() >= since and is_data_center_news(item.title, item.text):
                    items.append(item)
        return items

    def parse_feed(self, xml: str, kind: str, outlet: str | None) -> list[RawItem]:
        feed = feedparser.parse(xml)
        name = outlet or feed.feed.get("title")
        out = []
        for entry in feed.entries:
            body = entry.get("summary", "")
            if entry.get("content"):
                body = entry["content"][0].get("value", body)
            out.append(
                RawItem(
                    source=self.name,
                    source_type=kind,
                    url=entry.get("link", ""),
                    title=clean_text(entry.get("title")),
                    text=clean_text(body),
                    published_at=parse_dt(entry.get("published") or entry.get("updated")),
                    author=entry.get("author"),
                    outlet=name,
                )
            )
        return [i for i in out if i.url]


class MediaCloudCollector(Collector):
    """Media Cloud online news archive. Needs a free key; add state & local collection ids in settings."""

    name = "mediacloud"
    source_type = "news"
    interval_minutes = 60
    requires = ("mediacloud_api_key",)

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        try:
            import mediacloud.api
        except ImportError:
            log.warning("mediacloud: package not installed")
            return []
        api = mediacloud.api.SearchApi(self.settings.mediacloud_api_key)
        collections = [int(c) for c in self.settings.csv(self.settings.mediacloud_collections)]
        start, end = since.date(), datetime.now(timezone.utc).date()

        def fetch() -> list[dict]:
            stories, token, pages = [], None, 0
            while pages < 5:
                page, token = api.story_list(
                    LEGISLATION_QUERY, start_date=start, end_date=end, collection_ids=collections, pagination_token=token
                )
                stories.extend(page)
                pages += 1
                if not token:
                    break
            return stories

        stories = await asyncio.to_thread(fetch)
        return [
            RawItem(
                source=self.name,
                source_type=self.source_type,
                url=s["url"],
                title=clean_text(s.get("title")),
                published_at=parse_dt(s.get("publish_date")),
                outlet=s.get("media_name") or domain_of(s["url"]),
                external_id=str(s.get("id")) if s.get("id") else None,
            )
            for s in stories
            if s.get("url")
        ]
