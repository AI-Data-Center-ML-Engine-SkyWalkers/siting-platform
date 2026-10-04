"""The contract between the ML scoring model (step 2) and everything downstream.

Your teammates' model only has to return RankResponse-shaped JSON; see docs/INTEGRATION.md.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class SiteScore(BaseModel):
    site_id: str
    name: str
    state: str = Field(description="Two-letter state code")
    county_fips: str | None = Field(default=None, description="5-digit county FIPS, used to join community signals")
    lat: float
    lon: float
    score: float = Field(ge=0, le=100, description="Sustainability score from the ML model")
    rank: int | None = None
    pillars: dict[str, float] = Field(default_factory=dict, description="Pillar scores 0-100")
    factors: dict[str, float | None] = Field(default_factory=dict, description="Raw factor values")
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)
    excluded: bool = False
    exclusion_reason: str | None = None
    attributes: dict[str, float | str | None] = Field(
        default_factory=dict,
        description="Extra inputs for the Social Accord trade-off engine: land, water, jobs, heat and community context",
    )


class RankRequest(BaseModel):
    n: int = Field(default=10, ge=1, le=500)
    weights: dict[str, float] | None = None


class RankResponse(BaseModel):
    model_version: str
    illustrative: bool = False
    sites: list[SiteScore]


class CommunityAdjustment(BaseModel):
    net_sentiment: float
    opposition_index: float
    support_index: float
    incentive_signal: float
    restriction_signal: float
    active_moratorium: bool
    coverage: int
    confidence: float
    illustrative: bool = False
    multipliers: dict[str, float]
    notes: list[str]


class RerankedSite(SiteScore):
    base_score: float
    base_rank: int
    final_score: float
    final_rank: int
    rank_change: int
    community: CommunityAdjustment


class RerankResponse(BaseModel):
    model_version: str
    illustrative: bool
    betas: dict[str, float]
    sites: list[RerankedSite]
