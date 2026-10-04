import { CircleCheck, CircleMinus, Radar, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getScoringMeta, getSite, rankSites } from '../api/client.js';
import USMap from '../components/USMap.jsx';
import { RankDelta, SampleBanner, Slider, Switch } from '../components/ui.jsx';
import { useAsync } from '../hooks/useData.js';
import { rampColor } from '../lib/format.js';

const PRESETS = [
  ['balanced', 'Balanced', { power: 50, water: 50, climate: 50, cooling: 50, land: 50, community: 50 }],
  ['carbon', 'Carbon first', { power: 90, water: 30, climate: 30, cooling: 40, land: 20, community: 20 }],
  ['water', 'Water first', { power: 30, water: 90, climate: 30, cooling: 40, land: 20, community: 20 }],
  ['resilience', 'Resilience first', { power: 30, water: 40, climate: 90, cooling: 30, land: 20, community: 30 }],
];

const PILLAR_HINTS = {
  power: 'Clean, available power and time to connect',
  water: 'Local water stress and water used by power plants',
  climate: 'Floods, wildfire, storms and heat',
  cooling: 'Free-cooling hours and waste-heat reuse',
  land: 'Reuse of brownfields and retired plants',
  community: 'Local opposition and economic need',
};

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function SiteFinder() {
  const meta = useAsync(() => getScoringMeta(), []);
  const [weights, setWeights] = useState(PRESETS[0][2]);
  const [preset, setPreset] = useState('balanced');
  const [community, setCommunity] = useState(true);
  const [selected, setSelected] = useState(null);
  const debounced = useDebounced(weights);
  const ranking = useAsync(() => rankSites({ n: 10, weights: debounced, community }), [JSON.stringify(debounced), community]);
  const sites = ranking.data?.sites || [];
  const pillars = meta.data?.pillars || [];
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;

  const scoreOf = (s) => s.final_score ?? s.score;
  const [lo, hi] = useMemo(() => {
    const v = sites.map(scoreOf);
    return v.length ? [Math.min(...v), Math.max(...v)] : [0, 100];
  }, [sites]);

  return (
    <div className="wrap">
      <div className="page-head">
        <h1 style={{ fontSize: 'clamp(2rem, 1.5rem + 2vw, 3rem)' }}>Site finder</h1>
        <p>The ten best candidate sites for your priorities. Move a slider and the ranking updates; click a site to see why it ranks where it does.</p>
        <SampleBanner>Sample sites with illustrative values. Connect your scoring model to rank real candidates.</SampleBanner>
      </div>

      <div className="finder">
        <aside className="panel stack" aria-label="Your priorities">
          <div className="panel-title" style={{ margin: 0 }}><h3>Your priorities</h3></div>
          <div className="row" role="group" aria-label="Presets">
            {PRESETS.map(([id, label, w]) => (
              <button key={id} type="button" className="chip" aria-pressed={preset === id} onClick={() => { setWeights(w); setPreset(id); }}>{label}</button>
            ))}
          </div>
          {pillars.map((p) => (
            <Slider
              key={p.id}
              id={`w-${p.id}`}
              label={p.label}
              value={weights[p.id] ?? 50}
              hint={PILLAR_HINTS[p.id]}
              format={(v) => `${Math.round((100 * v) / total)}%`}
              onChange={(v) => { setWeights((w) => ({ ...w, [p.id]: v })); setPreset(null); }}
            />
          ))}
          <Switch id="community" label="Adjust for community signals" checked={community} onChange={setCommunity} />
          <p className="tiny muted">Community signals come from the awareness engine: local sentiment, incentives, restrictions and moratoria.</p>
        </aside>

        <section className="panel" aria-label="Map">
          <div className="panel-title">
            <h3>Top {sites.length || 10} sites</h3>
            <span className="legend">
              <span className="num">{Math.round(lo)}</span>
              <span className="ramp" aria-hidden="true">{[1, 2, 3, 4, 5].map((b) => <i key={b} style={{ background: `var(--s${b})` }} />)}</span>
              <span className="num">{Math.round(hi)}</span>
              <span>score</span>
            </span>
          </div>
          <USMap
            ariaLabel="Top candidate sites, numbered by rank"
            selectedId={selected}
            onSelect={setSelected}
            markers={sites.map((s) => ({
              id: s.site_id, lat: s.lat, lon: s.lon, r: 13, text: s.rank,
              fill: rampColor(scoreOf(s), lo, hi),
              title: `${s.rank}. ${s.name}: score ${Math.round(scoreOf(s))}`,
            }))}
          />
          {ranking.error && <p className="error">Could not load the ranking. {ranking.error.message}</p>}
        </section>

        <section className="panel" aria-label="Ranking">
          <div className="panel-title"><h3>Ranking</h3><span className="tiny muted">{community ? 'after community signals' : 'model score only'}</span></div>
          <ol className="rank-list">
            {sites.map((s) => (
              <li key={s.site_id}>
                <button type="button" className="rank-item" aria-current={selected === s.site_id} onClick={() => setSelected(s.site_id)}>
                  <span className="rk">{s.rank}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nm" style={{ display: 'block' }}>{s.name}</span>
                    <span className="sub">
                      {community && s.base_rank != null ? <><span>model rank {s.base_rank}</span><RankDelta change={s.rank_change} /></> : <span>{Object.keys(s.pillars || {}).length} pillars scored</span>}
                    </span>
                  </span>
                  <span className="sc">{Math.round(scoreOf(s))}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {selected && <SiteDrawer siteId={selected} listed={sites.find((s) => s.site_id === selected)} pillars={pillars} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SiteDrawer({ siteId, listed, pillars, onClose }) {
  const detail = useAsync(() => getSite(siteId), [siteId]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const site = detail.data?.site || listed;
  const pulse = detail.data?.pulse;
  const adj = listed?.community;
  if (!site) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Details for ${site.name}`}>
        <div className="drawer-head">
          <div className="stack" style={{ gap: 4 }}>
            <h2>{site.name}</h2>
            {listed && <span className="muted small">Rank {listed.rank} of the current top 10</span>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>

        <div className="big-score">
          <strong>{Math.round(listed?.final_score ?? site.score)}</strong>
          <span className="muted">out of 100</span>
          {listed?.base_score != null && listed.final_score !== listed.base_score && (
            <span className="small muted">model score {Math.round(listed.base_score)}, adjusted for community</span>
          )}
        </div>

        {site.excluded && <p className="error">Excluded: {site.exclusion_reason}</p>}

        <div className="stack">
          <h3>Pillar scores</h3>
          <div className="bars">
            {pillars.map((p) => (
              <div className="bar-row" key={p.id}>
                <span>{p.label}</span>
                <span className="track"><i style={{ width: `${site.pillars?.[p.id] ?? 0}%` }} /></span>
                <span className="v">{Math.round(site.pillars?.[p.id] ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pc">
          <div className="pros">
            <h4><CircleCheck aria-hidden="true" />Strengths</h4>
            <ul>{(site.pros || []).map((p) => <li key={p}>{p}</li>)}</ul>
            {!site.pros?.length && <p className="small muted">None stand out against other sites.</p>}
          </div>
          <div className="cons">
            <h4><CircleMinus aria-hidden="true" />Weaknesses</h4>
            <ul>{(site.cons || []).map((c) => <li key={c}>{c}</li>)}</ul>
            {!site.cons?.length && <p className="small muted">None stand out against other sites.</p>}
          </div>
        </div>

        {adj && (
          <div className="stack">
            <h3>Community adjustment</h3>
            <ul className="note-list">{adj.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <p className="tiny muted">
              Multipliers: sentiment {adj.multipliers.sentiment.toFixed(2)}, incentives {adj.multipliers.incentive.toFixed(2)}, restrictions {adj.multipliers.restriction.toFixed(2)}{adj.active_moratorium ? ', moratorium sets the score to 0' : ''}.
            </p>
          </div>
        )}

        {pulse && (
          <div className="stack">
            <h3>Community pulse</h3>
            <p className="small">{pulse.headline}</p>
            {pulse.cons?.length > 0 && <ul className="note-list">{pulse.cons.slice(0, 3).map((c) => <li key={c.text}>{c.text}</li>)}</ul>}
            <Link to={`/pulse?region=${site.county_fips}`} className="btn btn-quiet btn-small" style={{ justifySelf: 'start' }}><Radar aria-hidden="true" />Open in community pulse</Link>
          </div>
        )}
        {detail.loading && !detail.data && <p className="small muted">Loading details</p>}
      </aside>
    </>
  );
}
