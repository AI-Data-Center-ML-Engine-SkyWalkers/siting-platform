"""Social collectors: Bluesky (search + live Jetstream), Reddit (official API only) and Mastodon.

Privacy rule for the whole project: social posts feed regional aggregates and are shown as
public posts with a link. We do not build profiles of individual users.
"""
from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone

import httpx

from ..base import Collector, RawItem, log, parse_dt
from ..keywords import MASTODON_TAGS, SOCIAL_QUERY, SUBREDDIT_QUERY, mentions_data_center
from ..normalize import clean_text


def bsky_post_url(uri: str, handle_or_did: str) -> str:
    # at://did:plc:xyz/app.bsky.feed.post/3kabc -> https://bsky.app/profile/<handle>/post/3kabc
    rkey = uri.rsplit("/", 1)[-1]
    return f"https://bsky.app/profile/{handle_or_did}/post/{rkey}"


class BlueskySearchCollector(Collector):
    """Bluesky keyword search. Bluesky refuses anonymous search, so this signs in with an app password."""

    name = "bluesky"
    source_type = "social"
    interval_minutes = 15
    requires = ("bluesky_handle", "bluesky_app_password")

    def __init__(self, settings):
        super().__init__(settings)
        self._token: str | None = None
        self._token_time = 0.0

    async def _login(self, client: httpx.AsyncClient) -> str:
        if self._token and time.time() - self._token_time < 3600:
            return self._token
        response = await client.post(
            f"{self.settings.bluesky_pds}/xrpc/com.atproto.server.createSession",
            json={"identifier": self.settings.bluesky_handle, "password": self.settings.bluesky_app_password},
        )
        response.raise_for_status()
        self._token, self._token_time = response.json()["accessJwt"], time.time()
        return self._token

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        token = await self._login(client)
        params = {"q": SOCIAL_QUERY, "sort": "latest", "limit": 100, "since": since.strftime("%Y-%m-%dT%H:%M:%SZ")}
        items: list[RawItem] = []
        cursor = None
        for _ in range(5):  # up to 500 posts per run
            if cursor:
                params["cursor"] = cursor
            response = await self.polite_get(
                client,
                f"{self.settings.bluesky_pds}/xrpc/app.bsky.feed.searchPosts",
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
            if response.status_code == 401:
                self._token = None
                token = await self._login(client)
                continue
            response.raise_for_status()
            data = response.json()
            items.extend(self.parse_post(p) for p in data.get("posts", []))
            cursor = data.get("cursor")
            if not cursor:
                break
        return items

    def parse_post(self, post: dict) -> RawItem:
        author = post.get("author", {})
        record = post.get("record", {})
        handle = author.get("handle") or author.get("did", "")
        return RawItem(
            source=self.name,
            source_type=self.source_type,
            url=bsky_post_url(post["uri"], handle),
            title="",
            text=clean_text(record.get("text")),
            published_at=parse_dt(record.get("createdAt") or post.get("indexedAt")),
            external_id=post.get("uri"),
            author=handle,
            outlet="Bluesky",
            extra={k: post.get(k) for k in ("likeCount", "repostCount", "replyCount") if post.get(k) is not None},
        )


class JetstreamListener:
    """Live Bluesky stream (Jetstream). Every new public post arrives within seconds; we keep the
    ones that mention data centers and hand them to the pipeline in small batches."""

    def __init__(self, settings, on_items: Callable[[list[RawItem]], Awaitable[None]], flush_seconds: int = 30):
        self.settings = settings
        self.on_items = on_items
        self.flush_seconds = flush_seconds
        self.cursor: int | None = None
        self.seen = 0
        self.kept = 0
        self.running = False

    @staticmethod
    def parse_event(event: dict) -> RawItem | None:
        if event.get("kind") != "commit":
            return None
        commit = event.get("commit") or {}
        if commit.get("operation") != "create" or commit.get("collection") != "app.bsky.feed.post":
            return None
        record = commit.get("record") or {}
        text = record.get("text") or ""
        langs = record.get("langs") or []
        if langs and "en" not in langs:
            return None
        if not mentions_data_center(text):
            return None
        did = event.get("did", "")
        return RawItem(
            source="bluesky_live",
            source_type="social",
            url=f"https://bsky.app/profile/{did}/post/{commit.get('rkey')}",
            title="",
            text=clean_text(text),
            published_at=parse_dt(record.get("createdAt")) or datetime.now(timezone.utc),
            external_id=f"at://{did}/app.bsky.feed.post/{commit.get('rkey')}",
            author=did,
            outlet="Bluesky",
        )

    async def run(self) -> None:
        import websockets

        self.running = True
        backoff = 2
        buffer: list[RawItem] = []
        last_flush = time.monotonic()
        while self.running:
            url = f"{self.settings.jetstream_url}?wantedCollections=app.bsky.feed.post"
            if self.cursor:
                url += f"&cursor={self.cursor - 5_000_000}"  # rewind 5s to avoid gaps on reconnect
            try:
                async with websockets.connect(url, max_size=2**22, ping_interval=30) as ws:
                    log.info("jetstream: connected")
                    backoff = 2
                    async for message in ws:
                        event = json.loads(message)
                        self.cursor = event.get("time_us", self.cursor)
                        self.seen += 1
                        item = self.parse_event(event)
                        if item:
                            buffer.append(item)
                            self.kept += 1
                        if buffer and time.monotonic() - last_flush > self.flush_seconds:
                            batch, buffer = buffer, []
                            last_flush = time.monotonic()
                            await self.on_items(batch)
                        if not self.running:
                            break
            except Exception as exc:  # network drops are normal; reconnect
                log.warning("jetstream: %s; reconnecting in %ss", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 120)

    def stop(self) -> None:
        self.running = False


class RedditCollector(Collector):
    """Reddit Data API. Reddit requires pre-approval for every app under its Responsible Builder
    Policy, so this stays off until REDDIT_CLIENT_ID/SECRET from an approved app are set.
    We never scrape reddit.com pages."""

    name = "reddit"
    source_type = "social"
    interval_minutes = 30
    requires = ("reddit_client_id", "reddit_client_secret")

    async def _token(self, client: httpx.AsyncClient) -> str:
        response = await client.post(
            "https://www.reddit.com/api/v1/access_token",
            data={"grant_type": "client_credentials"},
            auth=(self.settings.reddit_client_id, self.settings.reddit_client_secret),
        )
        response.raise_for_status()
        return response.json()["access_token"]

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        headers = {"Authorization": f"Bearer {await self._token(client)}"}
        paths = ["/search"] + [f"/r/{s}/search" for s in self.settings.csv(self.settings.reddit_subreddits)]
        items: list[RawItem] = []
        for path in paths:
            params = {"q": SUBREDDIT_QUERY, "sort": "new", "t": "week", "limit": 100, "type": "link"}
            if path != "/search":
                params["restrict_sr"] = 1
            response = await self.polite_get(client, f"https://oauth.reddit.com{path}", params=params, headers=headers)
            if response.status_code != 200:
                log.warning("reddit: HTTP %s for %s", response.status_code, path)
                continue
            for child in response.json().get("data", {}).get("children", []):
                item = self.parse_post(child.get("data", {}))
                if item and item.when() >= since:
                    items.append(item)
        return items

    def parse_post(self, d: dict) -> RawItem | None:
        if not d.get("permalink"):
            return None
        return RawItem(
            source=self.name,
            source_type=self.source_type,
            url=f"https://www.reddit.com{d['permalink']}",
            title=clean_text(d.get("title")),
            text=clean_text(d.get("selftext")),
            published_at=parse_dt(d.get("created_utc")),
            external_id=d.get("name"),
            author=None,  # deliberately not stored
            outlet=f"r/{d.get('subreddit')}",
            extra={"score": d.get("score"), "num_comments": d.get("num_comments"), "subreddit": d.get("subreddit")},
        )


class MastodonCollector(Collector):
    """Public hashtag timelines on a Mastodon server. No key needed on most servers."""

    name = "mastodon"
    source_type = "social"
    interval_minutes = 30

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        items: list[RawItem] = []
        for tag in MASTODON_TAGS:
            url = f"https://{self.settings.mastodon_instance}/api/v1/timelines/tag/{tag}"
            response = await self.polite_get(client, url, params={"limit": 40})
            if response.status_code != 200:
                log.warning("mastodon: HTTP %s for #%s", response.status_code, tag)
                continue
            for status in response.json():
                item = self.parse_status(status)
                if item.when() >= since:
                    items.append(item)
        return items

    def parse_status(self, s: dict) -> RawItem:
        return RawItem(
            source=self.name,
            source_type=self.source_type,
            url=s.get("url") or s.get("uri"),
            title="",
            text=clean_text(s.get("content")),
            published_at=parse_dt(s.get("created_at")),
            external_id=s.get("uri"),
            author=(s.get("account") or {}).get("acct"),
            outlet="Mastodon",
        )
