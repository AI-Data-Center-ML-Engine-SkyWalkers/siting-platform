"""Step 3: re-rank the ML model's sites with community signals from the awareness engine.

    final = base x exp(b1 x N x confidence) x (1 + b2 x I) x (1 - b3 x R) x (0 if active moratorium)

N = net sentiment (-1..1), I = incentive signal (0..1), R = restriction signal (0..1).
Multiplying N by confidence means a county with two news items barely moves; one with fifty does.
"""
from __future__ import annotations

import math

from ..awareness.features import RegionFeatures
from .schemas import CommunityAdjustment, RerankedSite, SiteScore


def adjust(site: SiteScore, f: RegionFeatures, betas: dict[str, float]) -> tuple[float, CommunityAdjustment]:
    m_sent = math.exp(betas["sentiment"] * f.net_sentiment * f.confidence)
    m_inc = 1 + betas["incentive"] * f.incentive_signal
    m_res = 1 - betas["restriction"] * f.restriction_signal
    m_mor = 0.0 if f.active_moratorium else 1.0
    notes = []
    if f.illustrative:
        notes.append("Illustrative community signal from sample data, not collected items.")
    elif f.coverage == 0 and f.confidence == 0:
        notes.append("No community signals collected yet; score unchanged.")
    if f.active_moratorium:
        notes.append("Active moratorium reported by an official or established source.")
    if f.net_sentiment <= -0.2 and f.confidence >= 0.3:
        notes.append(f"Net opposition in local coverage ({f.coverage} items).")
    if f.net_sentiment >= 0.2 and f.confidence >= 0.3:
        notes.append(f"Net local support ({f.coverage} items).")
    if f.incentive_signal >= 0.2:
        notes.append("State or local incentives proposed or in place.")
    if f.restriction_signal >= 0.2:
        notes.append("Restrictions proposed or in place.")
    final = site.score * m_sent * m_inc * m_res * m_mor
    adj = CommunityAdjustment(
        net_sentiment=round(f.net_sentiment, 4),
        opposition_index=round(f.opposition_index, 4),
        support_index=round(f.support_index, 4),
        incentive_signal=round(f.incentive_signal, 4),
        restriction_signal=round(f.restriction_signal, 4),
        active_moratorium=f.active_moratorium,
        coverage=f.coverage,
        confidence=round(f.confidence, 4),
        illustrative=f.illustrative,
        multipliers={"sentiment": round(m_sent, 4), "incentive": round(m_inc, 4), "restriction": round(m_res, 4), "moratorium": m_mor},
        notes=notes,
    )
    return min(100.0, final), adj


def rerank(sites: list[SiteScore], features_for, betas: dict[str, float]) -> list[RerankedSite]:
    """features_for: callable(county_fips, site) -> RegionFeatures."""
    active = [s for s in sites if not s.excluded]
    base_order = sorted(active, key=lambda s: s.score, reverse=True)
    base_rank = {s.site_id: i + 1 for i, s in enumerate(base_order)}
    adjusted = []
    for s in active:
        f = features_for(s.county_fips, s) if s.county_fips else RegionFeatures(region="", level="county")
        final, adj = adjust(s, f, betas)
        adjusted.append((s, final, adj))
    adjusted.sort(key=lambda t: t[1], reverse=True)
    out = []
    for new_rank, (s, final, adj) in enumerate(adjusted, start=1):
        data = s.model_dump()
        data["rank"] = new_rank
        out.append(RerankedSite(
            **data,
            base_score=s.score,
            base_rank=base_rank[s.site_id],
            final_score=round(final, 2),
            final_rank=new_rank,
            rank_change=base_rank[s.site_id] - new_rank,
            community=adj,
        ))
    return out
