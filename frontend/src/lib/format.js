export const STANCE_LABELS = { support: 'Supportive', oppose: 'Opposed', mixed: 'Mixed', neutral: 'Neutral' };

export const EVENT_LABELS = {
  protest: 'Protest', public_hearing: 'Public hearing', zoning_decision: 'Zoning decision',
  bill_introduced: 'Bill introduced', bill_advanced: 'Bill advancing', bill_passed: 'Law passed',
  moratorium: 'Moratorium', restriction: 'Restriction', incentive: 'Incentive', lawsuit: 'Lawsuit',
  project_announced: 'Project announced', project_approved: 'Project approved', project_canceled: 'Project canceled',
  opinion: 'Opinion', other: 'Update',
};

export const SOURCE_TYPE_LABELS = {
  legislation: 'Bill', government: 'Government record', news: 'News', advocacy: 'Advocacy group', social: 'Public post',
};

export const CREDIBILITY_LABELS = {
  legislation: 'Official record', government: 'Official record', news: 'Established news', advocacy: 'Advocacy group', social: 'Single public post',
};

export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Score 0-100 to one of five ramp colors (CSS variables). */
export function rampColor(score, lo = 0, hi = 100) {
  if (hi - lo < 1e-9) return 'var(--s3)';
  const bin = Math.min(5, 1 + Math.floor(((score - lo) / (hi - lo)) * 5));
  return `var(--s${Math.max(1, bin)})`;
}
