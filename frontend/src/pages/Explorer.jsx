import { ArrowLeft, CheckmarkOutline, ChevronLeft, ChevronRight, Dashboard, Download, Radar, RightPanelClose, Scales, SettingsAdjust, SidePanelClose, SubtractAlt } from '@carbon/icons-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { evaluateTradeoffs, getEvents, getScoringMeta, getSite, rankSites } from '../api/client.js';
import PremiumSlider from '../components/PremiumSlider.jsx';
import { RankDelta, StanceTag, Switch } from '../components/ui.jsx';
import { useAsync, useDataMode } from '../hooks/useData.js';
import { exportExcel, exportGeoJSON } from '../lib/export.js';
import { formatDate, STATES, timeAgo } from '../lib/format.js';

// Satellite map when a Mapbox token is set at build time; the hologram globe otherwise
const GlobeScene = lazy(() => import('../components/GlobeScene.jsx'));
const MapboxStage = import.meta.env.VITE_MAPBOX_TOKEN ? lazy(() => import('../components/MapboxStage.jsx')) : null;
const MAP_STYLE_OPTIONS = [
  ['satellite-streets', 'Satellite streets'], ['satellite', 'Satellite'], ['standard-satellite', 'Satellite 3D (Standard)'],
  ['terrain', 'Terrain'], ['night', 'Night streets'], ['light', 'Light'],
];
const EVENT_LEGEND = [['against', 'Against: moratoria, restrictions, protests, lawsuits'], ['for', 'For: incentives, approvals, announcements'], ['watch', 'Watch: hearings, zoning votes, bills'], ['info', 'Other updates']];

const PRESETS = [
  ['balanced', 'Balanced', { power: 50, water: 50, climate: 50, cooling: 50, land: 50, community: 50 }],
  ['carbon', 'Carbon first', { power: 90, water: 30, climate: 30, cooling: 40, land: 20, community: 20 }],
  ['water', 'Water first', { power: 30, water: 90, climate: 30, cooling: 40, land: 20, community: 20 }],
  ['resilience', 'Resilience first', { power: 30, water: 40, climate: 90, cooling: 30, land: 20, community: 30 }],
];
const PILLAR_HINTS = {
  power: 'Clean, available power and time to connect',
  water: 'Water stress and water used by power plants',
  climate: 'Floods, wildfire, storms and heat',
  cooling: 'Free-cooling hours and waste-heat reuse',
  land: 'Reusing brownfields and retired plants',
  community: 'Local opposition and economic need',
};
const BALANCED_TRADEOFFS = {
  dimensions: { economic: 34, social: 33, ecological: 33 },
  min_indicator: 30,
  exclude_moratoria: true,
  states_include: [],
  states_exclude: [],
  max_per_state: 2,
  top_n: 50,
};
const DIMENSION_LABELS = [
  ['economic', 'Economic'], ['social', 'Social'], ['ecological', 'Ecological'],
];

const scoreOf = (s) => s.final_score ?? s.score;
function usableCopy(value) {
  return Boolean(value && String(value).trim() && !/^[\s.!?“”"'‘’…]+$/.test(String(value).trim()));
}

function useDebounced(value, ms = 220) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function fmtCoord(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
}

const PANELS_KEY = 'sitewelleco.panels.v2';
function loadPanels() {
  try { return JSON.parse(localStorage.getItem(PANELS_KEY)) || {}; } catch { return {}; }
}
function savePanels(v) {
  try { localStorage.setItem(PANELS_KEY, JSON.stringify(v)); } catch { /* storage can be unavailable */ }
}

export default function Explorer() {
  const mode = useDataMode();
  const meta = useAsync(() => getScoringMeta(), []);
  const [weights, setWeights] = useState(PRESETS[0][2]);
  const [preset, setPreset] = useState('balanced');
  const [community, setCommunity] = useState(true);
  const [minScore, setMinScore] = useState(0);
  const [spin, setSpin] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [leftTab, setLeftTab] = useState('priorities');
  const [styleId, setStyleId] = useState('satellite-streets');
  const [layers, setLayers] = useState({ sites: true, heatmap: false, events: true });
  const [areas, setAreas] = useState([]);
  const [exporting, setExporting] = useState('');
  const [leftOpen, setLeftOpen] = useState(() => loadPanels().left ?? true);
  const [rightOpen, setRightOpen] = useState(() => loadPanels().right ?? true);
  const debounced = useDebounced(weights);
  const events = useAsync(() => getEvents(180), []);

  const ranking = useAsync(() => rankSites({ n: 100, weights: debounced, community }), [JSON.stringify(debounced), community]);
  const tradeoffs = useAsync(() => evaluateTradeoffs(BALANCED_TRADEOFFS, community), [community]);
  const all = ranking.data?.sites || [];
  const inAreas = useMemo(() => all.filter((s) => !areas.length || areas.includes(s.state)), [all, areas]);
  const visible = useMemo(() => inAreas.filter((s) => scoreOf(s) >= minScore), [inAreas, minScore]);
  const visibleEvents = useMemo(() => {
    const fc = events.data;
    if (!fc || !areas.length) return fc;
    return { ...fc, features: fc.features.filter((f) => areas.some((st) => (f.properties.region || '').endsWith(st) || STATES[st] === f.properties.region)) };
  }, [events.data, areas]);
  const stateCounts = useMemo(() => {
    const c = {};
    all.forEach((s) => { c[s.state] = (c[s.state] || 0) + 1; });
    return Object.entries(c).sort((a, b) => (STATES[a[0]] || a[0]).localeCompare(STATES[b[0]] || b[0]));
  }, [all]);
  const toggleArea = useCallback((st) => setAreas((a) => (a.includes(st) ? a.filter((x) => x !== st) : [...a, st])), []);
  const runExport = async (kind) => {
    setExporting(kind);
    try {
      if (kind === 'excel') await exportExcel(visible, visibleEvents);
      else exportGeoJSON(visible, visibleEvents);
    } finally {
      setExporting('');
    }
  };
  const pillars = meta.data?.pillars || [];
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const selected = all.find((s) => s.site_id === selectedId) || null;
  const presetLabel = PRESETS.find(([id]) => id === preset)?.[1] || 'Custom priorities';

  const openLeft = useCallback(() => setLeftOpen(true), []);
  const openRight = useCallback(() => setRightOpen(true), []);
  useEffect(() => { savePanels({ left: leftOpen, right: rightOpen }); }, [leftOpen, rightOpen]);

  const select = useCallback((id) => {
    setSelectedId(id);
    setHoveredId(null);
    if (id) setRightOpen(true);
  }, []);
  const hover = useCallback((id) => setHoveredId(id), []);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'Escape') setSelectedId(null);
      else if (e.key === '[') setLeftOpen((v) => !v);
      else if (e.key === ']') setRightOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const focusKey = areas.slice().sort().join(',');
  const top = visible[0];

  return (
    <div className={`explorer${MapboxStage ? ' has-mapbox' : ''}${leftOpen ? '' : ' left-closed'}${rightOpen ? '' : ' right-closed'}`}>
      {MapboxStage ? (
        <Suspense fallback={null}>
          <MapboxStage sites={visible} selectedId={selectedId} hoveredId={hoveredId} onSelect={select} onHover={hover} spin={spin}
            styleId={styleId} layers={layers} events={visibleEvents} focusKey={focusKey} insets={{ left: leftOpen, right: rightOpen }} />
        </Suspense>
      ) : (
        <Suspense fallback={null}>
          <GlobeScene sites={layers.sites ? visible : []} selectedId={selectedId} hoveredId={hoveredId} onSelect={select} onHover={hover}
            scan={spin} areas={areas} onStateClick={toggleArea} focusKey={focusKey} />
        </Suspense>
      )}

      {/* ---------- Left dashboard: controls ---------- */}
      <aside className="float float-left dash" aria-label="Controls" inert={leftOpen ? undefined : ''}>
        <section className="glass float-panel">
          <div className="float-head">
            <div className="dash-bar">
              <span className="eyebrow-glow"><i aria-hidden="true" />Controls</span>
              <button type="button" className="icon-btn" onClick={() => setLeftOpen(false)} aria-label="Close controls" title="Close controls  [">
                <SidePanelClose size={20} aria-hidden="true" />
              </button>
            </div>
            <h2 className="dash-title">Site finder</h2>
            <div className="tabs" role="tablist" aria-label="Controls">
              <button type="button" role="tab" aria-selected={leftTab === 'priorities'} onClick={() => setLeftTab('priorities')}>Priorities</button>
              <button type="button" role="tab" aria-selected={leftTab === 'map'} onClick={() => setLeftTab('map')}>Map and data</button>
            </div>
          </div>
          {leftTab === 'map' ? (
            <MapTab
              hasMapbox={Boolean(MapboxStage)} styleId={styleId} setStyleId={setStyleId} layers={layers} setLayers={setLayers}
              stateCounts={stateCounts} areas={areas} setAreas={setAreas} toggleArea={toggleArea}
              onExport={runExport} exporting={exporting} visibleCount={visible.length} eventCount={visibleEvents?.features?.length || 0}
            />
          ) : (
            <div className="float-scroll">
              <p className="small muted" style={{ marginTop: -4 }}>Move a slider and every site on the map is re-scored.</p>
              <div className="preset-row" role="group" aria-label="Presets">
                {PRESETS.map(([id, label, w]) => (
                  <button key={id} type="button" className="chip" aria-pressed={preset === id} onClick={() => { setWeights(w); setPreset(id); }}>{label}</button>
                ))}
              </div>
              {pillars.map((p) => (
                <PremiumSlider
                  key={p.id}
                  id={`w-${p.id}`}
                  label={p.label}
                  hint={PILLAR_HINTS[p.id]}
                  value={weights[p.id] ?? 50}
                  format={(v) => `${Math.round((100 * v) / total)}%`}
                  onChange={(v) => { setWeights((w) => ({ ...w, [p.id]: v })); setPreset(null); }}
                />
              ))}
              <div className="divider" />
              <PremiumSlider id="min-score" label="Show sites scoring at least" min={0} max={90} step={5} value={minScore} onChange={setMinScore}
                format={(v) => (v === 0 ? 'All' : `${v}+`)} hint={`${visible.length} of ${inAreas.length} sites shown`} />
              <Switch id="community" label="Adjust for community signals" checked={community} onChange={setCommunity} />
              <Switch id="spin" label={MapboxStage ? 'Spin the globe when zoomed out' : 'Scan animation'} checked={spin} onChange={setSpin} />
              {mode === 'sample' && <p className="tiny muted">Sample sites with illustrative values. Connect the scoring model to see real candidates.</p>}
            </div>
          )}
        </section>
      </aside>
      {!leftOpen && (
        <button type="button" className="dock-tab dock-left glass" onClick={openLeft} aria-label="Open controls" title="Open controls  [">
          <SettingsAdjust size={20} aria-hidden="true" />
          <span><b>Controls</b><small>{presetLabel}</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}

      {/* ---------- Right dashboard: insights, or the deep dive for a chosen site ---------- */}
      <aside className="float float-right dash" aria-label={selected ? `Site deep dive: ${selected.name}` : 'Insights'} inert={rightOpen ? undefined : ''}>
        <section className="glass float-panel">
          {selected
            ? <DeepDive key={selected.site_id} site={selected} pillars={pillars} tradeoff={tradeoffs.data?.results?.find((r) => r.site_id === selected.site_id)} onBack={() => setSelectedId(null)} onClose={() => setRightOpen(false)} />
            : (
              <Insights
                all={all} pool={inAreas} visible={visible} community={community} hoveredId={hoveredId} onHover={hover} onSelect={select}
                loading={ranking.loading && !all.length} minScore={minScore} setMinScore={setMinScore} pillars={pillars}
                events={visibleEvents} areas={areas} toggleArea={toggleArea} onClose={() => setRightOpen(false)}
              />
            )}
        </section>
      </aside>
      {!rightOpen && (
        <button type="button" className="dock-tab dock-right glass" onClick={openRight} aria-label={selected ? 'Open site deep dive' : 'Open insights'} title="Open insights  ]">
          <ChevronLeft size={16} aria-hidden="true" />
          <span><b>{selected ? 'Deep dive' : 'Insights'}</b><small>{selected ? selected.name : top ? `#1 ${top.name}` : 'Dashboard'}</small></span>
          <Dashboard size={20} aria-hidden="true" />
        </button>
      )}

      <div className="float hud-bottom glass" aria-live="polite">
        {selected ? (
          <>
            <span className="coord">{fmtCoord(selected.lat, selected.lon)}</span>
            <span>Local area scan</span>
            <span>Press Esc to return</span>
          </>
        ) : (
          <>
            <span>Lower score</span><span className="hud-ramp" aria-hidden="true" /><span>Higher score</span>
            <span className="hud-hint">{MapboxStage ? 'Right-drag to tilt, click a dot to fly in' : 'Hover a state, click it to focus'}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ value, label, sub }) {
  return (
    <div className="kpi">
      <b>{value}</b>
      <span>{label}</span>
      {sub && <small title={sub}>{sub}</small>}
    </div>
  );
}

function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function Insights({ all, pool, visible, community, hoveredId, onHover, onSelect, loading, minScore, setMinScore, pillars, events, areas, toggleArea, onClose }) {
  const [tab, setTab] = useState('top');
  const top10 = visible.slice(0, 10);
  const best = visible[0];
  const med = median(visible.map(scoreOf));
  const moved = visible.filter((s) => s.rank_change).length;
  const topStates = useMemo(() => {
    const c = {};
    top10.forEach((s) => { c[s.state] = (c[s.state] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [top10]);

  return (
    <div key="insights" className="panel-swap dash-body">
      <div className="float-head">
        <div className="dash-bar">
          <span className="eyebrow-glow"><i aria-hidden="true" />Insights</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close insights" title="Close insights  ]">
            <RightPanelClose size={20} aria-hidden="true" />
          </button>
        </div>
        <h2 className="dash-title">Siting dashboard</h2>
        <div className="kpis kpis-2x2">
          <Kpi value={visible.length} label="sites in view" sub={`of ${all.length} scored`} />
          <Kpi value={best ? Math.round(scoreOf(best)) : '-'} label="top score" sub={best?.name} />
          <Kpi value={med != null ? Math.round(med) : '-'} label="median score" sub="sites in view" />
          <Kpi value={community ? moved : 'Off'} label="moved by community" sub={community ? 'sites changed rank' : 'signals switched off'} />
        </div>
        <div className="tabs" role="tablist" aria-label="Insights">
          {[['top', 'Top 10'], ['analytics', 'Analytics'], ['community', 'Community']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="float-scroll" role="tabpanel">
        {tab === 'top' && (
          <>
            <p className="tiny muted" style={{ marginTop: -6 }}>{community ? 'Ranked after community signals. Arrows show the change from the model score.' : 'Ranked by the scoring model alone.'}</p>
            {loading && <p className="small muted">Scoring sites</p>}
            {!loading && !top10.length && <p className="small muted">No site meets your minimum score. Lower it to see more.</p>}
            <ol className="leaderboard">
              {top10.map((s, i) => (
                <li key={s.site_id}>
                  <button
                    type="button"
                    className={`lb-row${i < 3 ? ' podium' : ''}${hoveredId === s.site_id ? ' hot' : ''}`}
                    onClick={() => onSelect(s.site_id)}
                    onMouseEnter={() => onHover(s.site_id)}
                    onMouseLeave={() => onHover(null)}
                    onFocus={() => onHover(s.site_id)}
                    onBlur={() => onHover(null)}
                  >
                    <span className="lb-rank">{i + 1}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="lb-name" style={{ display: 'block' }}>{s.name}</span>
                      <span className="lb-sub">
                        {community && s.base_rank != null ? <><span>Model rank {s.base_rank}</span><RankDelta change={s.rank_change} /></> : <span>County {s.county_fips}</span>}
                      </span>
                      <span className="lb-bar" aria-hidden="true"><i style={{ width: `${scoreOf(s)}%` }} /></span>
                    </span>
                    <span className="lb-score">{Math.round(scoreOf(s))}<small>score</small></span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}

        {tab === 'analytics' && (
          <>
            <section className="dash-card">
              <div className="dash-sub"><h3 className="mini-head">Score distribution</h3><span className="tiny muted">Click a bar to set the minimum</span></div>
              <Histogram sites={pool} minScore={minScore} onPick={setMinScore} />
            </section>
            <section className="dash-card">
              <div className="dash-sub"><h3 className="mini-head">Pillar profile</h3><span className="tiny muted">Bar: top 10. Tick: all in view</span></div>
              <PillarProfile pillars={pillars} top={top10} all={visible} />
            </section>
            <section className="dash-card">
              <div className="dash-sub"><h3 className="mini-head">Where the top 10 are</h3><span className="tiny muted">Click to focus</span></div>
              <div className="preset-row">
                {topStates.map(([st, n]) => (
                  <button key={st} type="button" className="chip" aria-pressed={areas.includes(st)} onClick={() => toggleArea(st)}>
                    {STATES[st] || st}<b className="chip-count">{n}</b>
                  </button>
                ))}
                {!topStates.length && <p className="tiny muted">No sites in view.</p>}
              </div>
            </section>
          </>
        )}

        {tab === 'community' && <EventSummary events={events} />}
      </div>
    </div>
  );
}

function Histogram({ sites, minScore, onPick }) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i * 10, n: 0 }));
  sites.forEach((s) => { bins[Math.min(9, Math.floor(scoreOf(s) / 10))].n += 1; });
  const max = Math.max(1, ...bins.map((b) => b.n));
  return (
    <div className="histo" role="group" aria-label="Score distribution. Choose a bar to show only sites at or above that score.">
      {bins.map((b) => (
        <button
          key={b.lo}
          type="button"
          className={`hbar${b.lo < minScore ? ' off' : ''}${b.lo === minScore && minScore > 0 ? ' cut' : ''}`}
          style={{ '--h': `${Math.max(b.n ? 8 : 2, (b.n / max) * 100)}%`, '--c': `var(--s${1 + Math.min(4, Math.floor(b.lo / 20))})` }}
          onClick={() => onPick(b.lo === minScore ? 0 : Math.min(90, b.lo))}
          aria-label={`Scores ${b.lo} to ${b.lo + 9}: ${b.n} site${b.n === 1 ? '' : 's'}`}
          title={`${b.lo} to ${b.lo + 9}: ${b.n} site${b.n === 1 ? '' : 's'}`}
        >
          <span className="hcount">{b.n || ''}</span>
          <i />
          <span className="hlabel">{b.lo}</span>
        </button>
      ))}
    </div>
  );
}

function PillarProfile({ pillars, top, all }) {
  const avg = (list, id) => (list.length ? list.reduce((a, s) => a + (s.pillars?.[id] ?? 0), 0) / list.length : 0);
  return (
    <div className="bars">
      {pillars.map((p) => {
        const t = avg(top, p.id);
        const a = avg(all, p.id);
        return (
          <div className="bar-row" key={p.id} title={`${p.label}: top 10 average ${Math.round(t)}, all sites ${Math.round(a)}`}>
            <span>{p.label}</span>
            <span className="track profile-track"><i style={{ width: `${t}%` }} /><b style={{ left: `${a}%` }} aria-hidden="true" /></span>
            <span className="v">{Math.round(t)}</span>
          </div>
        );
      })}
    </div>
  );
}

const TONE_LABELS = { against: 'Against', for: 'For', watch: 'Watch', info: 'Other' };

function EventSummary({ events }) {
  const feats = events?.features || [];
  const counts = { against: 0, for: 0, watch: 0, info: 0 };
  feats.forEach((f) => { counts[f.properties.tone || 'info'] = (counts[f.properties.tone || 'info'] || 0) + 1; });
  const n = feats.length || 1;
  const latest = [...feats].sort((a, b) => String(b.properties.published_at).localeCompare(String(a.properties.published_at))).slice(0, 6);
  return (
    <>
      <section className="dash-card">
        <div className="dash-sub"><h3 className="mini-head">Community events, last 180 days</h3><span className="tiny muted">{feats.length} events</span></div>
        <div className="tone-bar" role="img" aria-label={Object.entries(counts).map(([k, v]) => `${TONE_LABELS[k]} ${v}`).join(', ')}>
          {Object.entries(counts).map(([k, v]) => v > 0 && <i key={k} className={`tone-${k}`} style={{ width: `${(v / n) * 100}%` }} />)}
        </div>
        <div className="tone-legend">
          {Object.entries(counts).map(([k, v]) => <span key={k}><i className={`tone-${k}`} />{TONE_LABELS[k]} <b>{v}</b></span>)}
        </div>
      </section>
      <section className="dash-card">
        <h3 className="mini-head">Latest</h3>
        {!latest.length && <p className="tiny muted">No events in view.</p>}
        <ul className="event-list">
          {latest.map((f) => (
            <li key={f.properties.id}>
              <i className={`tone-${f.properties.tone || 'info'}`} aria-hidden="true" />
              <span>
                <b>{f.properties.title}</b>
                <small>{f.properties.region}{f.properties.published_at ? `, ${timeAgo(f.properties.published_at)}` : ''}</small>
              </span>
            </li>
          ))}
        </ul>
        <Link to="/pulse" className="btn btn-quiet btn-small" style={{ justifySelf: 'start' }}><Radar size={16} aria-hidden="true" />Open community pulse</Link>
      </section>
    </>
  );
}

function ScoreRing({ value }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = setTimeout(() => setShown(value), 60); return () => clearTimeout(t); }, [value]);
  return (
    <div className="score-ring" role="img" aria-label={`Score ${Math.round(value)} out of 100`}>
      <svg viewBox="0 0 104 104">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0d9488" /><stop offset="50%" stopColor="#14b8a6" /><stop offset="100%" stopColor="#84cc16" />
          </linearGradient>
        </defs>
        <circle className="bg" cx="52" cy="52" r={r} />
        <circle className="fg" cx="52" cy="52" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} />
      </svg>
      <div className="val"><div><b>{Math.round(value)}</b><small>of 100</small></div></div>
    </div>
  );
}

function DeepDive({ site, pillars, tradeoff, onBack, onClose }) {
  const [tab, setTab] = useState('overview');
  const detail = useAsync(() => getSite(site.site_id), [site.site_id]);
  const pulse = detail.data?.pulse;
  const full = detail.data?.site || site;
  const adj = site.community;
  const f = pulse?.features;

  return (
    <div className="panel-swap" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="float-head" style={{ gap: 12 }}>
        <div className="dash-bar">
          <button type="button" className="back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />All sites</button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close deep dive" title="Close panel  ]">
            <RightPanelClose size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="dive-head">
          <ScoreRing value={scoreOf(site)} />
          <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
            <span className="eyebrow-glow"><i aria-hidden="true" />Site deep dive</span>
            <h2 style={{ fontSize: '1.35rem' }}>{site.name}</h2>
            <span className="small muted">{pulse?.name && !/^\d+$/.test(pulse.name) ? pulse.name : `County FIPS ${site.county_fips}`}</span>
            <span className="coords">{fmtCoord(site.lat, site.lon)}</span>
          </div>
        </div>
        <div className="kpis">
          <div className="kpi"><b>#{site.rank}</b><span>overall rank</span></div>
          <div className="kpi"><b>{Math.round(site.base_score ?? site.score)}</b><span>model score</span></div>
          <div className="kpi"><b>{site.rank_change > 0 ? `+${site.rank_change}` : site.rank_change ?? 0}</b><span>places from community</span></div>
        </div>
        <div className="tabs" role="tablist" aria-label="Site details">
          {[['overview', 'Overview'], ['community', 'Community'], ['tradeoffs', 'Trade-offs']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="float-scroll" role="tabpanel">
        {tab === 'overview' && (
          <>
            <div className="stack">
              <h3 style={{ fontSize: '0.95rem' }}>Pillar scores</h3>
              <div className="bars">
                {pillars.map((p) => (
                  <div className="bar-row" key={p.id}>
                    <span>{p.label}</span>
                    <span className="track"><i style={{ width: `${full.pillars?.[p.id] ?? 0}%` }} /></span>
                    <span className="v">{Math.round(full.pillars?.[p.id] ?? 0)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="pc">
              <div className="pros">
                <h4><CheckmarkOutline size={16} aria-hidden="true" />Strengths</h4>
                <ul>{(full.pros || []).map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
              <div className="cons">
                <h4><SubtractAlt size={16} aria-hidden="true" />Weaknesses</h4>
                <ul>{(full.cons || []).map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
            </div>
            {adj && (
              <div className="stack" style={{ gap: 6 }}>
                <h3 style={{ fontSize: '0.95rem' }}>Why it moved</h3>
                <ul className="note-list">{adj.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </div>
            )}
          </>
        )}

        {tab === 'community' && (
          <>
            {!pulse && <p className="small muted">{detail.loading ? 'Loading community signals' : 'No community data for this site yet.'}</p>}
            {pulse && (
              <>
                <p className="small">{pulse.headline}</p>
                {f && (
                  <div className="stack" style={{ gap: 10 }}>
                    <Gauge label="Opposition" value={f.opposition_index} tone="oppose" />
                    <Gauge label="Support" value={f.support_index} tone="support" />
                  </div>
                )}
                <div className="pc">
                  <div className="pros"><h4>For building here</h4><ul>{pulse.pros.map((p) => <li key={p.text}>{p.text}</li>)}</ul>{!pulse.pros.length && <p className="tiny muted">None yet</p>}</div>
                  <div className="cons"><h4>Against building here</h4><ul>{pulse.cons.map((c) => <li key={c.text}>{c.text}</li>)}</ul>{!pulse.cons.length && <p className="tiny muted">None yet</p>}</div>
                </div>
                {pulse.upcoming?.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    <h3 style={{ fontSize: '0.95rem' }}>Coming up</h3>
                    <ul className="note-list">{pulse.upcoming.map((u) => <li key={u.item_id}><b>{formatDate(u.date)}</b>: {u.summary}</li>)}</ul>
                  </div>
                )}
                {pulse.recent?.length > 0 && (
                  <div className="stack" style={{ gap: 8 }}>
                    <h3 style={{ fontSize: '0.95rem' }}>Latest local signals</h3>
                    {pulse.recent.slice(0, 4).map((it) => (
                      <div className="mini-signal" key={it.id}>
                        <b>{usableCopy(it.analysis?.summary) ? it.analysis.summary : it.title}</b>
                        <span className="row" style={{ gap: 6 }}>{it.analysis && <StanceTag stance={it.analysis.stance} />}{it.outlet}, {timeAgo(it.published_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Link to={`/pulse?region=${site.county_fips}`} className="btn btn-quiet btn-small" style={{ justifySelf: 'start' }}><Radar size={16} aria-hidden="true" />Open in community pulse</Link>
              </>
            )}
          </>
        )}

        {tab === 'tradeoffs' && (
          <>
            {!tradeoff && <p className="small muted">This site was left out by the trade-off limits.</p>}
            {tradeoff && (
              <>
                <p className="small muted">How well this project fits this place on the three Social Accord dimensions, with balanced weights. Combined fit {tradeoff.utility.toFixed(1)}, rank {tradeoff.rank}.</p>
                <div className="bars">
                  {DIMENSION_LABELS.map(([k, label]) => (
                    <div className="bar-row" key={k}>
                      <span>{label}</span>
                      <span className="track"><i style={{ width: `${tradeoff.dimensions?.[k] ?? 0}%` }} /></span>
                      <span className="v">{Math.round(tradeoff.dimensions?.[k] ?? 0)}</span>
                    </div>
                  ))}
                </div>
                {tradeoff.tensions?.length > 0 && <ul className="note-list">{tradeoff.tensions.map((n) => <li key={n}>{n}</li>)}</ul>}
                {tradeoff.notes?.length > 0 && <ul className="note-list">{tradeoff.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              </>
            )}
            <Link to="/tradeoffs" className="btn btn-quiet btn-small" style={{ justifySelf: 'start' }}><Scales size={16} aria-hidden="true" />Set your own trade-offs</Link>
          </>
        )}
      </div>
    </div>
  );
}

function Gauge({ label, value, tone }) {
  return (
    <div className={`gauge ${tone}`}>
      <div className="lbl"><span>{label}</span><span className="num">{Math.round(value * 100)}</span></div>
      <div className="track" role="img" aria-label={`${label}: ${Math.round(value * 100)} of 100`}><i style={{ width: `${value * 100}%` }} /></div>
    </div>
  );
}


function MapTab({ hasMapbox, styleId, setStyleId, layers, setLayers, stateCounts, areas, setAreas, toggleArea, onExport, exporting, visibleCount, eventCount }) {
  const setLayer = (k) => (v) => setLayers((l) => ({ ...l, [k]: v }));
  return (
    <div className="float-scroll">
      <div className="stack" style={{ gap: 8 }}>
        <label className="field" htmlFor="map-style"><span>Map style</span>
          <select id="map-style" className="select" value={styleId} onChange={(e) => setStyleId(e.target.value)} disabled={!hasMapbox}>
            {MAP_STYLE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        {!hasMapbox && <p className="tiny muted">Add VITE_MAPBOX_TOKEN to frontend/.env to switch from the hologram globe to satellite maps.</p>}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <h3 className="mini-head">Choose areas</h3>
        <label className="check"><input type="checkbox" checked={!areas.length} onChange={() => setAreas([])} />Show all states</label>
        <div className="area-list" role="group" aria-label="States">
          {stateCounts.map(([st, n]) => (
            <label key={st} className="check"><input type="checkbox" checked={areas.includes(st)} onChange={() => toggleArea(st)} />{STATES[st] || st}<span className="muted tiny">{n}</span></label>
          ))}
        </div>
        {areas.length > 0 && <p className="tiny muted">The map zooms to the sites in the states you pick.</p>}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <h3 className="mini-head">Layers</h3>
        <Switch id="layer-sites" label="Site scores" checked={layers.sites} onChange={setLayer('sites')} />
        <Switch id="layer-heat" label="Score heatmap" checked={layers.heatmap} onChange={setLayer('heatmap')} />
        <Switch id="layer-events" label="Community events" checked={layers.events} onChange={setLayer('events')} />
        {!hasMapbox && <p className="tiny muted">The heatmap and events layers need the satellite map.</p>}
      </div>

      <div className="legend-card">
        <h3 className="mini-head">Color map: sustainability score</h3>
        <div className="legend-gradient" aria-hidden="true" />
        <div className="legend-labels"><span>Low</span><span>Medium</span><span>High</span></div>
        <div className="swatches">
          <span><i style={{ background: 'var(--s1)' }} />Low</span>
          <span><i style={{ background: 'var(--s3)' }} />Medium</span>
          <span><i style={{ background: 'var(--s5)' }} />High</span>
        </div>
        <h3 className="mini-head" style={{ marginTop: 12 }}>Community events</h3>
        <ul className="event-legend">
          {EVENT_LEGEND.map(([tone, label]) => <li key={tone}><i className={`tone-${tone}`} />{label}</li>)}
        </ul>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <h3 className="mini-head">Export data</h3>
        <div className="export-row">
          <button type="button" className="btn btn-primary btn-small" onClick={() => onExport('excel')} disabled={Boolean(exporting)}><Download size={16} aria-hidden="true" />{exporting === 'excel' ? 'Preparing' : 'Excel'}</button>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => onExport('geojson')} disabled={Boolean(exporting)}><Download size={16} aria-hidden="true" />GeoJSON</button>
        </div>
        <p className="tiny muted">{visibleCount} visible sites and {eventCount} community events. Use GeoJSON in QGIS, ArcGIS or other GIS tools.</p>
      </div>
    </div>
  );
}
