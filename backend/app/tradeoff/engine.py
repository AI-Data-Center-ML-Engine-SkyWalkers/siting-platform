"""Trade-off engine for site engineers and real estate developers (step 4).

Five objectives, each scored 0-100 per site, weighted by the user:
  sustainability   the ML score (after community re-ranking when available)
  speed_to_power   time to interconnect and distance to high-voltage lines
  cost             land cost and climate adversity (construction, logistics)
  community        local sentiment, restrictions and moratoria from the awareness engine
  ecosystem        what the site gives back: waste heat where heating demand is high, and jobs
                   (direct plus indirect: hotels, travel, services) where unemployment is high

Ecosystem thinking can offset a con: valuing heat reuse reduces the harsh-climate cost penalty
where local heating demand can absorb the waste heat (the Alaska example).
"""
from __future__ import annotations

from pydantic import BaseModel, Field

OBJECTIVES = ["sustainability", "speed_to_power", "cost", "community", "ecosystem"]
OBJECTIVE_LABELS = {
    "sustainability": "Sustainability",
    "speed_to_power": "Speed to power",
    "cost": "Cost",
    "community": "Community acceptance",
    "ecosystem": "Ecosystem benefit",
}


class TradeoffParams(BaseModel):
    objectives: dict[str, float] = Field(
        default_factory=lambda: {"sustainability": 40, "speed_to_power": 20, "cost": 15, "community": 15, "ecosystem": 10}
    )
    heat_reuse_value: float = Field(0.5, ge=0, le=1, description="How much you value reusing waste heat")
    jobs_value: float = Field(0.5, ge=0, le=1, description="How much you value job creation where it is needed")
    jobs_multiplier: float = Field(2.0, ge=1, le=5, description="Total jobs per direct job (direct + indirect)")
    max_water_stress: float | None = Field(4.0, ge=0, le=5)
    max_time_to_power_years: float | None = None
    min_sustainability: float | None = None
    exclude_moratoria: bool = True
    states_include: list[str] = Field(default_factory=list)
    states_exclude: list[str] = Field(default_factory=list)
    max_per_state: int | None = Field(2, ge=1, description="Spread the shortlist across states")
    top_n: int = Field(10, ge=1, le=50)


PRESETS = {
    "balanced": TradeoffParams(),
    "speed": TradeoffParams(objectives={"sustainability": 25, "speed_to_power": 45, "cost": 20, "community": 10, "ecosystem": 0}),
    "community": TradeoffParams(objectives={"sustainability": 25, "speed_to_power": 10, "cost": 10, "community": 40, "ecosystem": 15}),
    "ecosystem": TradeoffParams(
        objectives={"sustainability": 30, "speed_to_power": 10, "cost": 10, "community": 15, "ecosystem": 35},
        heat_reuse_value=0.9, jobs_value=0.9, jobs_multiplier=2.5,
    ),
}


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def objective_scores(site: dict, community: dict, p: TradeoffParams) -> tuple[dict[str, float], list[str]]:
    a = site.get("attributes") or {}
    notes: list[str] = []
    ttp = float(a.get("time_to_power_years") or 4)
    tx = float(a.get("tx_km") or 10)
    speed = 100 * (0.7 * clamp(1 - (ttp - 1) / 6) + 0.3 * clamp(1 - tx / 20))

    heat_need = float(a.get("heat_need") or 0) / 100
    adversity = float(a.get("climate_adversity") or 0) / 100
    land = float(a.get("land_cost_index") or 50) / 100
    offset = p.heat_reuse_value * heat_need  # waste heat put to use softens the harsh-climate penalty
    cost = 100 * (1 - (0.6 * land + 0.4 * adversity * (1 - offset)))
    if adversity >= 0.6 and offset >= 0.4:
        notes.append("Harsh climate, but strong local heating demand can use the waste heat, which offsets part of the penalty.")

    net = float(community.get("net_sentiment", 0))
    restriction = float(community.get("restriction_signal", 0))
    community_score = 0.0 if community.get("active_moratorium") else clamp(0.5 + 0.5 * net - 0.3 * restriction) * 100

    unemployment = float(a.get("unemployment") or 0)
    jobs_need = clamp((unemployment - 2.5) / 6)
    jobs_reach = clamp(p.jobs_multiplier / 3)  # more indirect jobs per direct job, more benefit
    weights = p.heat_reuse_value + p.jobs_value
    ecosystem = 100 * ((p.heat_reuse_value * heat_need + p.jobs_value * jobs_need * jobs_reach) / weights) if weights else 0.0
    if jobs_need >= 0.4 and p.jobs_value > 0:
        notes.append(
            f"Unemployment is {unemployment:.1f}%: about {p.jobs_multiplier:.1f} jobs per direct job "
            "(hotels, travel, services) count in its favor."
        )
    if heat_need >= 0.7 and p.heat_reuse_value > 0:
        notes.append("High heating demand nearby: waste heat could warm local buildings or greenhouses.")

    scores = {
        "sustainability": float(site.get("final_score", site.get("score", 0))),
        "speed_to_power": speed,
        "cost": cost,
        "community": community_score,
        "ecosystem": ecosystem,
    }
    return {k: round(v, 1) for k, v in scores.items()}, notes


def pareto_flags(rows: list[dict], active: list[str]) -> None:
    for r in rows:
        r["pareto"] = not any(
            all(o["objectives"][k] >= r["objectives"][k] for k in active)
            and any(o["objectives"][k] > r["objectives"][k] for k in active)
            for o in rows if o is not r
        )


def evaluate(sites: list[dict], community_for, p: TradeoffParams) -> dict:
    """sites: SiteScore-like dicts (optionally re-ranked). community_for: fips -> feature dict."""
    total_w = sum(max(0.0, p.objectives.get(k, 0)) for k in OBJECTIVES) or 1.0
    weights = {k: max(0.0, p.objectives.get(k, 0)) / total_w for k in OBJECTIVES}
    active = [k for k in OBJECTIVES if weights[k] > 0]
    feasible, excluded = [], []
    for s in sites:
        a = s.get("attributes") or {}
        community = community_for(s.get("county_fips"), s) or {}
        reason = None
        if s.get("excluded"):
            reason = s.get("exclusion_reason") or "Excluded by the scoring model"
        elif p.states_include and s["state"] not in p.states_include:
            reason = "Outside the states you selected"
        elif s["state"] in p.states_exclude:
            reason = "In a state you excluded"
        elif p.exclude_moratoria and community.get("active_moratorium"):
            reason = "Active moratorium"
        elif p.max_water_stress is not None and a.get("water_stress") is not None and float(a["water_stress"]) > p.max_water_stress:
            reason = f"Water stress {a['water_stress']} is above your limit of {p.max_water_stress}"
        elif p.max_time_to_power_years is not None and a.get("time_to_power_years") is not None and float(a["time_to_power_years"]) > p.max_time_to_power_years:
            reason = f"Time to power {a['time_to_power_years']} years is above your limit"
        elif p.min_sustainability is not None and float(s.get("final_score", s.get("score", 0))) < p.min_sustainability:
            reason = "Sustainability score below your minimum"
        if reason:
            excluded.append({"site_id": s["site_id"], "name": s["name"], "state": s["state"], "reason": reason})
            continue
        objectives, notes = objective_scores(s, community, p)
        contributions = {k: round(weights[k] * objectives[k], 2) for k in OBJECTIVES}
        feasible.append({
            "site_id": s["site_id"],
            "name": s["name"],
            "state": s["state"],
            "county_fips": s.get("county_fips"),
            "lat": s["lat"],
            "lon": s["lon"],
            "utility": round(sum(contributions.values()), 2),
            "objectives": objectives,
            "contributions": contributions,
            "notes": notes,
        })
    feasible.sort(key=lambda r: r["utility"], reverse=True)
    pareto_flags(feasible, active)
    # Shortlist: best utility, at most max_per_state per state
    per_state: dict[str, int] = {}
    shortlist = 0
    for rank, r in enumerate(feasible, start=1):
        r["rank"] = rank
        r["selected"] = False
        if shortlist < p.top_n and (p.max_per_state is None or per_state.get(r["state"], 0) < p.max_per_state):
            r["selected"] = True
            per_state[r["state"]] = per_state.get(r["state"], 0) + 1
            shortlist += 1
        top_two = sorted(r["contributions"].items(), key=lambda kv: kv[1], reverse=True)[:2]
        r["strengths"] = [OBJECTIVE_LABELS[k] for k, _ in top_two]
    return {"weights": weights, "results": feasible, "excluded": excluded, "objective_labels": OBJECTIVE_LABELS}
