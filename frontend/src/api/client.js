// One place for every backend call. Each function has a sample-mode twin, so the app works
// before the backend (or your teammates' ML model) is running.
//
// VITE_DATA_MODE: live | sample | auto (default: try the backend, fall back to sample data)
// VITE_API_BASE:  backend origin, e.g. http://localhost:8000 (empty = same origin / dev proxy)

import { evaluateTradeoff, FACTORS, PILLARS, rerank, SAMPLE_BETAS, sampleCommunity, scoreSites, TRADEOFF_PRESETS } from './sample/scoring.js';
import { SAMPLE_ALERTS, SAMPLE_ITEMS, TOPIC_LABELS } from './sample/awareness.js';
import { STATES } from '../lib/format.js';

const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const MODE = import.meta.env.VITE_DATA_MODE || 'auto';

let modePromise = null;

/** Resolves to 'live' or 'sample' once per page load. */
export function dataMode() {
  if (!modePromise) {
    if (MODE === 'live' || MODE === 'sample') modePromise = Promise.resolve(MODE);
    else {
      modePromise = fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2500) })
        .then((r) => (r.ok ? 'live' : 'sample'))
        .catch(() => 'sample');
    }
  }
  return modePromise;
}

async function http(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms));

// ---------- Scoring (steps 2 and 3) ----------
export async function getScoringMeta() {
  if ((await dataMode()) === 'live') return http('/api/scoring/meta');
  return {
    provider: 'sample',
    pillars: Object.entries(PILLARS).map(([id, label]) => ({ id, label })),
    factors: FACTORS.map(([id, pillar, label, better, unit]) => ({ id, pillar, label, better, unit })),
    betas: SAMPLE_BETAS,
  };
}

export async function rankSites({ n = 10, weights = null, community = true } = {}) {
  if ((await dataMode()) === 'live') return http('/api/scoring/rank', { method: 'POST', body: { n, weights, community } });
  await delay();
  const sites = scoreSites(weights);
  if (!community) return { model_version: 'mock-geomean-v1', illustrative: true, sites: sites.filter((s) => !s.excluded).slice(0, n) };
  return { model_version: 'mock-geomean-v1', illustrative: true, betas: SAMPLE_BETAS, sites: rerank(sites).slice(0, n) };
}

export async function getSite(siteId) {
  if ((await dataMode()) === 'live') return http(`/api/scoring/sites/${encodeURIComponent(siteId)}`);
  await delay(120);
  const site = scoreSites().find((s) => s.site_id === siteId);
  if (!site) throw new Error('404: Site not found');
  return { site, community: sampleCommunity(site), pulse: site.county_fips ? sampleRegion(site.county_fips) : null };
}

// ---------- Trade-offs (step 4) ----------
export async function getTradeoffPresets() {
  if ((await dataMode()) === 'live') return http('/api/tradeoff/presets');
  return { presets: TRADEOFF_PRESETS };
}

export async function evaluateTradeoffs(params, useCommunity = true) {
  if ((await dataMode()) === 'live') return http('/api/tradeoff/evaluate', { method: 'POST', body: { params, use_community: useCommunity } });
  await delay(120);
  return evaluateTradeoff(params, useCommunity);
}

// ---------- Awareness (step 5) ----------
export async function getTopics() {
  if ((await dataMode()) === 'live') return http('/api/awareness/topics');
  return { topics: Object.entries(TOPIC_LABELS).map(([id, label]) => ({ id, label })) };
}

export async function searchAwareness(params = {}) {
  if ((await dataMode()) === 'live') return http(`/api/awareness/search${qs(params)}`);
  await delay();
  const { q, state, county, stance, topic, source_type: sourceType, days, page = 1, size = 20 } = params;
  const words = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
  let rows = SAMPLE_ITEMS.filter((i) => {
    const hay = `${i.title} ${i.excerpt} ${i.analysis.summary} ${i.region} ${i.analysis.topic_labels.join(' ')}`.toLowerCase();
    if (words.length && !words.some((w) => hay.includes(w))) return false;
    if (state && i.state !== state) return false;
    if (county && i.county_fips !== county) return false;
    if (stance && i.analysis.stance !== stance) return false;
    if (topic && !i.analysis.topics.includes(topic)) return false;
    if (sourceType && i.source_type !== sourceType) return false;
    if (days && Date.now() - new Date(i.published_at).getTime() > days * 86400000) return false;
    return true;
  });
  if (words.length) {
    const score = (i) => words.filter((w) => `${i.title} ${i.analysis.summary}`.toLowerCase().includes(w)).length;
    rows = rows.map((i) => ({ ...i, score: score(i) / words.length })).sort((a, b) => b.score - a.score);
  } else {
    rows = [...rows].sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  }
  return { mode: words.length ? 'keyword' : 'recent', total: rows.length, page, size, results: rows.slice((page - 1) * size, page * size) };
}

function sampleRegion(region) {
  const isCounty = /^\d{5}$/.test(region);
  const items = SAMPLE_ITEMS.filter((i) => (isCounty ? i.county_fips === region : i.state === region));
  const stateItems = isCounty ? SAMPLE_ITEMS.filter((i) => items[0] && i.state === items[0].state && !i.county_fips) : [];
  const all = [...items, ...stateItems];
  const w = (i) => i.credibility * (0.5 + i.analysis.severity / 5);
  const opp = all.filter((i) => i.analysis.stance === 'oppose').reduce((a, i) => a + w(i), 0) + all.filter((i) => i.analysis.stance === 'mixed').reduce((a, i) => a + w(i) / 2, 0);
  const sup = all.filter((i) => i.analysis.stance === 'support').reduce((a, i) => a + w(i), 0) + all.filter((i) => i.analysis.stance === 'mixed').reduce((a, i) => a + w(i) / 2, 0);
  const sat = (x) => 1 - Math.exp(-x / 1.5);
  const topicTally = (stances) => {
    const t = {};
    all.filter((i) => stances.includes(i.analysis.stance)).forEach((i) => i.analysis.topics.slice(0, 3).forEach((k) => { t[k] = (t[k] || 0) + w(i); }));
    return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([topic, weight]) => ({ topic, label: TOPIC_LABELS[topic], weight: Math.round(weight * 1000) / 1000 }));
  };
  const features = {
    region, level: isCounty ? 'county' : 'state', opposition_index: sat(opp), support_index: sat(sup),
    net_sentiment: (sup - opp) / (sup + opp + 1), incentive_signal: all.some((i) => i.analysis.topics.includes('tax_breaks') && i.analysis.stance !== 'oppose') ? 0.45 : 0,
    restriction_signal: sat(all.filter((i) => ['moratorium', 'restriction'].includes(i.analysis.event_type)).reduce((a, i) => a + w(i), 0)),
    active_moratorium: all.some((i) => i.analysis.event_type === 'moratorium'), momentum: 0, coverage: all.length,
    confidence: all.length / (all.length + 3), concerns: topicTally(['oppose', 'mixed']), positives: topicTally(['support', 'mixed']), illustrative: true,
  };
  const level = (v) => (v >= 0.6 ? 'high' : v >= 0.3 ? 'moderate' : 'low');
  const name = isCounty ? items[0]?.region || region : STATES[region] || region;
  const cons = features.concerns.slice(0, 3).map((c) => ({ text: `Community concern: ${c.label.toLowerCase()}`, detail: 'sample items', weight: c.weight }));
  const pros = features.positives.slice(0, 3).map((c) => ({ text: `Local support around ${c.label.toLowerCase()}`, detail: 'sample items', weight: c.weight }));
  if (features.active_moratorium) cons.unshift({ text: 'Active moratorium on new data centers', detail: 'from an established news source', weight: 1 });
  if (features.incentive_signal) pros.unshift({ text: 'Tax incentives proposed or in place', detail: 'see bills below', weight: features.incentive_signal });
  return {
    region, name, level: features.level,
    headline: all.length ? `Opposition is ${level(features.opposition_index)} and support is ${level(features.support_index)} in ${name}, based on ${all.length} sample items.` : `No community signals collected for ${name} yet.`,
    features,
    stance_counts: Object.fromEntries(['support', 'oppose', 'neutral', 'mixed'].map((s) => [s, all.filter((i) => i.analysis.stance === s).length])),
    pros, cons,
    upcoming: all.filter((i) => i.analysis.entities.event_date).map((i) => ({ date: i.analysis.entities.event_date, event_type: i.analysis.event_type, summary: i.analysis.summary, item_id: i.id, url: i.url })),
    policies: all.filter((i) => i.source_type === 'legislation').map((i) => ({ item_id: i.id, title: i.title, status: i.bill?.latest_action, date: i.bill?.latest_action_date, url: i.url, stance: i.analysis.stance })),
    recent: all.slice(0, 10),
  };
}

export async function getRegion(region) {
  if ((await dataMode()) === 'live') return http(`/api/awareness/regions/${encodeURIComponent(region)}`);
  await delay(120);
  return sampleRegion(region);
}

export async function getAwarenessMap(level = 'state') {
  if ((await dataMode()) === 'live') return http(`/api/awareness/map${qs({ level })}`);
  const states = [...new Set(SAMPLE_ITEMS.map((i) => i.state).filter(Boolean))];
  const CENTROIDS = { GA: [32.7, -83.4], VA: [37.5, -78.9], AZ: [34.3, -111.7], IN: [39.9, -86.3], TX: [31.5, -99.3], MN: [46.3, -94.3], OH: [40.3, -82.8], PA: [40.9, -77.8], WV: [38.6, -80.6], AK: [64.2, -149.5], WI: [44.6, -89.9], OR: [43.9, -120.6] };
  return {
    level,
    regions: states.filter((s) => CENTROIDS[s]).map((s) => {
      const r = sampleRegion(s);
      return { ...r.features, name: s, lat: CENTROIDS[s][0], lon: CENTROIDS[s][1] };
    }),
  };
}

const OPPOSE_EVENTS = new Set(['moratorium', 'restriction', 'lawsuit', 'protest', 'project_canceled']);
const SUPPORT_EVENTS = new Set(['incentive', 'project_approved', 'project_announced']);
const WATCH_EVENTS = new Set(['public_hearing', 'zoning_decision', 'bill_introduced', 'bill_advanced', 'bill_passed']);
function eventTone(eventType, stance) {
  if (OPPOSE_EVENTS.has(eventType) || (stance === 'oppose' && eventType !== 'other')) return 'against';
  if (SUPPORT_EVENTS.has(eventType) || stance === 'support') return 'for';
  if (WATCH_EVENTS.has(eventType)) return 'watch';
  return 'info';
}

/** Recent concrete events (not opinions) as GeoJSON points, for the map's events layer. */
export async function getEvents(days = 180) {
  if ((await dataMode()) === 'live') return http(`/api/awareness/events${qs({ days })}`);
  return {
    type: 'FeatureCollection',
    features: SAMPLE_ITEMS.filter((i) => i.lat != null && i.analysis.event_type !== 'opinion').map((i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
      properties: {
        id: i.id, title: i.title, summary: i.analysis.summary, event_type: i.analysis.event_type, stance: i.analysis.stance,
        severity: i.analysis.severity, source_type: i.source_type, outlet: i.outlet, url: i.url, published_at: i.published_at,
        region: i.region, tone: eventTone(i.analysis.event_type, i.analysis.stance), sample: true,
      },
    })),
  };
}

export async function getAlerts(limit = 30) {
  if ((await dataMode()) === 'live') return http(`/api/awareness/alerts${qs({ limit })}`);
  return { alerts: SAMPLE_ALERTS.slice(0, limit) };
}

export async function getWatchlists() {
  if ((await dataMode()) === 'live') return http('/api/awareness/watchlists');
  return { watchlists: sampleWatchlists };
}

const sampleWatchlists = [];
export async function createWatchlist(body) {
  if ((await dataMode()) === 'live') return http('/api/awareness/watchlists', { method: 'POST', body });
  const w = { id: sampleWatchlists.length + 1, ...body, has_webhook: Boolean(body.webhook_url), active: true };
  sampleWatchlists.push(w);
  return w;
}

export async function deleteWatchlist(id) {
  if ((await dataMode()) === 'live') return http(`/api/awareness/watchlists/${id}`, { method: 'DELETE' });
  const i = sampleWatchlists.findIndex((w) => w.id === id);
  if (i >= 0) sampleWatchlists.splice(i, 1);
  return null;
}

export async function getPipelineStatus() {
  if ((await dataMode()) === 'live') return http('/api/awareness/status');
  return null;
}

export function alertStreamUrl() {
  return `${BASE}/api/awareness/stream`;
}
