"""Illustrative candidate sites for the mock scoring provider.

Every value here is made up to follow plausible regional patterns. They exist so the app works
before the real ML model is connected. Do not present them as measurements.
"""
from __future__ import annotations

import math

PILLARS = {
    "power": "Power and carbon",
    "water": "Water",
    "climate": "Climate risk",
    "cooling": "Cooling",
    "land": "Land reuse",
    "community": "Community",
}

# id, pillar, label, better, unit
FACTORS = [
    ("carbon", "power", "Grid carbon", "low", "kg CO2/MWh"),
    ("tx_km", "power", "Distance to 230 kV+ line", "low", "km"),
    ("time_to_power", "power", "Time to power", "low", "years"),
    ("surplus_hours", "power", "Surplus renewable hours", "high", "% of hours"),
    ("water_stress", "water", "Baseline water stress", "low", "0-5"),
    ("plant_water", "water", "Power-plant water use", "low", "L/kWh"),
    ("hazard_risk", "climate", "Natural hazard risk", "low", "0-100"),
    ("free_cooling", "cooling", "Free-cooling hours", "high", "% of hours"),
    ("heat_reuse", "cooling", "Heat reuse potential", "high", "0-100"),
    ("reuse_km", "land", "Distance to brownfield or retired plant", "low", "km"),
    ("opposition", "community", "Opposition signals", "low", "count"),
    ("unemployment", "community", "Local economic need", "high", "%"),
]

# id, name, state, county FIPS, lat, lon, factor values (order above),
# attributes (heat_need, climate_adversity, land_cost_index, community_hint), exclusion
SITES = [
    ("dalles", "The Dalles", "OR", "41065", 45.60, -121.18, [280, 4, 4, 6, 1.5, 0.6, 35, 88, 30, 6, 2, 4.5], (35, 20, 35, 0.1), None),
    ("quincy", "Quincy", "WA", "53025", 47.23, -119.85, [260, 3, 3, 8, 2.5, 0.6, 30, 86, 20, 10, 3, 5.0], (30, 30, 25, 0.2), None),
    ("massena", "Massena", "NY", "36089", 44.93, -74.89, [220, 9, 5, 3, 0.5, 0.5, 20, 92, 25, 1, 2, 6.0], (65, 55, 15, 0.3), None),
    ("buffalo", "Buffalo", "NY", "36029", 42.89, -78.88, [300, 6, 4, 3, 0.5, 1.2, 30, 89, 70, 2, 3, 4.8], (75, 45, 30, 0.0), None),
    ("desmoines", "Des Moines", "IA", "19153", 41.59, -93.62, [400, 8, 3, 11, 1.0, 1.4, 40, 82, 45, 12, 1, 3.2], (60, 45, 30, 0.3), None),
    ("rochester", "Rochester", "MN", "27109", 44.02, -92.47, [420, 12, 4, 7, 1.0, 1.6, 35, 88, 75, 15, 2, 3.0], (80, 60, 30, 0.1), None),
    ("amarillo", "Amarillo", "TX", "48375", 35.22, -101.83, [380, 6, 2, 18, 4.2, 1.5, 55, 70, 20, 20, 1, 3.5], (25, 35, 15, 0.4), None),
    ("abilene", "Abilene", "TX", "48441", 32.45, -99.73, [440, 7, 2, 14, 3.8, 1.3, 50, 58, 15, 18, 2, 3.8], (15, 40, 15, 0.3), None),
    ("ashburn", "Ashburn", "VA", "51107", 39.04, -77.49, [520, 2, 6, 1, 1.8, 1.8, 30, 72, 50, 15, 9, 2.6], (50, 20, 95, -0.5), None),
    ("columbus", "Columbus", "OH", "39049", 39.96, -83.00, [560, 5, 5, 1, 1.0, 2.0, 35, 76, 60, 3, 4, 3.9], (60, 30, 55, -0.2), None),
    ("indiana", "Indiana", "PA", "42063", 40.62, -79.15, [540, 1, 3, 1, 0.8, 2.0, 25, 80, 55, 1, 3, 5.2], (60, 40, 20, 0.1), None),
    ("atlanta", "Atlanta", "GA", "13121", 33.75, -84.39, [480, 5, 4, 0.5, 2.0, 1.9, 50, 55, 30, 8, 5, 3.6], (30, 35, 70, -0.3), None),
    ("phoenix", "Phoenix", "AZ", "04013", 33.45, -112.07, [420, 4, 4, 7, 4.8, 1.7, 60, 40, 10, 10, 6, 3.8], (5, 70, 60, -0.4), "Extreme water stress with no dry-cooling plan (illustrative)"),
    ("reno", "Reno", "NV", "32031", 39.53, -119.81, [400, 9, 4, 5, 4.4, 1.4, 50, 78, 35, 14, 3, 4.6], (40, 40, 45, 0.0), None),
    ("cheyenne", "Cheyenne", "WY", "56021", 41.14, -104.82, [650, 3, 3, 10, 3.5, 2.2, 35, 87, 40, 2, 1, 3.4], (55, 60, 15, 0.4), None),
    ("lakecharles", "Lake Charles", "LA", "22019", 30.23, -93.22, [470, 6, 3, 2, 1.0, 1.8, 85, 45, 15, 4, 2, 4.5], (10, 80, 20, 0.2), "Inside a coastal storm surge zone (illustrative)"),
    ("redding", "Redding", "CA", "06089", 40.59, -122.39, [300, 7, 5, 9, 3.0, 0.9, 75, 65, 20, 12, 2, 5.8], (30, 60, 40, 0.0), "Very high wildfire hazard (illustrative)"),
    ("chicago", "Chicago", "IL", "17031", 41.88, -87.63, [430, 3, 4, 3, 1.2, 2.1, 45, 80, 85, 1, 4, 4.9], (85, 45, 75, -0.1), None),
    ("knoxville", "Knoxville", "TN", "47093", 35.96, -83.92, [380, 6, 4, 1, 0.8, 1.9, 40, 66, 35, 5, 3, 3.4], (35, 30, 35, 0.1), None),
    ("bismarck", "Bismarck", "ND", "38015", 46.81, -100.78, [700, 15, 3, 12, 2.0, 2.0, 30, 90, 50, 3, 1, 2.4], (70, 70, 10, 0.3), None),
    ("fairbanks", "Fairbanks", "AK", "02090", 64.84, -147.72, [550, 8, 4, 0, 0.3, 1.0, 30, 98, 95, 5, 1, 5.5], (98, 92, 20, 0.3), None),
    ("williamson", "Williamson", "WV", "54059", 37.67, -82.28, [820, 6, 3, 0.5, 0.5, 2.3, 45, 78, 40, 2, 1, 9.5], (45, 45, 10, 0.4), None),
]


def _percentiles(values: list[float], better: str) -> list[float]:
    n = len(values)
    out = []
    for v in values:
        worse = sum(1 for o in values if (o > v if better == "low" else o < v))
        ties = sum(1 for o in values if o == v)
        out.append((worse + (ties - 1) / 2) / (n - 1))
    return out


def score_sites(weights: dict[str, float] | None = None) -> list[dict]:
    """Weighted geometric mean of factor percentiles, the same method as the prototype map."""
    weights = {p: float((weights or {}).get(p, 1.0)) for p in PILLARS}
    total = sum(weights.values()) or 1.0
    per_pillar = {p: sum(1 for f in FACTORS if f[1] == p) for p in PILLARS}
    v = [weights[f[1]] / total / per_pillar[f[1]] for f in FACTORS]
    pct = [_percentiles([s[6][j] for s in SITES], f[3]) for j, f in enumerate(FACTORS)]
    lnx = [[math.log(0.05 + 0.95 * pct[j][i]) for j in range(len(FACTORS))] for i in range(len(SITES))]
    scored = [i for i, s in enumerate(SITES) if not s[8]]
    mean = [sum(lnx[i][j] for i in scored) / len(scored) for j in range(len(FACTORS))]
    out = []
    for i, (sid, name, st, fips, lat, lon, vals, attrs, excl) in enumerate(SITES):
        score = 100 * math.exp(sum(v[j] * lnx[i][j] for j in range(len(FACTORS))))
        contrib = sorted(((v[j] * (lnx[i][j] - mean[j]), j) for j in range(len(FACTORS))), reverse=True)
        pillars = {}
        for p in PILLARS:
            js = [j for j, f in enumerate(FACTORS) if f[1] == p]
            pillars[p] = round(100 * math.exp(sum(lnx[i][j] for j in js) / len(js)), 1)
        out.append({
            "site_id": sid,
            "name": f"{name}, {st}",
            "state": st,
            "county_fips": fips,
            "lat": lat,
            "lon": lon,
            "score": 0.0 if excl else round(score, 1),
            "pillars": pillars,
            "factors": {f[0]: vals[j] for j, f in enumerate(FACTORS)},
            "pros": [f"{FACTORS[j][2]}: {vals[j]} {FACTORS[j][4]}" for c, j in contrib[:3] if c > 0.001],
            "cons": [f"{FACTORS[j][2]}: {vals[j]} {FACTORS[j][4]}" for c, j in reversed(contrib[-3:]) if c < -0.001],
            "excluded": bool(excl),
            "exclusion_reason": excl,
            "attributes": {
                "heat_need": attrs[0],
                "climate_adversity": attrs[1],
                "land_cost_index": attrs[2],
                "community_hint": attrs[3],
                "unemployment": vals[11],
                "time_to_power_years": vals[2],
                "tx_km": vals[1],
                "water_stress": vals[4],
            },
        })
    ranked = sorted((s for s in out if not s["excluded"]), key=lambda s: s["score"], reverse=True)
    for r, s in enumerate(ranked, start=1):
        s["rank"] = r
    return ranked + [s for s in out if s["excluded"]]
