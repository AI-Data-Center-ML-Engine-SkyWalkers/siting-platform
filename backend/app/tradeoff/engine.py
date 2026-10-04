"""Trade-off engine framed on the iMasons Social Accord.

This does not rate communities or certify projects. Each site is scored as how well
a project fits that place, and what it gives back. Eighteen indicators sit under
three dimensions:

  Economic     durable local value
  Social       opportunity and wellbeing
  Ecological   healthy natural systems

Each indicator is a net impact on the place, 0-100 (benefits minus burdens).
Users weight the three dimensions, and may fine-tune individual indicators.
A do-no-harm floor (for example, no indicator below 30) keeps a site from winning
on tax revenue while wrecking the water cycle.

Waste heat and jobs are two examples inside ecological carbon/climate and
economic job creation, not separate objectives.

See https://imasons.org/the-imasons-social-accord/
"""
from __future__ import annotations

from pydantic import BaseModel, Field

DIMENSIONS = ["economic", "social", "ecological"]
DIMENSION_META = {
    "economic": {"label": "Economic", "blurb": "Durable local value."},
    "social": {"label": "Social", "blurb": "Opportunity and wellbeing."},
    "ecological": {"label": "Ecological", "blurb": "Healthy natural systems."},
}

# id, dimension, label, short radar label, how we measure it, measured|estimated
INDICATORS: list[tuple[str, str, str, str, str, str]] = [
    ("tax_revenue", "economic", "Tax revenue", "Tax", "Projected property tax minus abatements from incentive bills", "estimated"),
    ("price_stability", "economic", "Price stability", "Prices", "Residential electricity rate risk from utility rate cases and large-load tariffs", "estimated"),
    ("capital_investment", "economic", "Capital investment", "Capital", "Project investment relative to county GDP", "estimated"),
    ("economic_efficiency", "economic", "Economic efficiency", "Efficiency", "Cost per MW: land, power price and time to power", "estimated"),
    ("gdp_contribution", "economic", "GDP contribution", "GDP", "County GDP plus indirect effects from the jobs multiplier", "estimated"),
    ("jobs_wages", "economic", "Job creation and wages", "Jobs", "Direct and indirect jobs against BLS wages and Census unemployment", "measured"),
    ("digital_equity", "social", "Digital equity", "Digital", "Whether the project brings fiber to unserved areas on the FCC broadband map", "estimated"),
    ("access_utilities", "social", "Access to utilities", "Utilities", "Shared grid and water upgrades that also serve residents", "estimated"),
    ("education", "social", "Education", "Education", "Local colleges (NCES) and committed training programs", "estimated"),
    ("sense_of_place", "social", "Sense of place", "Place", "Distance to historic sites, parks and homes, and zoning fit", "estimated"),
    ("health_wellbeing", "social", "Health and wellbeing", "Health", "Homes in the noise range, generator emissions and CDC PLACES health data", "estimated"),
    ("equity_inclusion", "social", "Equity and inclusion", "Equity", "Whether burdens fall on vulnerable neighborhoods (CDC Social Vulnerability Index)", "measured"),
    ("carbon_climate", "ecological", "Carbon and climate", "Carbon", "Grid marginal emissions, embodied carbon and heat reuse", "measured"),
    ("air_quality", "ecological", "Air quality", "Air", "EPA nonattainment areas and backup generator emissions", "measured"),
    ("water_quality", "ecological", "Water quality", "Water Q", "EPA impaired waters (ATTAINS) and cooling discharge", "estimated"),
    ("water_cycle", "ecological", "Water cycle", "Water", "WRI Aqueduct water stress and cooling water consumption", "measured"),
    ("biodiversity", "ecological", "Biodiversity", "Wildlife", "Critical habitat and protected areas", "estimated"),
    ("soil", "ecological", "Soil", "Soil", "Prime farmland on the USDA soil survey", "measured"),
]

INDICATOR_IDS = [row[0] for row in INDICATORS]
INDICATOR_META = {
    i: {"dimension": d, "label": label, "short": short, "how": how, "kind": kind}
    for i, d, label, short, how, kind in INDICATORS
}
BY_DIMENSION = {d: [i for i, dim, *_ in INDICATORS if dim == d] for d in DIMENSIONS}

TENSION_PAIRS = [
    ("tax_revenue", "price_stability"),
    ("capital_investment", "sense_of_place"),
    ("economic_efficiency", "water_cycle"),
    ("jobs_wages", "water_cycle"),
    ("jobs_wages", "soil"),
    ("access_utilities", "price_stability"),
    ("economic_efficiency", "equity_inclusion"),
    ("carbon_climate", "water_cycle"),
]


class TradeoffParams(BaseModel):
    dimensions: dict[str, float] = Field(
        default_factory=lambda: {"economic": 34, "social": 33, "ecological": 33}
    )
    indicators: dict[str, float] = Field(
        default_factory=dict,
        description="Optional per-indicator weights. Missing keys default to 1.",
    )
    min_indicator: float | None = Field(
        30, ge=0, le=100, description="Do-no-harm floor. Sites with any indicator below this are left out."
    )
    exclude_moratoria: bool = True
    states_include: list[str] = Field(default_factory=list)
    states_exclude: list[str] = Field(default_factory=list)
    max_per_state: int | None = Field(2, ge=1, description="Spread the shortlist across states")
    top_n: int = Field(10, ge=1, le=50)


PRESETS = {
    "balanced": TradeoffParams(),
    "economic": TradeoffParams(dimensions={"economic": 60, "social": 20, "ecological": 20}),
    "social": TradeoffParams(dimensions={"economic": 20, "social": 60, "ecological": 20}),
    "ecological": TradeoffParams(dimensions={"economic": 20, "social": 20, "ecological": 60}),
}

DISCLAIMER = (
    "SitewellEco² does not rate communities or certify projects. "
    "It shows how well a project fits this place, and what it gives back. "
    "Values are labeled measured or estimated. Measured values in this demo are illustrative."
)


def clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def r1(x: float) -> float:
    return round(x + 1e-9, 1)


def _get(site: dict, *keys: str, default: float = 0.0) -> float:
    f = site.get("factors") or {}
    a = site.get("attributes") or {}
    for k in keys:
        if f.get(k) is not None:
            return float(f[k])
        if a.get(k) is not None:
            try:
                return float(a[k])
            except (TypeError, ValueError):
                continue
    return default


def accord_profiles(site: dict, community: dict) -> tuple[dict[str, float], dict[str, float], list[str]]:
    """Return (baseline, with_project, notes) for the 18 indicators."""
    carbon = _get(site, "carbon", default=420)
    tx = _get(site, "tx_km", default=8)
    ttp = _get(site, "time_to_power", "time_to_power_years", default=4)
    surplus = _get(site, "surplus_hours", default=4)
    water = _get(site, "water_stress", default=2)
    plant_w = _get(site, "plant_water", default=1.5)
    hazard = _get(site, "hazard_risk", default=40)
    free_c = _get(site, "free_cooling", default=70)
    heat = _get(site, "heat_reuse", default=40)
    reuse_km = _get(site, "reuse_km", default=10)
    opposition = _get(site, "opposition", default=3)
    unemp = _get(site, "unemployment", default=4)
    land = _get(site, "land_cost_index", default=50)
    heat_need = _get(site, "heat_need", default=40)
    adversity = _get(site, "climate_adversity", default=40)
    hint = _get(site, "community_hint", default=0)

    tax_abate = clamp(12 + 0.25 * land + 15 * max(0.0, -hint), 8, 55)
    rate_risk = clamp(12 + carbon / 16 + ttp * 5 + max(0.0, 8 - surplus) * 2, 8, 90)
    inv_gdp = clamp(28 + (100 - land) * 0.38 + unemp * 4.2, 15, 95)
    college = clamp(22 + max(0.0, 20 - reuse_km) * 1.6 + (18 if land > 50 else 6), 10, 90)
    place_pressure = clamp(12 + opposition * 7 + land * 0.22, 8, 92)
    svi = clamp(16 + unemp * 5.2 + max(0.0, -hint) * 22, 10, 92)
    broadband_gap = clamp(12 + (100 - land) * 0.28 + unemp * 2.2, 8, 85)
    farmland = clamp(8 + (100 - land) * 0.42 + water * 6, 5, 92)
    habitat = clamp(16 + max(0.0, reuse_km - 4) * 2.2 + water * 3.5, 8, 90)
    air = clamp(12 + carbon / 28 + (100 - free_c) * 0.18 + opposition * 2.5, 8, 90)

    carbon_n = clamp((carbon - 200) / 7)
    ttp_n = clamp((ttp - 1) / 6 * 100)
    tx_n = clamp(tx / 20 * 100)
    plant_n = clamp(plant_w / 3 * 100)
    water_n = clamp(water / 5 * 100)

    sentiment = float(community.get("net_sentiment") or 0)
    restriction = float(community.get("restriction_signal") or 0)
    incentive = float(community.get("incentive_signal") or 0)
    moratorium = bool(community.get("active_moratorium"))

    baseline = {
        "tax_revenue": 48,
        "price_stability": clamp(100 - 0.55 * rate_risk),
        "capital_investment": 20,
        "economic_efficiency": 50,
        "gdp_contribution": 32,
        "jobs_wages": clamp(34 + unemp * 2.2),
        "digital_equity": clamp(100 - broadband_gap),
        "access_utilities": clamp(62 - 0.35 * ttp_n),
        "education": college,
        "sense_of_place": clamp(100 - place_pressure),
        "health_wellbeing": clamp(100 - 0.45 * air - 0.28 * hazard),
        "equity_inclusion": clamp(100 - svi),
        "carbon_climate": clamp(100 - carbon_n),
        "air_quality": clamp(100 - air),
        "water_quality": clamp(100 - 0.55 * plant_n - 0.25 * water_n),
        "water_cycle": clamp(100 - water_n),
        "biodiversity": clamp(100 - habitat),
        "soil": clamp(100 - 0.55 * farmland),
    }

    heat_bonus = 0.22 * (heat / 100) * (heat_need / 100)
    jobs_reach = clamp(20 + unemp * 8, 15, 80)
    shared_upgrades = clamp(18 + ttp_n * 0.25 + tx_n * 0.15)
    who_pays = clamp(rate_risk * 0.35 + tax_abate * 0.4)

    project = {
        "tax_revenue": clamp(baseline["tax_revenue"] + 0.42 * inv_gdp * (1 - tax_abate / 100) - incentive * 12),
        "price_stability": clamp(baseline["price_stability"] - 0.38 * rate_risk + 0.08 * surplus),
        "capital_investment": clamp(0.25 * baseline["capital_investment"] + 0.75 * inv_gdp),
        "economic_efficiency": clamp(100 - 0.38 * land - 0.34 * ttp_n - 0.20 * tx_n - 0.08 * carbon_n),
        "gdp_contribution": clamp(28 + 0.45 * inv_gdp + 0.28 * jobs_reach),
        "jobs_wages": clamp(22 + jobs_reach + max(0.0, hint) * 8),
        "digital_equity": clamp(baseline["digital_equity"] + 0.45 * broadband_gap),
        "access_utilities": clamp(baseline["access_utilities"] + shared_upgrades - who_pays),
        "education": clamp(college + 8 + max(0.0, hint) * 6),
        "sense_of_place": clamp(
            baseline["sense_of_place"] - opposition * 4 - 0.15 * inv_gdp + (12 if reuse_km <= 3 else 0) + sentiment * 8 - restriction * 18
        ),
        "health_wellbeing": clamp(baseline["health_wellbeing"] - 0.18 * air - 0.12 * adversity + 0.15 * free_c),
        "equity_inclusion": clamp(baseline["equity_inclusion"] - 0.22 * svi + 0.12 * jobs_reach - (8 if land < 25 and svi > 50 else 0)),
        "carbon_climate": clamp(baseline["carbon_climate"] + 18 * heat_bonus + 0.08 * surplus - 0.12 * carbon_n),
        "air_quality": clamp(baseline["air_quality"] - 0.16 * (100 - free_c) + 0.05 * surplus),
        "water_quality": clamp(baseline["water_quality"] - 0.22 * plant_n - 0.10 * water_n),
        "water_cycle": clamp(baseline["water_cycle"] - 0.28 * water_n - 0.12 * plant_n + 8 * heat_bonus),
        "biodiversity": clamp(baseline["biodiversity"] - 0.18 * habitat + (10 if reuse_km <= 3 else -6)),
        "soil": clamp(baseline["soil"] - 0.32 * farmland + (12 if reuse_km <= 3 else 0)),
    }
    if moratorium:
        project["sense_of_place"] = r1(clamp(project["sense_of_place"] * 0.35))
        project["equity_inclusion"] = r1(clamp(project["equity_inclusion"] * 0.7))

    notes: list[str] = []
    if tax_abate >= 30 and project["tax_revenue"] < baseline["tax_revenue"] + 8:
        notes.append("Incentives attract the project but shrink the tax that stays local.")
    if water >= 3.5:
        notes.append("Water stress is high: evaporative cooling would save energy but use water the place cannot spare.")
    if reuse_km <= 3:
        notes.append("Reusing a brownfield or retired plant protects farmland and habitat relative to a greenfield.")
    if heat_need >= 70 and heat >= 50:
        notes.append("Local heating demand can take waste heat, which is one way the project gives carbon and climate value back.")
    if unemp >= 5.5:
        notes.append(f"Unemployment is {unemp:.1f}%, so job creation and wages count more here than in a tight labor market.")
    if svi >= 55 and land < 30:
        notes.append("Cheap land here overlaps a more vulnerable community, so equity and inclusion is a live tension.")

    return {k: r1(v) for k, v in baseline.items()}, {k: r1(v) for k, v in project.items()}, notes


def tensions_for(baseline: dict[str, float], project: dict[str, float]) -> list[str]:
    found = []
    for a, b in TENSION_PAIRS:
        da = project[a] - baseline[a]
        db = project[b] - baseline[b]
        la, lb = INDICATOR_META[a]["label"], INDICATOR_META[b]["label"]
        if da >= 8 and db <= -8:
            found.append(f"{la} up, {lb} down")
        elif db >= 8 and da <= -8:
            found.append(f"{lb} up, {la} down")
    return found


def _normalize(raw: dict[str, float], keys: list[str]) -> dict[str, float]:
    total = sum(max(0.0, raw.get(k, 0)) for k in keys) or 1.0
    return {k: max(0.0, raw.get(k, 0)) / total for k in keys}


def indicator_weights(p: TradeoffParams) -> dict[str, float]:
    dim_w = _normalize(p.dimensions, DIMENSIONS)
    out: dict[str, float] = {}
    for d in DIMENSIONS:
        ids = BY_DIMENSION[d]
        inner = {i: float(p.indicators.get(i, 1.0)) for i in ids}
        inner_n = _normalize(inner, ids)
        for i in ids:
            out[i] = dim_w[d] * inner_n[i]
    return out


def dimension_scores(project: dict[str, float], p: TradeoffParams) -> dict[str, float]:
    scores = {}
    for d in DIMENSIONS:
        ids = BY_DIMENSION[d]
        inner = {i: float(p.indicators.get(i, 1.0)) for i in ids}
        inner_n = _normalize(inner, ids)
        scores[d] = r1(sum(inner_n[i] * project[i] for i in ids))
    return scores


def pareto_flags(rows: list[dict], keys: list[str]) -> None:
    for r in rows:
        r["pareto"] = not any(
            all(o["dimensions"][k] >= r["dimensions"][k] for k in keys)
            and any(o["dimensions"][k] > r["dimensions"][k] for k in keys)
            for o in rows
            if o is not r
        )


def evaluate(sites: list[dict], community_for, p: TradeoffParams) -> dict:
    weights = indicator_weights(p)
    dim_w = _normalize(p.dimensions, DIMENSIONS)
    active = [d for d in DIMENSIONS if dim_w[d] > 0]
    feasible, excluded = [], []
    for s in sites:
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
        if reason:
            excluded.append({"site_id": s["site_id"], "name": s["name"], "state": s["state"], "reason": reason})
            continue
        baseline, project, notes = accord_profiles(s, community)
        if p.min_indicator is not None:
            weak = [i for i in INDICATOR_IDS if project[i] < p.min_indicator]
            if weak:
                worst = min(weak, key=lambda i: project[i])
                excluded.append({
                    "site_id": s["site_id"],
                    "name": s["name"],
                    "state": s["state"],
                    "reason": (
                        f"{INDICATOR_META[worst]['label']} is {project[worst]:.0f}, "
                        f"below the do-no-harm floor of {p.min_indicator:.0f}"
                    ),
                })
                continue
        dims = dimension_scores(project, p)
        utility = r1(sum(dim_w[d] * dims[d] for d in DIMENSIONS))
        feasible.append({
            "site_id": s["site_id"],
            "name": s["name"],
            "state": s["state"],
            "county_fips": s.get("county_fips"),
            "lat": s["lat"],
            "lon": s["lon"],
            "utility": utility,
            "dimensions": dims,
            "indicators": project,
            "baseline": baseline,
            "deltas": {i: r1(project[i] - baseline[i]) for i in INDICATOR_IDS},
            "tensions": tensions_for(baseline, project),
            "notes": notes,
        })
    feasible.sort(key=lambda r: r["utility"], reverse=True)
    best = {i: max((r["indicators"][i] for r in feasible), default=100) for i in INDICATOR_IDS}
    for r in feasible:
        r["best"] = {i: r1(best[i]) for i in INDICATOR_IDS}
    pareto_flags(feasible, active)
    per_state: dict[str, int] = {}
    shortlist = 0
    for rank, r in enumerate(feasible, start=1):
        r["rank"] = rank
        r["selected"] = False
        if shortlist < p.top_n and (p.max_per_state is None or per_state.get(r["state"], 0) < p.max_per_state):
            r["selected"] = True
            per_state[r["state"]] = per_state.get(r["state"], 0) + 1
            shortlist += 1
        r["strengths"] = [
            DIMENSION_META[d]["label"]
            for d, _ in sorted(r["dimensions"].items(), key=lambda kv: kv[1], reverse=True)[:2]
        ]
    return {
        "weights": dim_w,
        "indicator_weights": weights,
        "results": feasible,
        "excluded": excluded,
        "best_profile": {i: r1(best[i]) for i in INDICATOR_IDS},
        "indicators": [
            {"id": i, "dimension": d, "label": label, "short": short, "how": how, "kind": kind}
            for i, d, label, short, how, kind in INDICATORS
        ],
        "dimensions": DIMENSION_META,
        "disclaimer": DISCLAIMER,
    }
