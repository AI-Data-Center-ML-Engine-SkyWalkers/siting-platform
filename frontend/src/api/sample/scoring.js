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
  ['water_stress', 'water', 'Baseline water stress', 'low', '0-5'],
  ['plant_water', 'water', 'Power-plant water use', 'low', 'L/kWh'],
  ['hazard_risk', 'climate', 'Natural hazard risk', 'low', '0-100'],
  ['free_cooling', 'cooling', 'Free-cooling hours', 'high', '% of hours'],
  ['heat_reuse', 'cooling', 'Heat reuse potential', 'high', '0-100'],
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

// ---------- Trade-off engine ----------
export const OBJECTIVE_LABELS = {
  sustainability: 'Sustainability',
  speed_to_power: 'Speed to power',
  cost: 'Cost',
  community: 'Community acceptance',
  ecosystem: 'Ecosystem benefit',
};
const OBJECTIVES = Object.keys(OBJECTIVE_LABELS);

const base = {
  objectives: { sustainability: 40, speed_to_power: 20, cost: 15, community: 15, ecosystem: 10 },
  heat_reuse_value: 0.5, jobs_value: 0.5, jobs_multiplier: 2.0, max_water_stress: 4.0,
  max_time_to_power_years: null, min_sustainability: null, exclude_moratoria: true,
  states_include: [], states_exclude: [], max_per_state: 2, top_n: 10,
};
export const TRADEOFF_PRESETS = {
  balanced: base,
  speed: { ...base, objectives: { sustainability: 25, speed_to_power: 45, cost: 20, community: 10, ecosystem: 0 } },
  community: { ...base, objectives: { sustainability: 25, speed_to_power: 10, cost: 10, community: 40, ecosystem: 15 } },
  ecosystem: { ...base, objectives: { sustainability: 30, speed_to_power: 10, cost: 10, community: 15, ecosystem: 35 }, heat_reuse_value: 0.9, jobs_value: 0.9, jobs_multiplier: 2.5 },
};

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

function objectiveScores(site, community, p) {
  const a = site.attributes || {};
  const notes = [];
  const ttp = Number(a.time_to_power_years ?? 4);
  const tx = Number(a.tx_km ?? 10);
  const speed = 100 * (0.7 * clamp(1 - (ttp - 1) / 6) + 0.3 * clamp(1 - tx / 20));
  const heatNeed = Number(a.heat_need || 0) / 100;
  const adversity = Number(a.climate_adversity || 0) / 100;
  const land = Number(a.land_cost_index ?? 50) / 100;
  const offset = p.heat_reuse_value * heatNeed;
  const cost = 100 * (1 - (0.6 * land + 0.4 * adversity * (1 - offset)));
  if (adversity >= 0.6 && offset >= 0.4) notes.push('Harsh climate, but strong local heating demand can use the waste heat, which offsets part of the penalty.');
  const communityScore = community.active_moratorium ? 0 : clamp(0.5 + 0.5 * (community.net_sentiment || 0) - 0.3 * (community.restriction_signal || 0)) * 100;
  const unemployment = Number(a.unemployment || 0);
  const jobsNeed = clamp((unemployment - 2.5) / 6);
  const jobsReach = clamp(p.jobs_multiplier / 3);
  const wsum = p.heat_reuse_value + p.jobs_value;
  const ecosystem = wsum ? 100 * ((p.heat_reuse_value * heatNeed + p.jobs_value * jobsNeed * jobsReach) / wsum) : 0;
  if (jobsNeed >= 0.4 && p.jobs_value > 0) notes.push(`Unemployment is ${unemployment.toFixed(1)}%: about ${Number(p.jobs_multiplier).toFixed(1)} jobs per direct job (hotels, travel, services) count in its favor.`);
  if (heatNeed >= 0.7 && p.heat_reuse_value > 0) notes.push('High heating demand nearby: waste heat could warm local buildings or greenhouses.');
  const s = { sustainability: Number(site.final_score ?? site.score ?? 0), speed_to_power: speed, cost, community: communityScore, ecosystem };
  return [Object.fromEntries(Object.entries(s).map(([k, x]) => [k, r1(x)])), notes];
}

export function evaluateTradeoff(params, useCommunity = true) {
  const p = { ...base, ...params };
  const raw = scoreSites();
  const adjusted = Object.fromEntries(rerank(raw).map((s) => [s.site_id, s]));
  const sites = raw.map((s) => (useCommunity && adjusted[s.site_id] ? adjusted[s.site_id] : s));
  const totalW = OBJECTIVES.reduce((a, k) => a + Math.max(0, p.objectives[k] || 0), 0) || 1;
  const weights = Object.fromEntries(OBJECTIVES.map((k) => [k, Math.max(0, p.objectives[k] || 0) / totalW]));
  const active = OBJECTIVES.filter((k) => weights[k] > 0);
  const feasible = [];
  const excluded = [];
  for (const s of sites) {
    const a = s.attributes || {};
    const community = sampleCommunity(s);
    let reason = null;
    if (s.excluded) reason = s.exclusion_reason || 'Excluded by the scoring model';
    else if (p.states_include.length && !p.states_include.includes(s.state)) reason = 'Outside the states you selected';
    else if (p.states_exclude.includes(s.state)) reason = 'In a state you excluded';
    else if (p.max_water_stress != null && a.water_stress > p.max_water_stress) reason = `Water stress ${a.water_stress} is above your limit of ${p.max_water_stress}`;
    else if (p.max_time_to_power_years != null && a.time_to_power_years > p.max_time_to_power_years) reason = `Time to power ${a.time_to_power_years} years is above your limit`;
    else if (p.min_sustainability != null && (s.final_score ?? s.score) < p.min_sustainability) reason = 'Sustainability score below your minimum';
    if (reason) { excluded.push({ site_id: s.site_id, name: s.name, state: s.state, reason }); continue; }
    const [objectives, notes] = objectiveScores(s, community, p);
    const contributions = Object.fromEntries(OBJECTIVES.map((k) => [k, Math.round(weights[k] * objectives[k] * 100) / 100]));
    feasible.push({
      site_id: s.site_id, name: s.name, state: s.state, county_fips: s.county_fips, lat: s.lat, lon: s.lon,
      utility: Math.round(Object.values(contributions).reduce((x, y) => x + y, 0) * 100) / 100,
      objectives, contributions, notes,
    });
  }
  feasible.sort((a, b) => b.utility - a.utility);
  for (const r of feasible) {
    r.pareto = !feasible.some((o) => o !== r && active.every((k) => o.objectives[k] >= r.objectives[k]) && active.some((k) => o.objectives[k] > r.objectives[k]));
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
    r.strengths = Object.entries(r.contributions).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => OBJECTIVE_LABELS[k]);
  });
  return { weights, results: feasible, excluded, objective_labels: OBJECTIVE_LABELS, illustrative: true, model_version: 'mock-geomean-v1' };
}

export const SAMPLE_BETAS = BETAS;
