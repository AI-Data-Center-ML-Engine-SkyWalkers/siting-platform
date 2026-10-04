"""Search over analyzed items: filters in SQL, then semantic ranking with embeddings."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..models import Analysis, Embedding, Item
from .embeddings import from_bytes


@dataclass
class SearchFilters:
    state: str | None = None
    county_fips: str | None = None
    stance: str | None = None
    topic: str | None = None
    event_type: str | None = None
    source_type: str | None = None
    since: datetime | None = None
    min_severity: int | None = None
    relevant_only: bool = True


def filtered_query(f: SearchFilters):
    query = select(Item).outerjoin(Analysis).options(joinedload(Item.analysis))
    if f.relevant_only:
        query = query.where(Analysis.relevant.is_(True))
    if f.state:
        query = query.where(Item.state == f.state.upper())
    if f.county_fips:
        query = query.where(Item.county_fips == f.county_fips)
    if f.stance:
        query = query.where(Analysis.stance == f.stance)
    if f.topic:
        query = query.where(cast(Analysis.topics, String).like(f'%"{f.topic}"%'))
    if f.event_type:
        query = query.where(Analysis.event_type == f.event_type)
    if f.source_type:
        query = query.where(Item.source_type == f.source_type)
    if f.since:
        query = query.where(Item.published_at >= f.since)
    if f.min_severity:
        query = query.where(Analysis.severity >= f.min_severity)
    return query


def keyword_search(session: Session, q: str | None, f: SearchFilters, page: int, size: int) -> tuple[list[Item], int]:
    query = filtered_query(f)
    if q:
        like = f"%{q.lower()}%"
        query = query.where(
            or_(func.lower(Item.title).like(like), func.lower(Item.text).like(like), func.lower(Analysis.summary).like(like))
        )
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(query.order_by(Item.published_at.desc()).offset((page - 1) * size).limit(size)).unique().all()
    return list(rows), total


def semantic_search(
    session: Session, query_vector: np.ndarray, model: str, f: SearchFilters, page: int, size: int, pool: int = 5000
) -> tuple[list[tuple[Item, float]], int]:
    """Rank the most recent `pool` matching items by cosine similarity to the query."""
    candidates = session.scalars(filtered_query(f).order_by(Item.published_at.desc()).limit(pool)).unique().all()
    if not candidates:
        return [], 0
    ids = [c.id for c in candidates]
    vectors = {
        e.item_id: from_bytes(e.vector)
        for e in session.scalars(select(Embedding).where(Embedding.item_id.in_(ids), Embedding.model == model)).all()
    }
    scored = []
    for item in candidates:
        vec = vectors.get(item.id)
        if vec is not None and vec.shape[0] == query_vector.shape[0]:
            scored.append((item, float(np.dot(vec, query_vector))))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    start = (page - 1) * size
    return scored[start : start + size], len(scored)
