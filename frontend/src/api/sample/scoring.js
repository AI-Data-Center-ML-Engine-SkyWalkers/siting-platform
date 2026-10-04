// Sample-mode twin of the backend's mock scoring provider, community re-ranking and trade-off
// engine (backend/app/scoring and backend/app/tradeoff). Same shapes, same math, illustrative values.

export const PILLARS = {
  power: 'Power and carbon',
  water: 'Water',
  climate: 'Climate risk',
  cooling: 'Cooling',
  land: 'Land reuse',
  community: 'Community',
};

export const FACTORS = [
  ['carbon', 'power', 'Grid carbon', 'low', 'kg CO2/MWh'],
  ['tx_km', 'power', 'Distance to 230 kV+ line', 'low', 'km'],
  ['time_to_power', 'power', 'Time to power', 'low', 'years'],
  ['surplus_hours', 'power', 'Surplus renewable hours', 'high', '% of hours'],
  ['water_stress', 'water', 'Baseline water stress', 'low', 'out of 5'],
  ['plant_water', 'water', 'Power-plant water use', 'low', 'L/kWh'],
  ['hazard_risk', 'climate', 'Natural hazard risk', 'low', 'out of 100'],
  ['free_cooling', 'cooling', 'Free-cooling hours', 'high', '% of hours'],
  ['heat_reuse', 'cooling', 'Heat reuse potential', 'high', 'out of 100'],
  ['reuse_km', 'land', 'Distance to brownfield or retired plant', 'low', 'km'],
  ['opposition', 'community', 'Opposition signals', 'low', 'count'],
  ['unemployment', 'community', 'Local economic need', 'high', '%'],
];

// id, name, state, county FIPS, lat, lon, factor values, [heat_need, climate_adversity, land_cost, community_hint], exclusion
const SITES = [
  ['dalles', 'The Dalles', 'OR', '41065', 45.6, -121.18, [280, 4, 4, 6, 1.5, 0.6, 35, 88, 30, 6, 2, 4.5], [35, 20, 35, 0.1], null],
  ['quincy', 'Quincy', 'WA', '53025', 47.23, -119.85, [260, 3, 3, 8, 2.5, 0.6, 30, 86, 20, 10, 3, 5.0], [30, 30, 25, 0.2], null],
  ['massena', 'Massena', 'NY', '36089', 44.93, -74.89, [220, 9, 5, 3, 0.5, 0.5, 20, 92, 25, 1, 2, 6.0], [65, 55, 15, 0.3], null],
  ['buffalo', 'Buffalo', 'NY', '36029', 42.89, -78.88, [300, 6, 4, 3, 0.5, 1.2, 30, 89, 70, 2, 3, 4.8], [75, 45, 30, 0.0], null],
  ['desmoines', 'Des Moines', 'IA', '19153', 41.59, -93.62, [400, 8, 3, 11, 1.0, 1.4, 40, 82, 45, 12, 1, 3.2], [60, 45, 30, 0.3], null],
  ['rochester', 'Rochester', 'MN', '27109', 44.02, -92.47, [420, 12, 4, 7, 1.0, 1.6, 35, 88, 75, 15, 2, 3.0], [80, 60, 30, 0.1], null],
  ['amarillo', 'Amarillo', 'TX', '48375', 35.22, -101.83, [380, 6, 2, 18, 4.2, 1.5, 55, 70, 20, 20, 1, 3.5], [25, 35, 15, 0.4], null],
  ['abilene', 'Abilene', 'TX', '48441', 32.45, -99.73, [440, 7, 2, 14, 3.8, 1.3, 50, 58, 15, 18, 2, 3.8], [15, 40, 15, 0.3], null],
  ['ashburn', 'Ashburn', 'VA', '51107', 39.04, -77.49, [520, 2, 6, 1, 1.8, 1.8, 30, 72, 50, 15, 9, 2.6], [50, 20, 95, -0.5], null],
  ['columbus', 'Columbus', 'OH', '39049', 39.96, -83.0, [560, 5, 5, 1, 1.0, 2.0, 35, 76, 60, 3, 4, 3.9], [60, 30, 55, -0.2], null],
  ['indiana', 'Indiana', 'PA', '42063', 40.62, -79.15, [540, 1, 3, 1, 0.8, 2.0, 25, 80, 55, 1, 3, 5.2], [60, 40, 20, 0.1], null],
  ['atlanta', 'Atlanta', 'GA', '13121', 33.75, -84.39, [480, 5, 4, 0.5, 2.0, 1.9, 50, 55, 30, 8, 5, 3.6], [30, 35, 70, -0.3], null],
  ['phoenix', 'Phoenix', 'AZ', '04013', 33.45, -112.07, [420, 4, 4, 7, 4.8, 1.7, 60, 40, 10, 10, 6, 3.8], [5, 70, 60, -0.4], 'Extreme water stress with no dry-cooling plan (illustrative)'],
  ['reno', 'Reno', 'NV', '32031', 39.53, -119.81, [400, 9, 4, 5, 4.4, 1.4, 50, 78, 35, 14, 3, 4.6], [40, 40, 45, 0.0], null],
  ['cheyenne', 'Cheyenne', 'WY', '56021', 41.14, -104.82, [650, 3, 3, 10, 3.5, 2.2, 35, 87, 40, 2, 1, 3.4], [55, 60, 15, 0.4], null],
  ['lakecharles', 'Lake Charles', 'LA', '22019', 30.23, -93.22, [470, 6, 3, 2, 1.0, 1.8, 85, 45, 15, 4, 2, 4.5], [10, 80, 20, 0.2], 'Inside a coastal storm surge zone (illustrative)'],
  ['redding', 'Redding', 'CA', '06089', 40.59, -122.39, [300, 7, 5, 9, 3.0, 0.9, 75, 65, 20, 12, 2, 5.8], [30, 60, 40, 0.0], 'Very high wildfire hazard (illustrative)'],
  ['chicago', 'Chicago', 'IL', '17031', 41.88, -87.63, [430, 3, 4, 3, 1.2, 2.1, 45, 80, 85, 1, 4, 4.9], [85, 45, 75, -0.1], null],
  ['knoxville', 'Knoxville', 'TN', '47093', 35.96, -83.92, [380, 6, 4, 1, 0.8, 1.9, 40, 66, 35, 5, 3, 3.4], [35, 30, 35, 0.1], null],
  ['bismarck', 'Bismarck', 'ND', '38015', 46.81, -100.78, [700, 15, 3, 12, 2.0, 2.0, 30, 90, 50, 3, 1, 2.4], [70, 70, 10, 0.3], null],
  ['fairbanks', 'Fairbanks', 'AK', '02090', 64.84, -147.72, [550, 8, 4, 0, 0.3, 1.0, 30, 98, 95, 5, 1, 5.5], [98, 92, 20, 0.3], null],
  ['williamson', 'Williamson', 'WV', '54059', 37.67, -82.28, [820, 6, 3, 0.5, 0.5, 2.3, 45, 78, 40, 2, 1, 9.5], [45, 45, 10, 0.4], null],
];

const BETAS = { sentiment: 0.3, incentive: 0.1, restriction: 0.3 };
const r1 = (x) => Math.round(x * 10) / 10;

function percentiles(values, better) {
  const n = values.length;
  return values.map((v) => {
    const worse = values.filter((o) => (better === 'low' ? o > v : o < v)).length;
    const ties = values.filter((o) => o === v).length;
    return (worse + (ties - 1) / 2) / (n - 1);
  });
}

export function scoreSites(weights) {
  const w = Object.fromEntries(Object.keys(PILLARS).map((p) => [p, Number(weights?.[p] ?? 1)]));
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const perPillar = Object.fromEntries(Object.keys(PILLARS).map((p) => [p, FACTORS.filter((f) => f[1] === p).length]));
  const v = FACTORS.map((f) => w[f[1]] / total / perPillar[f[1]]);
  const pct = FACTORS.map((f, j) => percentiles(SITES.map((s) => s[6][j]), f[3]));
  const lnx = SITES.map((s, i) => FACTORS.map((f, j) => Math.log(0.05 + 0.95 * pct[j][i])));
  const scored = SITES.map((s, i) => i).filter((i) => !SITES[i][8]);
  const mean = FACTORS.map((f, j) => scored.reduce((a, i) => a + lnx[i][j], 0) / scored.length);
  const out = SITES.map(([id, name, st, fips, lat, lon, vals, attrs, excl], i) => {
    const score = 100 * Math.exp(v.reduce((a, vj, j) => a + vj * lnx[i][j], 0));
    const contrib = FACTORS.map((f, j) => [v[j] * (lnx[i][j] - mean[j]), j]).sort((a, b) => b[0] - a[0]);
    const pillars = {};
    for (const p of Object.keys(PILLARS)) {
      const js = FACTORS.map((f, j) => [f, j]).filter(([f]) => f[1] === p).map(([, j]) => j);
      pillars[p] = r1(100 * Math.exp(js.reduce((a, j) => a + lnx[i][j], 0) / js.length));
    }
    const label = (j) => `${FACTORS[j][2]}: ${vals[j]} ${FACTORS[j][4]}`;
    return {
      site_id: id,
      name: `${name}, ${st}`,
      state: st,
      county_fips: fips,
      lat,
      lon,
      score: excl ? 0 : r1(score),
      rank: null,
      pillars,
      factors: Object.fromEntries(FACTORS.map((f, j) => [f[0], vals[j]])),
      pros: contrib.slice(0, 3).filter(([c]) => c > 0.001).map(([, j]) => label(j)),
      cons: contrib.slice(-3).reverse().filter(([c]) => c < -0.001).map(([, j]) => label(j)),
      excluded: Boolean(excl),
      exclusion_reason: excl,
      attributes: {
        heat_need: attrs[0], climate_adversity: attrs[1], land_cost_index: attrs[2], community_hint: attrs[3],
        unemployment: vals[11], time_to_power_years: vals[2], tx_km: vals[1], water_stress: vals[4],
      },
    };
  });
  const ranked = out.filter((s) => !s.excluded).sort((a, b) => b.score - a.score);
  ranked.forEach((s, i) => { s.rank = i + 1; });
  return [...ranked, ...out.filter((s) => s.excluded)];
}

export function sampleCommunity(site) {
  const hint = Number(site.attributes?.community_hint || 0);
  return {
    region: site.county_fips, level: 'county', net_sentiment: hint, opposition_index: Math.max(0, -hint),
    support_index: Math.max(0, hint), incentive_signal: 0, restriction_signal: 0, active_moratorium: false,
    momentum: 0, coverage: 0, confidence: 0.6, illustrative: true, concerns: [], positives: [], item_ids: [],
  };
}

export function rerank(sites) {
  const active = sites.filter((s) => !s.excluded);
  const baseRank = Object.fromEntries([...active].sort((a, b) => b.score - a.score).map((s, i) => [s.site_id, i + 1]));
  const adjusted = active.map((s) => {
    const f = sampleCommunity(s);
    const m = {
      sentiment: Math.exp(BETAS.sentiment * f.net_sentiment * f.confidence),
      incentive: 1 + BETAS.incentive * f.incentive_signal,
      restriction: 1 - BETAS.restriction * f.restriction_signal,
      moratorium: f.active_moratorium ? 0 : 1,
    };
    const notes = ['Illustrative community signal from sample data, not collected items.'];
    if (f.net_sentiment <= -0.2) notes.push('Net opposition in local coverage.');
    if (f.net_sentiment >= 0.2) notes.push('Net local support.');
    const final = Math.min(100, s.score * m.sentiment * m.incentive * m.restriction * m.moratorium);
    return { s, final, f, m, notes };
  });
  adjusted.sort((a, b) => b.final - a.final);
  return adjusted.map(({ s, final, f, m, notes }, i) => ({
    ...s,
    rank: i + 1,
    base_score: s.score,
    base_rank: baseRank[s.site_id],
    final_score: Math.round(final * 100) / 100,
    final_rank: i + 1,
    rank_change: baseRank[s.site_id] - (i + 1),
    community: {
      net_sentiment: f.net_sentiment, opposition_index: f.opposition_index, support_index: f.support_index,
      incentive_signal: 0, restriction_signal: 0, active_moratorium: false, coverage: 0, confidence: f.confidence,
      illustrative: true, multipliers: Object.fromEntries(Object.entries(m).map(([k, x]) => [k, Math.round(x * 1e4) / 1e4])), notes,
    },
  }));
}

// ---------- Social Accord trade-off engine (mirrors backend/app/tradeoff/engine.py) ----------
export const DIMENSIONS = ['economic', 'social', 'ecological'];
export const DIMENSION_META = {
  economic: { label: 'Economic', blurb: 'Durable local value.' },
  social: { label: 'Social', blurb: 'Opportunity and wellbeing.' },
  ecological: { label: 'Ecological', blurb: 'Healthy natural systems.' },
};
export const INDICATORS = [
  ['tax_revenue', 'economic', 'Tax revenue', 'Tax', 'Projected property tax minus abatements from incentive bills', 'estimated'],
  ['price_stability', 'economic', 'Price stability', 'Prices', 'Residential electricity rate risk from utility rate cases and large-load tariffs', 'estimated'],
  ['capital_investment', 'economic', 'Capital investment', 'Capital', 'Project investment relative to county GDP', 'estimated'],
  ['economic_efficiency', 'economic', 'Economic efficiency', 'Efficiency', 'Cost per MW: land, power price and time to power', 'estimated'],
  ['gdp_contribution', 'economic', 'GDP contribution', 'GDP', 'County GDP plus indirect effects from the jobs multiplier', 'estimated'],
  ['jobs_wages', 'economic', 'Job creation and wages', 'Jobs', 'Direct and indirect jobs against BLS wages and Census unemployment', 'measured'],
  ['digital_equity', 'social', 'Digital equity', 'Digital', 'Whether the project brings fiber to unserved areas on the FCC broadband map', 'estimated'],
  ['access_utilities', 'social', 'Access to utilities', 'Utilities', 'Shared grid and water upgrades that also serve residents', 'estimated'],
  ['education', 'social', 'Education', 'Education', 'Local colleges (NCES) and committed training programs', 'estimated'],
  ['sense_of_place', 'social', 'Sense of place', 'Place', 'Distance to historic sites, parks and homes, and zoning fit', 'estimated'],
  ['health_wellbeing', 'social', 'Health and wellbeing', 'Health', 'Homes in the noise range, generator emissions and CDC PLACES health data', 'estimated'],
  ['equity_inclusion', 'social', 'Equity and inclusion', 'Equity', 'Whether burdens fall on vulnerable neighborhoods (CDC Social Vulnerability Index)', 'measured'],
  ['carbon_climate', 'ecological', 'Carbon and climate', 'Carbon', 'Grid marginal emissions, embodied carbon and heat reuse', 'measured'],
  ['air_quality', 'ecological', 'Air quality', 'Air', 'EPA nonattainment areas and backup generator emissions', 'measured'],
  ['water_quality', 'ecological', 'Water quality', 'Water Q', 'EPA impaired waters (ATTAINS) and cooling discharge', 'estimated'],
  ['water_cycle', 'ecological', 'Water cycle', 'Water', 'WRI Aqueduct water stress and cooling water consumption', 'measured'],
  ['biodiversity', 'ecological', 'Biodiversity', 'Wildlife', 'Critical habitat and protected areas', 'estimated'],
  ['soil', 'ecological', 'Soil', 'Soil', 'Prime farmland on the USDA soil survey', 'measured'],
];
const INDICATOR_IDS = INDICATORS.map((r) => r[0]);
const INDICATOR_META = Object.fromEntries(INDICATORS.map(([i, d, label, short, how, kind]) => [i, { dimension: d, label, short, how, kind }]));
const BY_DIMENSION = Object.fromEntries(DIMENSIONS.map((d) => [d, INDICATORS.filter((r) => r[1] === d).map((r) => r[0])]));
const TENSION_PAIRS = [
  ['tax_revenue', 'price_stability'], ['capital_investment', 'sense_of_place'],
  ['economic_efficiency', 'water_cycle'], ['jobs_wages', 'water_cycle'], ['jobs_wages', 'soil'],
  ['access_utilities', 'price_stability'], ['economic_efficiency', 'equity_inclusion'],
  ['carbon_climate', 'water_cycle'],
];

const base = {
  dimensions: { economic: 34, social: 33, ecological: 33 },
  indicators: {},
  min_indicator: 30,
  exclude_moratoria: true,
  states_include: [], states_exclude: [], max_per_state: 2, top_n: 10,
};
export const TRADEOFF_PRESETS = {
  balanced: base,
  economic: { ...base, dimensions: { economic: 60, social: 20, ecological: 20 } },
  social: { ...base, dimensions: { economic: 20, social: 60, ecological: 20 } },
  ecological: { ...base, dimensions: { economic: 20, social: 20, ecological: 60 } },
};
export const ACCORD_DISCLAIMER = 'SitewellEco² does not rate communities or certify projects. It shows how well a project fits this place, and what it gives back. Values are labeled measured or estimated. Measured values in this demo are illustrative.';

const clamp100 = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const getN = (site, keys, fallback = 0) => {
  const f = site.factors || {};
  const a = site.attributes || {};
  for (const k of keys) {
    if (f[k] != null) return Number(f[k]);
    if (a[k] != null && !Number.isNaN(Number(a[k]))) return Number(a[k]);
  }
  return fallback;
};

function accordProfiles(site, community) {
  const carbon = getN(site, ['carbon'], 420);
  const tx = getN(site, ['tx_km'], 8);
  const ttp = getN(site, ['time_to_power', 'time_to_power_years'], 4);
  const surplus = getN(site, ['surplus_hours'], 4);
  const water = getN(site, ['water_stress'], 2);
  const plantW = getN(site, ['plant_water'], 1.5);
  const hazard = getN(site, ['hazard_risk'], 40);
  const freeC = getN(site, ['free_cooling'], 70);
  const heat = getN(site, ['heat_reuse'], 40);
  const reuseKm = getN(site, ['reuse_km'], 10);
  const opposition = getN(site, ['opposition'], 3);
  const unemp = getN(site, ['unemployment'], 4);
  const land = getN(site, ['land_cost_index'], 50);
  const heatNeed = getN(site, ['heat_need'], 40);
  const adversity = getN(site, ['climate_adversity'], 40);
  const hint = getN(site, ['community_hint'], 0);

  const taxAbate = clamp100(12 + 0.25 * land + 15 * Math.max(0, -hint), 8, 55);
  const rateRisk = clamp100(12 + carbon / 16 + ttp * 5 + Math.max(0, 8 - surplus) * 2, 8, 90);
  const invGdp = clamp100(28 + (100 - land) * 0.38 + unemp * 4.2, 15, 95);
  const college = clamp100(22 + Math.max(0, 20 - reuseKm) * 1.6 + (land > 50 ? 18 : 6), 10, 90);
  const placePressure = clamp100(12 + opposition * 7 + land * 0.22, 8, 92);
  const svi = clamp100(16 + unemp * 5.2 + Math.max(0, -hint) * 22, 10, 92);
  const broadbandGap = clamp100(12 + (100 - land) * 0.28 + unemp * 2.2, 8, 85);
  const farmland = clamp100(8 + (100 - land) * 0.42 + water * 6, 5, 92);
  const habitat = clamp100(16 + Math.max(0, reuseKm - 4) * 2.2 + water * 3.5, 8, 90);
  const air = clamp100(12 + carbon / 28 + (100 - freeC) * 0.18 + opposition * 2.5, 8, 90);
  const carbonN = clamp100((carbon - 200) / 7);
  const ttpN = clamp100(((ttp - 1) / 6) * 100);
  const txN = clamp100((tx / 20) * 100);
  const plantN = clamp100((plantW / 3) * 100);
  const waterN = clamp100((water / 5) * 100);
  const sentiment = Number(community.net_sentiment || 0);
  const restriction = Number(community.restriction_signal || 0);
  const incentive = Number(community.incentive_signal || 0);
  const moratorium = Boolean(community.active_moratorium);

  const baseline = {
    tax_revenue: 48,
    price_stability: clamp100(100 - 0.55 * rateRisk),
    capital_investment: 20,
    economic_efficiency: 50,
    gdp_contribution: 32,
    jobs_wages: clamp100(34 + unemp * 2.2),
    digital_equity: clamp100(100 - broadbandGap),
    access_utilities: clamp100(62 - 0.35 * ttpN),
    education: college,
    sense_of_place: clamp100(100 - placePressure),
    health_wellbeing: clamp100(100 - 0.45 * air - 0.28 * hazard),
    equity_inclusion: clamp100(100 - svi),
    carbon_climate: clamp100(100 - carbonN),
    air_quality: clamp100(100 - air),
    water_quality: clamp100(100 - 0.55 * plantN - 0.25 * waterN),
    water_cycle: clamp100(100 - waterN),
    biodiversity: clamp100(100 - habitat),
    soil: clamp100(100 - 0.55 * farmland),
  };
  const heatBonus = 0.22 * (heat / 100) * (heatNeed / 100);
  const jobsReach = clamp100(20 + unemp * 8, 15, 80);
  const sharedUpgrades = clamp100(18 + ttpN * 0.25 + txN * 0.15);
  const whoPays = clamp100(rateRisk * 0.35 + taxAbate * 0.4);
  const project = {
    tax_revenue: clamp100(baseline.tax_revenue + 0.42 * invGdp * (1 - taxAbate / 100) - incentive * 12),
    price_stability: clamp100(baseline.price_stability - 0.38 * rateRisk + 0.08 * surplus),
    capital_investment: clamp100(0.25 * baseline.capital_investment + 0.75 * invGdp),
    economic_efficiency: clamp100(100 - 0.38 * land - 0.34 * ttpN - 0.20 * txN - 0.08 * carbonN),
    gdp_contribution: clamp100(28 + 0.45 * invGdp + 0.28 * jobsReach),
    jobs_wages: clamp100(22 + jobsReach + Math.max(0, hint) * 8),
    digital_equity: clamp100(baseline.digital_equity + 0.45 * broadbandGap),
    access_utilities: clamp100(baseline.access_utilities + sharedUpgrades - whoPays),
    education: clamp100(college + 8 + Math.max(0, hint) * 6),
    sense_of_place: clamp100(baseline.sense_of_place - opposition * 4 - 0.15 * invGdp + (reuseKm <= 3 ? 12 : 0) + sentiment * 8 - restriction * 18),
    health_wellbeing: clamp100(baseline.health_wellbeing - 0.18 * air - 0.12 * adversity + 0.15 * freeC),
    equity_inclusion: clamp100(baseline.equity_inclusion - 0.22 * svi + 0.12 * jobsReach - (land < 25 && svi > 50 ? 8 : 0)),
    carbon_climate: clamp100(baseline.carbon_climate + 18 * heatBonus + 0.08 * surplus - 0.12 * carbonN),
    air_quality: clamp100(baseline.air_quality - 0.16 * (100 - freeC) + 0.05 * surplus),
    water_quality: clamp100(baseline.water_quality - 0.22 * plantN - 0.10 * waterN),
    water_cycle: clamp100(baseline.water_cycle - 0.28 * waterN - 0.12 * plantN + 8 * heatBonus),
    biodiversity: clamp100(baseline.biodiversity - 0.18 * habitat + (reuseKm <= 3 ? 10 : -6)),
    soil: clamp100(baseline.soil - 0.32 * farmland + (reuseKm <= 3 ? 12 : 0)),
  };
  if (moratorium) {
    project.sense_of_place = r1(clamp100(project.sense_of_place * 0.35));
    project.equity_inclusion = r1(clamp100(project.equity_inclusion * 0.7));
  }
  const notes = [];
  if (taxAbate >= 30 && project.tax_revenue < baseline.tax_revenue + 8) notes.push('Incentives attract the project but shrink the tax that stays local.');
  if (water >= 3.5) notes.push('Water stress is high: evaporative cooling would save energy but use water the place cannot spare.');
  if (reuseKm <= 3) notes.push('Reusing a brownfield or retired plant protects farmland and habitat relative to a greenfield.');
  if (heatNeed >= 70 && heat >= 50) notes.push('Local heating demand can take waste heat, which is one way the project gives carbon and climate value back.');
  if (unemp >= 5.5) notes.push(`Unemployment is ${unemp.toFixed(1)}%, so job creation and wages count more here than in a tight labor market.`);
  if (svi >= 55 && land < 30) notes.push('Cheap land here overlaps a more vulnerable community, so equity and inclusion is a live tension.');
  return [Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, r1(v)])), Object.fromEntries(Object.entries(project).map(([k, v]) => [k, r1(v)])), notes];
}

function tensionsFor(baseline, project) {
  const found = [];
  for (const [a, b] of TENSION_PAIRS) {
    const da = project[a] - baseline[a];
    const db = project[b] - baseline[b];
    const la = INDICATOR_META[a].label;
    const lb = INDICATOR_META[b].label;
    if (da >= 8 && db <= -8) found.push(`${la} up, ${lb} down`);
    else if (db >= 8 && da <= -8) found.push(`${lb} up, ${la} down`);
  }
  return found;
}

function normalize(raw, keys) {
  const total = keys.reduce((a, k) => a + Math.max(0, raw[k] || 0), 0) || 1;
  return Object.fromEntries(keys.map((k) => [k, Math.max(0, raw[k] || 0) / total]));
}

function dimensionScores(project, p) {
  const scores = {};
  for (const d of DIMENSIONS) {
    const ids = BY_DIMENSION[d];
    const inner = normalize(Object.fromEntries(ids.map((i) => [i, Number(p.indicators?.[i] ?? 1)])), ids);
    scores[d] = r1(ids.reduce((a, i) => a + inner[i] * project[i], 0));
  }
  return scores;
}

export function evaluateTradeoff(params, useCommunity = true) {
  const p = { ...base, ...params, dimensions: { ...base.dimensions, ...(params?.dimensions || {}) }, indicators: { ...(params?.indicators || {}) } };
  const raw = scoreSites();
  const adjusted = Object.fromEntries(rerank(raw).map((s) => [s.site_id, s]));
  const sites = raw.map((s) => (useCommunity && adjusted[s.site_id] ? adjusted[s.site_id] : s));
  const dimW = normalize(p.dimensions, DIMENSIONS);
  const indicatorWeights = {};
  for (const d of DIMENSIONS) {
    const ids = BY_DIMENSION[d];
    const inner = normalize(Object.fromEntries(ids.map((i) => [i, Number(p.indicators[i] ?? 1)])), ids);
    ids.forEach((i) => { indicatorWeights[i] = dimW[d] * inner[i]; });
  }
  const feasible = [];
  const excluded = [];
  for (const s of sites) {
    const community = sampleCommunity(s);
    let reason = null;
    if (s.excluded) reason = s.exclusion_reason || 'Excluded by the scoring model';
    else if (p.states_include.length && !p.states_include.includes(s.state)) reason = 'Outside the states you selected';
    else if (p.states_exclude.includes(s.state)) reason = 'In a state you excluded';
    else if (p.exclude_moratoria && community.active_moratorium) reason = 'Active moratorium';
    if (reason) { excluded.push({ site_id: s.site_id, name: s.name, state: s.state, reason }); continue; }
    const [baseline, project, notes] = accordProfiles(s, community);
    if (p.min_indicator != null) {
      const weak = INDICATOR_IDS.filter((i) => project[i] < p.min_indicator);
      if (weak.length) {
        const worst = weak.reduce((a, b) => (project[a] < project[b] ? a : b));
        excluded.push({
          site_id: s.site_id, name: s.name, state: s.state,
          reason: `${INDICATOR_META[worst].label} is ${Math.round(project[worst])}, below the do-no-harm floor of ${Math.round(p.min_indicator)}`,
        });
        continue;
      }
    }
    const dims = dimensionScores(project, p);
    feasible.push({
      site_id: s.site_id, name: s.name, state: s.state, county_fips: s.county_fips, lat: s.lat, lon: s.lon,
      utility: r1(DIMENSIONS.reduce((a, d) => a + dimW[d] * dims[d], 0)),
      dimensions: dims, indicators: project, baseline,
      deltas: Object.fromEntries(INDICATOR_IDS.map((i) => [i, r1(project[i] - baseline[i])])),
      tensions: tensionsFor(baseline, project), notes,
    });
  }
  feasible.sort((a, b) => b.utility - a.utility);
  const best = Object.fromEntries(INDICATOR_IDS.map((i) => [i, feasible.length ? Math.max(...feasible.map((r) => r.indicators[i])) : 100]));
  feasible.forEach((r) => { r.best = Object.fromEntries(INDICATOR_IDS.map((i) => [i, r1(best[i])])); });
  const active = DIMENSIONS.filter((d) => dimW[d] > 0);
  for (const r of feasible) {
    r.pareto = !feasible.some((o) => o !== r && active.every((k) => o.dimensions[k] >= r.dimensions[k]) && active.some((k) => o.dimensions[k] > r.dimensions[k]));
  }
  const perState = {};
  let shortlist = 0;
  feasible.forEach((r, i) => {
    r.rank = i + 1;
    r.selected = false;
    if (shortlist < p.top_n && (p.max_per_state == null || (perState[r.state] || 0) < p.max_per_state)) {
      r.selected = true;
      perState[r.state] = (perState[r.state] || 0) + 1;
      shortlist += 1;
    }
    r.strengths = Object.entries(r.dimensions).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => DIMENSION_META[k].label);
  });
  return {
    weights: dimW, indicator_weights: indicatorWeights, results: feasible, excluded,
    best_profile: Object.fromEntries(INDICATOR_IDS.map((i) => [i, r1(best[i])])),
    indicators: INDICATORS.map(([id, dimension, label, short, how, kind]) => ({ id, dimension, label, short, how, kind })),
    dimensions: DIMENSION_META, disclaimer: ACCORD_DISCLAIMER,
    illustrative: true, model_version: 'mock-geomean-v1',
  };
}

export const SAMPLE_BETAS = BETAS;
