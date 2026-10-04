"""Fetch full article text for news items that arrive with a headline only (GDELT, Media Cloud).
Respects robots.txt and only reads what a browser would show."""
from __future__ import annotations

import asyncio
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from .base import log

_robots: dict[str, RobotFileParser | None] = {}


async def allowed(client: httpx.AsyncClient, url: str, agent: str) -> bool:
    parts = urlsplit(url)
    base = f"{parts.scheme}://{parts.netloc}"
    if base not in _robots:
        parser = RobotFileParser()
        try:
            response = await client.get(f"{base}/robots.txt", timeout=10)
            if response.status_code >= 400:
                _robots[base] = None  # no robots.txt: allowed
            else:
                parser.parse(response.text.splitlines())
                _robots[base] = parser
        except httpx.HTTPError:
            _robots[base] = None
    parser = _robots[base]
    return parser is None or parser.can_fetch(agent, url)


async def fetch_text(client: httpx.AsyncClient, url: str, agent: str) -> str:
    try:
        import trafilatura
    except ImportError:
        return ""
    if not await allowed(client, url, agent):
        log.info("robots.txt disallows %s", url)
        return ""
    try:
        response = await client.get(url, follow_redirects=True, timeout=20)
        if response.status_code != 200 or "html" not in response.headers.get("content-type", ""):
            return ""
    except httpx.HTTPError:
        return ""
    text = await asyncio.to_thread(trafilatura.extract, response.text, include_comments=False, include_tables=False)
    return (text or "")[:20000]
