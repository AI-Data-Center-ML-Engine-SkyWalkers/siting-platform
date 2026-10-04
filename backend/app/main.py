"""FastAPI app. Run: uvicorn app.main:app --reload (from backend/)."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import awareness, engine, integration, scoring, tradeoff
from .awareness.pipeline import Pipeline
from .awareness.scheduler import start_scheduler
from .config import settings
from .db import init_db
from .scoring.providers import build_provider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    app.state.pipeline = Pipeline(settings)
    app.state.scoring = build_provider(settings)
    scheduler, live = None, None
    if settings.enable_scheduler:
        scheduler = start_scheduler(app.state.pipeline)
    if settings.enable_jetstream:
        live = app.state.pipeline.start_jetstream()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)
    if live:
        app.state.pipeline.jetstream.stop()
        live.cancel()
        try:
            await live
        except asyncio.CancelledError:
            pass


app = FastAPI(title=f"{settings.app_name} API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_methods=["*"], allow_headers=["*"])
for module in (scoring, tradeoff, engine, awareness, integration):
    app.include_router(module.router)


@app.get("/api/health")
def health():
    pipeline = app.state.pipeline
    return {
        "status": "ok",
        "app": settings.app_name,
        "scoring_provider": app.state.scoring.name,
        "ai_chain": pipeline.analyzer.chain,
        "embedder": pipeline.embedder.name,
        "scheduler": settings.enable_scheduler,
        "live_stream": settings.enable_jetstream,
    }


# Serve the built React app (npm run build) from the same server, with SPA fallback.
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = FRONTEND_DIST / path
        if path and target.is_file():
            return FileResponse(target)
        return FileResponse(FRONTEND_DIST / "index.html")
