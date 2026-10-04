"""Command line for the pipeline.

    python -m app.cli sources                 list collectors and whether they are enabled
    python -m app.cli collect [--source gdelt] run collectors once (then analyze)
    python -m app.cli process                 analyze pending items
    python -m app.cli live                    stream Bluesky posts in real time (Ctrl+C to stop)
    python -m app.cli features [--fips 51107] print community features
    python -m app.cli probe-legistar <client> check a Legistar council name
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging

from .awareness.pipeline import Pipeline
from .awareness.sources.government import probe_legistar
from .config import settings
from .db import SessionLocal, init_db


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sources")
    collect = sub.add_parser("collect")
    collect.add_argument("--source")
    collect.add_argument("--no-process", action="store_true")
    sub.add_parser("process")
    sub.add_parser("live")
    features = sub.add_parser("features")
    features.add_argument("--fips")
    probe = sub.add_parser("probe-legistar")
    probe.add_argument("client")
    args = parser.parse_args()

    init_db()
    pipeline = Pipeline(settings)

    if args.cmd == "sources":
        for name, c in pipeline.collectors.items():
            state = "on " if c.enabled() else "off"
            need = f"  needs: {', '.join(c.requires) or 'config (see .env.example)'}" if not c.enabled() else ""
            print(f"[{state}] {name:<17} {c.source_type:<12} every {c.interval_minutes:>4} min{need}")
        print(f"AI chain: {' -> '.join(pipeline.analyzer.chain)} | embeddings: {pipeline.embedder.name}")
    elif args.cmd == "collect":
        if args.source:
            result = asyncio.run(pipeline.run_source(args.source))
            if not args.no_process:
                result = {"source": result, "processed": asyncio.run(pipeline.process_pending())}
        else:
            result = asyncio.run(pipeline.run_all(process=not args.no_process))
        print(json.dumps(result, indent=2, default=str))
    elif args.cmd == "process":
        print(json.dumps(asyncio.run(pipeline.process_pending()), indent=2))
    elif args.cmd == "live":
        print("Streaming Bluesky posts that mention data centers. Ctrl+C to stop.")
        try:
            asyncio.run(_live(pipeline))
        except KeyboardInterrupt:
            pass
    elif args.cmd == "features":
        with SessionLocal() as session:
            if args.fips:
                print(json.dumps(pipeline.features.for_fips(session, args.fips).as_dict(), indent=2))
            else:
                counties, states = pipeline.features.compute(session)
                print(json.dumps({"states": {k: v.as_dict() for k, v in states.items()},
                                  "counties": {k: v.as_dict() for k, v in counties.items()}}, indent=2))
    elif args.cmd == "probe-legistar":
        print(asyncio.run(probe_legistar(args.client)))


async def _live(pipeline: Pipeline) -> None:
    task = pipeline.start_jetstream()
    while True:
        await asyncio.sleep(30)
        print(pipeline.status()["live_stream"])
        if task.done():
            break


if __name__ == "__main__":
    main()
