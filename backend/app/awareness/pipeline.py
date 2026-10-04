"""The awareness pipeline:

    collect (no AI) -> keyword filter -> canonicalize + dedupe -> geotag -> store
    -> enrich article text -> AI analysis -> embeddings -> features -> alerts

Each collector runs on its own schedule; process_pending() handles everything after storage.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import Analysis, Embedding, Item, SourceRun
from . import alerts as alerts_mod
from .analyze import Analyzer
from .base import CREDIBILITY, RawItem, log
from .embeddings import HashingEmbedder, get_embedder, to_bytes
from .enrich import fetch_text
from .features import FeatureStore
from .geo import find_county, geotag
from .keywords import mentions_data_center
from .normalize import canonicalize_url, clean_text, content_hash, domain_of, jaccard, shingles
from .sources import JetstreamListener, build_collectors

FIRST_RUN_DAYS = {"legislation": 90, "government": 30}
NEEDS_TEXT = {"gdelt", "mediacloud"}  # headline-only sources worth enriching


class Pipeline:
    def __init__(self, settings, session_factory=SessionLocal):
        self.settings = settings
        self.session_factory = session_factory
        self.collectors = build_collectors(settings)
        self.analyzer = Analyzer(settings)
        self.embedder = get_embedder(settings)
        self.features = FeatureStore(settings.half_life_days)
        self.jetstream: JetstreamListener | None = None
        self._lock = asyncio.Lock()

    def http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=30, headers={"User-Agent": self.settings.user_agent}, follow_redirects=True)

    # ---------- Collection ----------
    def _since(self, session: Session, name: str, source_type: str) -> datetime:
        last = session.scalar(
            select(func.max(SourceRun.started_at)).where(SourceRun.source == name, SourceRun.ok.is_(True))
        )
        if last:
            last = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
            return last - timedelta(minutes=10)  # small overlap; duplicates are dropped
        return datetime.now(timezone.utc) - timedelta(days=FIRST_RUN_DAYS.get(source_type, 7))

    async def run_source(self, name: str) -> dict:
        collector = self.collectors[name]
        if not collector.enabled():
            return {"source": name, "skipped": True, "reason": f"missing settings: {', '.join(collector.requires) or 'config'}"}
        with self.session_factory() as session:
            since = self._since(session, name, collector.source_type)
            run = SourceRun(source=name)
            session.add(run)
            session.commit()
            run_id = run.id
        fetched, inserted, updated, ok, message = 0, [], [], True, ""
        try:
            async with self.http() as client:
                raw = await collector.collect(client, since)
            fetched = len(raw)
            inserted, updated = self.ingest(raw)
        except Exception as exc:
            ok, message = False, str(exc)[:500]
            log.exception("collector %s failed", name)
        with self.session_factory() as session:
            run = session.get(SourceRun, run_id)
            run.finished_at = datetime.now(timezone.utc)
            run.fetched, run.inserted, run.updated, run.ok, run.message = fetched, len(inserted), len(updated), ok, message
            session.commit()
        return {"source": name, "fetched": fetched, "inserted": len(inserted), "updated": len(updated), "ok": ok, "message": message}

    async def run_all(self, process: bool = True) -> dict:
        reports = await asyncio.gather(*(self.run_source(name) for name in self.collectors))
        processed = await self.process_pending() if process else {}
        return {"sources": list(reports), "processed": processed}

    # ---------- Storage ----------
    def ingest(self, raw_items: list[RawItem]) -> tuple[list[int], list[int]]:
        inserted, updated = [], []
        with self.session_factory() as session:
            recent = session.execute(
                select(Item.id, Item.title, Item.text, Item.cluster_id).where(
                    Item.published_at >= datetime.now(timezone.utc) - timedelta(days=7)
                )
            ).all()
            recent_shingles = [(r.cluster_id or r.id, shingles(r.title or r.text[:200])) for r in recent]
            seen_urls: set[str] = set()
            for raw in raw_items:
                if not raw.url:
                    continue
                title, text = clean_text(raw.title, 1000), clean_text(raw.text)
                official = raw.source_type in ("legislation", "government")
                if not official and not mentions_data_center(title, text):
                    continue  # keyword gate: no AI cost for off-topic items
                canonical = canonicalize_url(raw.url)
                if canonical in seen_urls:
                    continue
                seen_urls.add(canonical)
                existing = session.scalar(select(Item).where(Item.canonical_url == canonical))
                if existing:
                    if raw.version_key and raw.version_key != existing.version_key:
                        existing.version_key = raw.version_key
                        existing.title, existing.text = title or existing.title, text or existing.text
                        existing.extra = {**(existing.extra or {}), **raw.extra}
                        existing.updated_at = datetime.now(timezone.utc)
                        existing.needs_analysis = True
                        updated.append(existing.id)
                    continue
                state, fips, method = raw.state, raw.county_fips, "source" if (raw.state or raw.county_fips) else None
                if not fips:
                    tag_state, tag_fips, tag_method = geotag(f"{title}. {text[:3000]}", state)
                    if tag_fips or (tag_state and not state):
                        state, fips, method = tag_state, tag_fips, tag_method
                item = Item(
                    source=raw.source,
                    source_type=raw.source_type,
                    external_id=raw.external_id,
                    url=raw.url,
                    canonical_url=canonical,
                    title=title,
                    text=text,
                    author=raw.author,
                    outlet=raw.outlet or domain_of(raw.url),
                    published_at=raw.when(),
                    content_hash=content_hash(title, text),
                    version_key=raw.version_key,
                    credibility=CREDIBILITY.get(raw.source_type, 0.5),
                    state=state,
                    county_fips=fips,
                    geo_method=method,
                    extra=raw.extra,
                )
                # Near-duplicate clustering: same story from several outlets shares a cluster
                sh = shingles(title or text[:200])
                for cluster, other in recent_shingles:
                    if jaccard(sh, other) >= 0.6:
                        item.cluster_id = cluster
                        break
                session.add(item)
                session.flush()
                if item.cluster_id is None:
                    item.cluster_id = item.id
                recent_shingles.append((item.cluster_id, sh))
                inserted.append(item.id)
            session.commit()
        return inserted, updated

    async def ingest_live(self, raw_items: list[RawItem]) -> None:
        """Callback for the Bluesky live stream."""
        inserted, _ = self.ingest(raw_items)
        if inserted:
            await self.process_pending(limit=len(inserted))

    # ---------- Processing ----------
    async def process_pending(self, limit: int = 200) -> dict:
        async with self._lock:
            with self.session_factory() as session:
                pending = session.scalars(
                    select(Item).where(Item.needs_analysis.is_(True)).order_by(Item.published_at.desc()).limit(limit)
                ).all()
                if not pending:
                    return {"analyzed": 0, "alerts": 0, "providers": self.analyzer.chain}
                await self._enrich(pending)
                session.commit()
                copied = self._copy_cluster_analyses(session, pending)
                to_analyze = [p for p in pending if p.id not in copied]
                results = await self.analyzer.analyze([self._as_prompt_item(p) for p in to_analyze])
                by_id = {p.id: p for p in pending}
                for r in results:
                    self._store_analysis(session, by_id[r.item_id], r)
                for p in pending:
                    p.needs_analysis = False
                session.commit()
                relevant = [p for p in pending if p.analysis and p.analysis.relevant]
                await self._embed(session, relevant)
                self.features.invalidate()
                county_f, state_f = self.features.compute(session)
                new_alerts = alerts_mod.event_alerts(session, [p.id for p in relevant])
                new_alerts += alerts_mod.sentiment_alerts(session, county_f, state_f)
                session.commit()
                await alerts_mod.dispatch(session, new_alerts, self.settings.alert_webhook_url)
                providers = sorted({r.provider for r in results})
                return {"analyzed": len(results), "copied": len(copied), "relevant": len(relevant), "alerts": len(new_alerts), "providers": providers}

    async def _enrich(self, items: list[Item]) -> None:
        if not self.settings.enrich_article_text:
            return
        targets = [i for i in items if i.source in NEEDS_TEXT and len(i.text or "") < 200][: self.settings.enrich_max_per_run]
        if not targets:
            return
        async with self.http() as client:
            texts = await asyncio.gather(*(fetch_text(client, i.url, self.settings.user_agent) for i in targets))
        for item, text in zip(targets, texts):
            if text:
                item.text = clean_text(text)
                if not item.county_fips:
                    state, fips, method = geotag(f"{item.title}. {item.text[:3000]}", item.state)
                    if fips:
                        item.state, item.county_fips, item.geo_method = state, fips, method

    def _copy_cluster_analyses(self, session: Session, pending: list[Item]) -> set[int]:
        """Syndicated copies (same text hash) reuse the first copy's analysis instead of paying again."""
        copied = set()
        for item in pending:
            if item.analysis is not None:
                continue
            twin = session.scalar(
                select(Item).join(Analysis).where(Item.content_hash == item.content_hash, Item.id != item.id, Item.needs_analysis.is_(False))
            )
            if twin and twin.analysis:
                a = twin.analysis
                session.add(Analysis(
                    item_id=item.id, provider="copy", model=a.model, relevant=a.relevant, stance=a.stance, topics=a.topics,
                    event_type=a.event_type, severity=a.severity, summary=a.summary, evidence=a.evidence,
                    evidence_verified=a.evidence_verified, confidence=a.confidence, location=a.location, entities=a.entities,
                ))
                copied.add(item.id)
        session.flush()
        return copied

    def _as_prompt_item(self, item: Item) -> dict:
        limit = self.settings.max_text_chars
        return {
            "id": item.id,
            "source": item.source,
            "source_type": item.source_type,
            "outlet": item.outlet,
            "title": item.title,
            "text": (item.text or "")[:limit],
            "published": item.published_at.strftime("%Y-%m-%d") if item.published_at else None,
            "state": item.state,
        }

    def _store_analysis(self, session: Session, item: Item, result) -> None:
        a = result.analysis
        row = item.analysis or Analysis(item_id=item.id)
        row.provider, row.model = result.provider, result.model
        row.relevant, row.stance, row.topics, row.event_type = a.relevant, a.stance, list(a.topics), a.event_type
        row.severity, row.summary, row.evidence = a.severity, a.summary, a.evidence
        row.evidence_verified, row.confidence = result.evidence_verified, a.confidence
        row.location = {"state": a.state, "county": a.county, "city": a.city}
        row.entities = {"companies": a.companies, "bill_number": a.bill_number, "event_date": a.event_date}
        row.analyzed_at = datetime.now(timezone.utc)
        if item.analysis is None:
            session.add(row)
            item.analysis = row
        # The model can place items the gazetteer could not
        if a.state and len(a.state) == 2 and not item.state:
            item.state, item.geo_method = a.state.upper(), "ai"
        if a.county and not item.county_fips:
            match = find_county(a.county, item.state or a.state)
            if match:
                item.county_fips, item.state, item.geo_method = match.fips, match.state, "ai"

    async def _embed(self, session: Session, items: list[Item]) -> None:
        todo = [i for i in items if session.get(Embedding, i.id) is None]
        if not todo:
            return
        texts = [f"{i.title}. {i.analysis.summary}. {(i.text or '')[:1500]}" for i in todo]
        try:
            vectors = await self.embedder.aembed(texts, "document")
        except Exception as exc:
            log.warning("embeddings failed, using local hashing embedder: %s", exc)
            self.embedder = HashingEmbedder()
            vectors = await self.embedder.aembed(texts, "document")
        for item, vec in zip(todo, vectors):
            session.add(Embedding(item_id=item.id, model=self.embedder.name, dim=len(vec), vector=to_bytes(vec)))
        session.commit()

    # ---------- Live stream ----------
    def start_jetstream(self) -> asyncio.Task:
        self.jetstream = JetstreamListener(self.settings, self.ingest_live)
        return asyncio.create_task(self.jetstream.run())

    def status(self) -> dict:
        with self.session_factory() as session:
            sources = []
            for name, c in self.collectors.items():
                last = session.scalar(select(SourceRun).where(SourceRun.source == name).order_by(SourceRun.id.desc()).limit(1))
                sources.append({
                    "source": name,
                    "type": c.source_type,
                    "enabled": c.enabled(),
                    "requires": list(c.requires),
                    "interval_minutes": c.interval_minutes,
                    "last_run": last.started_at.isoformat() if last else None,
                    "last_ok": last.ok if last else None,
                    "last_fetched": last.fetched if last else None,
                    "last_inserted": last.inserted if last else None,
                    "last_message": last.message if last else None,
                })
            counts = {
                "items": session.scalar(select(func.count(Item.id))) or 0,
                "analyzed": session.scalar(select(func.count(Analysis.id))) or 0,
                "relevant": session.scalar(select(func.count(Analysis.id)).where(Analysis.relevant.is_(True))) or 0,
                "pending": session.scalar(select(func.count(Item.id)).where(Item.needs_analysis.is_(True))) or 0,
            }
        live = None
        if self.jetstream:
            live = {"running": self.jetstream.running, "seen": self.jetstream.seen, "kept": self.jetstream.kept}
        return {"sources": sources, "counts": counts, "ai_chain": self.analyzer.chain, "embedder": self.embedder.name, "live_stream": live}
