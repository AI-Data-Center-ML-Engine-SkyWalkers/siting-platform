"""Turn analyzed items into community features per county and state (the step 3 inputs).

Each item counts by source credibility x severity x recency (half-life, default 30 days),
and less when its evidence quote could not be verified. Counties with little coverage are
pulled toward their state average, so one viral post cannot swing a county.
"""
from __future__ import annotations

import math
import time
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..models import Analysis, Item
from .analyze import TOPIC_LABELS
from .geo import county as county_info

K_SATURATION = 1.5  # raw weight that maps to ~0.5 on the 0-1 indices
K_SHRINK = 3.0  # items needed before a county's own signal outweighs its state's
INCENTIVE_EVENTS = {"incentive"}
RESTRICTION_EVENTS = {"moratorium", "restriction"}
BILL_EVENTS = {"bill_introduced", "bill_advanced", "bill_passed"}


@dataclass
class RegionFeatures:
    region: str
    level: str  # county | state
    opposition_index: float = 0.0
    support_index: float = 0.0
    net_sentiment: float = 0.0
    incentive_signal: float = 0.0
    restriction_signal: float = 0.0
    active_moratorium: bool = False
    momentum: float = 0.0
    coverage: int = 0
    confidence: float = 0.0
    concerns: list = field(default_factory=list)  # [(topic, weight)]
    positives: list = field(default_factory=list)
    item_ids: list = field(default_factory=list)
    illustrative: bool = False  # True only for sample signals used with the mock scoring provider

    def as_dict(self) -> dict:
        d = asdict(self)
        d["concerns"] = [{"topic": t, "label": TOPIC_LABELS.get(t, t), "weight": round(w, 3)} for t, w in self.concerns]
        d["positives"] = [{"topic": t, "label": TOPIC_LABELS.get(t, t), "weight": round(w, 3)} for t, w in self.positives]
        for key in ("opposition_index", "support_index", "net_sentiment", "incentive_signal", "restriction_signal", "momentum", "confidence"):
            d[key] = round(d[key], 4)
        return d


class _Acc:
    def __init__(self):
        self.opp = self.sup = self.inc = self.res = 0.0
        self.recent_opp = self.prior_opp = 0.0
        self.count = 0
        self.moratorium = False
        self.concerns: Counter = Counter()
        self.positives: Counter = Counter()
        self.items: list[tuple[float, int]] = []


def _saturate(x: float) -> float:
    return 1.0 - math.exp(-x / K_SATURATION)


def _finish(region: str, level: str, acc: _Acc) -> RegionFeatures:
    momentum = math.tanh((acc.recent_opp / 30.0 - acc.prior_opp / 60.0) / 0.05)
    return RegionFeatures(
        region=region,
        level=level,
        opposition_index=_saturate(acc.opp),
        support_index=_saturate(acc.sup),
        net_sentiment=(acc.sup - acc.opp) / (acc.sup + acc.opp + 1.0),
        incentive_signal=_saturate(acc.inc),
        restriction_signal=_saturate(acc.res),
        active_moratorium=acc.moratorium,
        momentum=momentum,
        coverage=acc.count,
        confidence=acc.count / (acc.count + K_SHRINK),
        concerns=acc.concerns.most_common(5),
        positives=acc.positives.most_common(5),
        item_ids=[i for _, i in sorted(acc.items, reverse=True)[:10]],
    )


class FeatureStore:
    """Computes features for all regions; cached for a minute because it scans the analyses."""

    def __init__(self, half_life_days: float = 30.0, lookback_days: int = 365):
        self.half_life = half_life_days
        self.lookback = lookback_days
        self._cache: tuple[float, dict, dict] | None = None

    def invalidate(self) -> None:
        self._cache = None

    def compute(self, session: Session, now: datetime | None = None) -> tuple[dict[str, RegionFeatures], dict[str, RegionFeatures]]:
        if self._cache and time.time() - self._cache[0] < 60 and now is None:
            return self._cache[1], self._cache[2]
        now = now or datetime.now(timezone.utc)
        rows = session.scalars(
            select(Item)
            .join(Analysis)
            .options(joinedload(Item.analysis))
            .where(Analysis.relevant.is_(True), Item.published_at >= now - timedelta(days=self.lookback))
        ).unique().all()
        counties: dict[str, _Acc] = defaultdict(_Acc)
        states: dict[str, _Acc] = defaultdict(_Acc)
        for item in rows:
            a = item.analysis
            if not a:
                continue
            published = item.published_at if item.published_at.tzinfo else item.published_at.replace(tzinfo=timezone.utc)
            age = max(0.0, (now - published).total_seconds() / 86400)
            decay = 0.5 ** (age / self.half_life)
            weight = item.credibility * (0.5 + a.severity / 5) * max(0.3, a.confidence) * (1.0 if a.evidence_verified else 0.6)
            targets = []
            if item.county_fips:
                targets.append(counties[item.county_fips])
            if item.state:
                targets.append(states[item.state])
            for acc in targets:
                self._add(acc, item, a, weight, decay, age)
        state_features = {s: _finish(s, "state", acc) for s, acc in states.items()}
        county_features = {}
        for fips, acc in counties.items():
            f = _finish(fips, "county", acc)
            info = county_info(fips)
            st = state_features.get(info.state) if info else None
            if st:  # shrink toward the state, and inherit state-level policy signals
                n, k = f.coverage, K_SHRINK
                f.net_sentiment = (n * f.net_sentiment + k * st.net_sentiment) / (n + k)
                f.opposition_index = (n * f.opposition_index + k * st.opposition_index) / (n + k)
                f.support_index = (n * f.support_index + k * st.support_index) / (n + k)
                f.incentive_signal = max(f.incentive_signal, st.incentive_signal)
                f.restriction_signal = max(f.restriction_signal, 0.5 * st.restriction_signal)
            county_features[fips] = f
        self._cache = (time.time(), county_features, state_features)
        return county_features, state_features

    @staticmethod
    def _add(acc: _Acc, item: Item, a: Analysis, weight: float, decay: float, age: float) -> None:
        w = weight * decay
        acc.count += 1
        acc.items.append((w, item.id))
        if a.stance == "oppose":
            acc.opp += w
        elif a.stance == "support":
            acc.sup += w
        elif a.stance == "mixed":
            acc.opp += w / 2
            acc.sup += w / 2
        if a.stance in ("oppose", "mixed"):
            if age <= 30:
                acc.recent_opp += weight
            elif age <= 90:
                acc.prior_opp += weight
            for t in a.topics[:3]:
                acc.concerns[t] += w
        if a.stance in ("support", "mixed"):
            for t in a.topics[:3]:
                acc.positives[t] += w
        is_bill = a.event_type in BILL_EVENTS
        if a.event_type in INCENTIVE_EVENTS or (is_bill and "tax_breaks" in a.topics and a.stance != "oppose"):
            acc.inc += w
        if a.event_type in RESTRICTION_EVENTS or (is_bill and a.stance == "oppose"):
            acc.res += w
        if a.event_type == "moratorium" and a.severity >= 4 and item.credibility >= 0.8 and age <= 365:
            acc.moratorium = True

    def for_fips(self, session: Session, fips: str) -> RegionFeatures:
        """Features for one county; falls back to its state when the county has no coverage."""
        counties, states = self.compute(session)
        if fips in counties:
            return counties[fips]
        info = county_info(fips)
        st = states.get(info.state) if info else None
        if st:
            return RegionFeatures(
                region=fips, level="county", opposition_index=st.opposition_index, support_index=st.support_index,
                net_sentiment=st.net_sentiment, incentive_signal=st.incentive_signal,
                restriction_signal=0.5 * st.restriction_signal, coverage=0,
                confidence=0.5 * st.confidence, concerns=st.concerns, positives=st.positives, item_ids=st.item_ids,
            )
        return RegionFeatures(region=fips, level="county")
