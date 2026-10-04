"""Runs each enabled collector on its own interval, then processes what it found."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .base import log


def start_scheduler(pipeline) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="UTC")

    async def run(name: str):
        report = await pipeline.run_source(name)
        if report.get("inserted") or report.get("updated"):
            processed = await pipeline.process_pending()
            log.info("%s: %s | processed: %s", name, report, processed)

    start = datetime.now(timezone.utc) + timedelta(seconds=5)
    for i, (name, collector) in enumerate(pipeline.collectors.items()):
        if not collector.enabled():
            continue
        scheduler.add_job(
            run, "interval", minutes=collector.interval_minutes, args=[name], id=name,
            max_instances=1, coalesce=True,
            next_run_time=start + timedelta(seconds=10 * i),  # stagger the first runs
        )
        log.info("scheduled %s every %s min", name, collector.interval_minutes)
    scheduler.start()
    return scheduler
