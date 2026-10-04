"""Shared types for collectors. Collectors only fetch and parse; they never call an AI model."""
from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

log = logging.getLogger("awareness")

# How much we trust each kind of source by default. Used for weighting and alerts.
CREDIBILITY = {
    "legislation": 1.0,  # official bill records
    "government": 0.95,  # council agendas, Federal Register
    "news": 0.8,  # established outlets
    "advocacy": 0.6,  # advocacy groups and newsletters
    "social": 0.4,  # individual posts
}


@dataclass
class RawItem:
    source: str
    source_type: str
    url: str
    title: str
    text: str = ""
    published_at: datetime | None = None
    external_id: str | None = None
    author: str | None = None
    outlet: str | None = None
    state: str | None = None  # 2-letter, when the source tells us (a state bill)
    county_fips: str | None = None  # when the source tells us (a county council)
    version_key: str | None = None  # changes when a bill moves, so we re-analyze
    extra: dict = field(default_factory=dict)

    def when(self) -> datetime:
        return self.published_at or datetime.now(timezone.utc)


class Collector(ABC):
    name: str = "base"
    source_type: str = "news"
    interval_minutes: int = 30
    requires: tuple[str, ...] = ()  # settings that must be set for the collector to run
    min_seconds_between_requests: float = 1.0

    def __init__(self, settings):
        self.settings = settings

    def enabled(self) -> bool:
        return all(getattr(self.settings, key, None) for key in self.requires)

    @abstractmethod
    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        """Return items published or updated after `since`."""

    async def polite_get(self, client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
        """GET with retries on 429/5xx and a pause between requests."""
        delay = 2.0
        for attempt in range(4):
            response = await client.get(url, **kwargs)
            if response.status_code not in (429, 500, 502, 503, 504):
                await asyncio.sleep(self.min_seconds_between_requests)
                return response
            retry_after = response.headers.get("retry-after")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
            log.warning("%s: HTTP %s, retrying in %.0fs", self.name, response.status_code, wait)
            await asyncio.sleep(wait)
            delay *= 2
        return response


def parse_dt(value) -> datetime | None:
    """Parse the many date formats sources use into an aware UTC datetime."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    text = str(value).strip()
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y%m%d%H%M%S", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    try:
        from email.utils import parsedate_to_datetime

        dt = parsedate_to_datetime(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
