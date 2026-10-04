// Formatting and honesty labels for the scoring service's real-unit metrics.

export const FACTOR_TAGS = {
  pue: 'assumption',
  wue: 'assumption',
  water_ml: 'on-site part is an assumption',
  energy_cost_musd: 'electricity only',
};

const TTP_TAGS = { judgment: 'judgment', 'national default': 'national default' };

/** "judgment" for NorthernGrid_West counties, "national default" for the 4-year fallback, else null. */
export function ttpTag(row) {
  const tag = row?.time_to_power_tag ?? row?.attributes?.time_to_power_tag;
  return TTP_TAGS[tag] || null;
}

const NAMES = {
  pue: 'PUE',
  wue: 'On-site water use (WUE)',
  co2_t: 'CO2 (long-run marginal)',
  co2_avg_grid_t: 'CO2 (average grid, reference only)',
  water_ml: 'Water',
  energy_cost_musd: 'Energy cost',
};

/** Display name; caveats such as "assumption" or "electricity only" are shown as tags instead. */
export function shortLabel(label = '', id = null) {
  return NAMES[id] || label.replace(/\s*\(.*\)\s*$/, '');
}

export function tagsFor(id, row) {
  const tags = [];
  if (FACTOR_TAGS[id]) tags.push(FACTOR_TAGS[id]);
  if (id === 'time_to_power_yrs' && row) {
    const t = ttpTag(row);
    if (t) tags.push(t);
  }
  return tags;
}

export function fmtNum(value, unit = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  const v = Number(value);
  const av = Math.abs(v);
  let digits = 2;
  if (unit === '0-1') digits = 2;
  else if (av >= 100) digits = 0;
  else if (av >= 10) digits = 1;
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtWithUnit(value, unit = '') {
  const n = fmtNum(value, unit);
  if (n === 'n/a' || !unit || ['0-1', '0-5', 'ratio'].includes(unit)) return n;
  return `${n} ${unit}`;
}
