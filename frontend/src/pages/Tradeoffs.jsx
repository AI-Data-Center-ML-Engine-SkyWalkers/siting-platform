import { useEffect, useState } from 'react';
import { evaluateTradeoffs, getTradeoffPresets } from '../api/client.js';
import { ImasonsMark, SampleBanner, Slider, Switch } from '../components/ui.jsx';
import { useAsync } from '../hooks/useData.js';

const PRESET_NAMES = [
  ['balanced', 'Balanced'],
  ['economic', 'Economic'],
  ['social', 'Social'],
  ['ecological', 'Ecological'],
];

const DIM_HINTS = {
  economic: 'Durable local value: tax, bills, investment, jobs.',
  social: 'Opportunity and wellbeing: access, place, health, equity.',
  ecological: 'Healthy natural systems: carbon, air, water, habitat, soil.',
};

const INDICATOR_IDS = [
  'tax_revenue', 'price_stability', 'capital_investment', 'economic_efficiency', 'gdp_contribution', 'jobs_wages',
  'digital_equity', 'access_utilities', 'education', 'sense_of_place', 'health_wellbeing', 'equity_inclusion',
  'carbon_climate', 'air_quality', 'water_quality', 'water_cycle', 'biodiversity', 'soil',
];

const DEFAULT = {
  dimensions: { economic: 34, social: 33, ecological: 33 },
  indicators: Object.fromEntries(INDICATOR_IDS.map((id) => [id, 50])),
  min_indicator: 30,
  exclude_moratoria: true,
  states_include: [],
  states_exclude: [],
  max_per_state: 2,
  top_n: 10,
};

export default function Tradeoffs() {
  const presets = useAsync(() => getTradeoffPresets(), []);
  const [params, setParams] = useState(DEFAULT);
  const [preset, setPreset] = useState('balanced');
  const [useCommunity, setUseCommunity] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [fineTune, setFineTune] = useState(false);
  const [picked, setPicked] = useState(null);
  const [debounced, setDebounced] = useState(params);
  useEffect(() => { const t = setTimeout(() => setDebounced(params), 250); return () => clearTimeout(t); }, [params]);
  const result = useAsync(() => evaluateTradeoffs(debounced, useCommunity), [JSON.stringify(debounced), useCommunity]);

  const set = (patch) => { setParams((p) => ({ ...p, ...patch })); setPreset(null); };
  const setDim = (k, v) => { setParams((p) => ({ ...p, dimensions: { ...p.dimensions, [k]: v } })); setPreset(null); };
  const setInd = (k, v) => { setParams((p) => ({ ...p, indicators: { ...p.indicators, [k]: v } })); setPreset(null); };
  const dimTotal = Object.values(params.dimensions).reduce((a, b) => a + b, 0) || 1;
  const meta = result.data?.indicators || [];
  const dimMeta = result.data?.dimensions || {};
  const rows = result.data?.results || [];
  const shown = showAll ? rows : rows.filter((r) => r.selected);
  const selected = rows.find((r) => r.site_id === picked) || shown[0] || rows[0];

  useEffect(() => {
    if (!rows.length) return;
    if (!picked || !rows.some((r) => r.site_id === picked)) {
      setPicked((shown[0] || rows[0]).site_id);
    }
  }, [rows, shown, picked]);

  return (
    <div className="wrap">
      <div className="page-head">
        <h1 style={{ fontSize: 'clamp(1.6rem, 1.3rem + 1.2vw, 2.1rem)' }}>Trade-offs</h1>
        <p>Balance economic, social and ecological value for each place, from tax revenue and power bills to jobs, health, water and biodiversity.</p>
        <a className="accord-lockup" href="https://imasons.org/the-imasons-social-accord/" target="_blank" rel="noreferrer">
          <ImasonsMark size={32} />
          <span>
            <b>iMasons Social Accord</b>
            Economic, social and ecological factors from the iMasons framework.
          </span>
        </a>
        <SampleBanner>Sample sites with illustrative values. Your ML model and live community signals replace them once connected.</SampleBanner>
      </div>

      <div className="tradeoffs">
        <aside className="panel" aria-label="Your trade-offs">
          <div className="group">
            <div className="row" role="group" aria-label="Presets">
              {PRESET_NAMES.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="chip"
                  aria-pressed={preset === id}
                  onClick={() => {
                    const p = presets.data?.presets?.[id];
                    if (p) {
                      setParams({
                        ...DEFAULT,
                        ...p,
                        dimensions: { ...DEFAULT.dimensions, ...(p.dimensions || {}) },
                        indicators: { ...DEFAULT.indicators, ...(p.indicators || {}) },
                      });
                      setPreset(id);
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="group">
            <h4>Social Accord dimensions</h4>
            {['economic', 'social', 'ecological'].map((k) => (
              <Slider
                key={k}
                id={`d-${k}`}
                label={dimMeta[k]?.label || { economic: 'Economic', social: 'Social', ecological: 'Ecological' }[k]}
                hint={dimMeta[k]?.blurb || DIM_HINTS[k]}
                value={params.dimensions[k]}
                onChange={(v) => setDim(k, v)}
                format={(v) => `${Math.round((100 * v) / dimTotal)}%`}
              />
            ))}
          </div>
          <div className="group">
            <button type="button" className="btn btn-quiet btn-small" aria-expanded={fineTune} onClick={() => setFineTune((v) => !v)}>
              {fineTune ? 'Hide individual indicators' : 'Weight individual indicators'}
            </button>
            {fineTune && (
              <div className="indicator-tune">
                {['economic', 'social', 'ecological'].map((d) => (
                  <div key={d} className="stack" style={{ gap: 10 }}>
                    <h4>{dimMeta[d]?.label || d}</h4>
                    {meta.filter((i) => i.dimension === d).map((i) => (
                      <Slider
                        key={i.id}
                        id={`i-${i.id}`}
                        label={i.label}
                        hint={`${i.how} (${i.kind})`}
                        min={0}
                        max={100}
                        step={5}
                        value={params.indicators[i.id] ?? 50}
                        onChange={(v) => setInd(i.id, v)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="group">
            <h4>Do no harm</h4>
            <Slider
              id="floor"
              label="No indicator below"
              min={0}
              max={50}
              step={5}
              value={params.min_indicator ?? 0}
              onChange={(v) => set({ min_indicator: v === 0 ? null : v })}
              format={(v) => (v === 0 ? 'Off' : `${v}`)}
              hint="A site cannot win on tax revenue while wrecking the water cycle."
            />
            <Slider id="perstate" label="Sites per state on the shortlist" min={1} max={5} step={1} value={params.max_per_state ?? 5} onChange={(v) => set({ max_per_state: v })} />
            <Slider id="topn" label="Shortlist size" min={3} max={15} step={1} value={params.top_n} onChange={(v) => set({ top_n: v })} />
            <Switch id="mor" label="Leave out places with a moratorium" checked={params.exclude_moratoria} onChange={(v) => set({ exclude_moratoria: v })} />
            <Switch id="comm" label="Use community signals" checked={useCommunity} onChange={setUseCommunity} />
          </div>
        </aside>

        <div className="stack" style={{ gap: 18 }}>
          <section className="panel" aria-label="How the project fits this place">
            <div className="panel-title">
              <h3>{selected ? selected.name : 'Fit for this place'}</h3>
              {selected && (
                <label className="field" style={{ minWidth: 200 }}>
                  <span className="sr-only">Site</span>
                  <select className="select" value={selected.site_id} onChange={(e) => setPicked(e.target.value)}>
                    {rows.map((r) => <option key={r.site_id} value={r.site_id}>{r.rank}. {r.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {selected ? (
              <div className="radar-layout">
                <div className="dim-pills">
                  {['economic', 'social', 'ecological'].map((d) => (
                    <span key={d} className={`dim-pill ${d}`}>
                      <b>{dimMeta[d]?.label || d}</b>
                      <span className="num">{Math.round(selected.dimensions[d])}</span>
                    </span>
                  ))}
                </div>
                <Radar site={selected} indicators={meta} />
                <div className="legend">
                  <span className="row" style={{ gap: 6 }}><svg width="14" height="10" aria-hidden="true"><rect width="14" height="10" fill="color-mix(in srgb, var(--ink-2) 25%, transparent)" stroke="var(--ink-2)" /></svg>Place today</span>
                  <span className="row" style={{ gap: 6 }}><svg width="14" height="10" aria-hidden="true"><rect width="14" height="10" fill="color-mix(in srgb, var(--moss) 30%, transparent)" stroke="var(--moss)" /></svg>With the project</span>
                  <span className="row" style={{ gap: 6 }}><svg width="14" height="10" aria-hidden="true"><rect width="14" height="10" fill="none" stroke="var(--sprout)" strokeDasharray="3 2" /></svg>Best in this set</span>
                </div>
                {selected.tensions.length > 0 && (
                  <div className="tensions">
                    {selected.tensions.map((t) => <p key={t} className="tension">{t}</p>)}
                  </div>
                )}
                {selected.notes.map((n) => <p key={n} className="small muted">{n}</p>)}
              </div>
            ) : (
              <p className="empty">{result.loading ? 'Scoring how each project fits its place.' : 'No sites meet your do-no-harm floor. Lower the floor or change the weights.'}</p>
            )}
          </section>

          <section className="panel" aria-label="Shortlist">
            <div className="panel-title">
              <h3>{showAll ? `All ${rows.length} sites that meet your limits` : `Your shortlist of ${shown.length}`}</h3>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show shortlist only' : 'Show all sites'}</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Rank</th><th>Site</th><th>Fit</th><th>Economic</th><th>Social</th><th>Ecological</th><th>Main tensions</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.site_id} className={r.site_id === selected?.site_id ? 'picked' : ''} onClick={() => setPicked(r.site_id)} style={{ cursor: 'pointer' }}>
                      <td className="num">{r.rank}</td>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}{r.pareto ? <span className="tag" style={{ marginLeft: 8 }}>Not beaten on every dimension</span> : null}</td>
                      <td>
                        <div className="utility">
                          <span className="num">{r.utility.toFixed(1)}</span>
                          <span className="track"><i style={{ width: `${r.utility}%` }} /></span>
                        </div>
                      </td>
                      <td className="num">{Math.round(r.dimensions.economic)}</td>
                      <td className="num">{Math.round(r.dimensions.social)}</td>
                      <td className="num">{Math.round(r.dimensions.ecological)}</td>
                      <td>
                        <div className="stack" style={{ gap: 4 }}>
                          {r.tensions.slice(0, 2).map((t) => <span className="small" key={t}>{t}</span>)}
                          {!r.tensions.length && <span className="small muted">No sharp tension in this set</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              {result.data?.disclaimer?.replace(/\s*It shows how well a project fits this place, and what it gives back\.?/i, '') || 'SitewellEco² does not rate communities or certify projects.'}
            </p>
            {result.data?.excluded?.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>{result.data.excluded.length} sites left out by your limits</summary>
                <ul className="note-list" style={{ marginTop: 8 }}>
                  {result.data.excluded.map((e) => <li key={e.site_id}><b>{e.name}</b>: {e.reason}</li>)}
                </ul>
              </details>
            )}
            {result.error && <p className="error">Could not evaluate trade-offs. {result.error.message}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function Radar({ site, indicators }) {
  const items = indicators.length ? indicators : [];
  const n = items.length || 1;
  const size = 620;
  const cx = size / 2;
  const cy = size / 2;
  const r = 235;
  const rings = [25, 50, 75, 100];
  const point = (i, value) => {
    const a = (-Math.PI / 2) + (i / n) * Math.PI * 2;
    const rr = (Math.max(0, Math.min(100, value)) / 100) * r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  };
  const poly = (values) => items.map((ind, i) => point(i, values?.[ind.id] ?? 0).join(',')).join(' ');
  const ringPoly = (pct) => items.map((_, i) => point(i, pct).join(',')).join(' ');
  const labelPos = (i) => {
    const a = (-Math.PI / 2) + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * (r + 32), cy + Math.sin(a) * (r + 32)];
  };
  const baseline = poly(site.baseline);
  const project = poly(site.indicators);
  const best = poly(site.best);

  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Radar of ${site.name}: place today, with the project, and the best profile in this set. Combined fit ${Math.round(site.utility)}.`}>
      <g className="radar-grid">
        {rings.map((v) => <polygon key={v} points={ringPoly(v)} />)}
        {items.map((ind, i) => {
          const [x, y] = point(i, 100);
          return <line key={ind.id} x1={cx} y1={cy} x2={x} y2={y} />;
        })}
      </g>
      <polygon className="radar-best" points={best} />
      <polygon className="radar-base" points={baseline} />
      <polygon className="radar-project" points={project} />
      {items.map((ind, i) => {
        const [x, y] = labelPos(i);
        return (
          <text key={ind.id} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className={`radar-label ${ind.dimension}`}>
            {ind.short}
          </text>
        );
      })}
      <circle className="radar-core" cx={cx} cy={cy} r={44} />
      <text x={cx} y={cy - 2} textAnchor="middle" className="radar-score">{Math.round(site.utility)}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" className="radar-score-label">fit</text>
      <title>
        {`${site.name}. Place today, with the project, and the best profile. Combined fit ${Math.round(site.utility)}. ${site.tensions.join('; ')}`}
      </title>
    </svg>
  );
}
