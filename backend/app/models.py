"""Tables for scraped items, AI analyses, embeddings, alerts and source health."""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Item(Base):
    """One scraped record: an article, post, bill, council matter or federal notice."""

    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(40), index=True)  # gdelt, openstates, bluesky...
    source_type: Mapped[str] = mapped_column(String(20), index=True)  # legislation|government|news|advocacy|social
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    url: Mapped[str] = mapped_column(Text)
    canonical_url: Mapped[str] = mapped_column(String(1000), unique=True, index=True)
    title: Mapped[str] = mapped_column(Text, default="")
    text: Mapped[str] = mapped_column(Text, default="")
    author: Mapped[str | None] = mapped_column(String(200), nullable=True)
    outlet: Mapped[str | None] = mapped_column(String(200), nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    version_key: Mapped[str | None] = mapped_column(String(200), nullable=True)  # bill status / change hash
    credibility: Mapped[float] = mapped_column(Float, default=0.5)
    state: Mapped[str | None] = mapped_column(String(2), index=True, nullable=True)
    county_fips: Mapped[str | None] = mapped_column(String(5), index=True, nullable=True)
    geo_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    cluster_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    needs_analysis: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)

    analysis: Mapped["Analysis | None"] = relationship(back_populates="item", uselist=False, cascade="all, delete-orphan")


class Analysis(Base):
    """What the AI (or the keyword rules) concluded about one item."""

    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(20))  # gemini | claude | rules
    model: Mapped[str] = mapped_column(String(80))
    relevant: Mapped[bool] = mapped_column(Boolean, index=True)
    stance: Mapped[str] = mapped_column(String(10), index=True)  # support|oppose|neutral|mixed
    topics: Mapped[list] = mapped_column(JSON, default=list)
    event_type: Mapped[str] = mapped_column(String(30), index=True)
    severity: Mapped[int] = mapped_column(Integer, default=1)
    summary: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[str] = mapped_column(Text, default="")
    evidence_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    location: Mapped[dict] = mapped_column(JSON, default=dict)  # {state, county, city}
    entities: Mapped[dict] = mapped_column(JSON, default=dict)  # {companies, bill_number, event_date}
    analyzed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    item: Mapped[Item] = relationship(back_populates="analysis")


class Embedding(Base):
    __tablename__ = "embeddings"

    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), primary_key=True)
    model: Mapped[str] = mapped_column(String(80), index=True)
    dim: Mapped[int] = mapped_column(Integer)
    vector: Mapped[bytes] = mapped_column(LargeBinary)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    severity: Mapped[int] = mapped_column(Integer, default=3)
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[str | None] = mapped_column(String(2), nullable=True, index=True)
    county_fips: Mapped[str | None] = mapped_column(String(5), nullable=True)
    item_ids: Mapped[list] = mapped_column(JSON, default=list)
    dedupe_key: Mapped[str] = mapped_column(String(200), unique=True)
    rule_ids: Mapped[list] = mapped_column(JSON, default=list)


class AlertRule(Base):
    """A watchlist: which regions, topics and alert kinds someone wants to hear about."""

    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    states: Mapped[list] = mapped_column(JSON, default=list)
    county_fips: Mapped[list] = mapped_column(JSON, default=list)
    topics: Mapped[list] = mapped_column(JSON, default=list)
    kinds: Mapped[list] = mapped_column(JSON, default=list)
    min_severity: Mapped[int] = mapped_column(Integer, default=1)
    webhook_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RegionSnapshot(Base):
    """Daily community indices per county or state, used as the baseline for sentiment-shift alerts."""

    __tablename__ = "region_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    region: Mapped[str] = mapped_column(String(5), index=True)  # county FIPS or state code
    day: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    opposition: Mapped[float] = mapped_column(Float)
    support: Mapped[float] = mapped_column(Float)
    net: Mapped[float] = mapped_column(Float)
    coverage: Mapped[int] = mapped_column(Integer)


class SourceRun(Base):
    __tablename__ = "source_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(40), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fetched: Mapped[int] = mapped_column(Integer, default=0)
    inserted: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    message: Mapped[str] = mapped_column(Text, default="")
