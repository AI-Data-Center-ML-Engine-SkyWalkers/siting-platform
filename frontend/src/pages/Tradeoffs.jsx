import { useEffect, useMemo, useState } from 'react';
import { evaluateTradeoffs, getTradeoffPresets } from '../api/client.js';
import { SampleBanner, Slider, Switch } from '../components/ui.jsx';
import { useAsync } from '../hooks/useData.js';

const PRESET_NAMES = [['balanced', 'Balanced'], ['speed', 'Speed to market'], ['community', 'Community first'], ['ecosystem', 'Ecosystem builder']];

const OBJECTIVES = [
  ['sustainability', 'Sustainability', "The scoring model's score, after community signals"],
  ['speed_to_power', 'Speed to power', 'Time to connect and distance to high-voltage lines'],
  ['cost', 'Cost', 'Land prices and the extra cost of building in a harsh climate'],
  ['community', 'Community acceptance', 'Local sentiment, restrictions and moratoria'],
  ['ecosystem', 'Ecosystem benefit', 'What the site gives back: reused waste heat and local jobs'],
];

const DEFAULT = {
  objectives: { sustainability: 40, speed_to_power: 20, cost: 15, community: 15, ecosystem: 10 },
  heat_reuse_value: 0.5, jobs_value: 0.5, jobs_multiplier: 2, max_water_stress: 4, max_time_to_power_years: null,
  min_sustainability: null, exclude_moratoria: true, states_include: [], states_exclude: [], max_per_state: 2, top_n: 10,
};

export default function Tradeoffs() {
  const presets = useAsync(() => getTradeoffPresets(), []);
  const [params, setParams] = useState(DEFAULT);
  const [preset, setPreset] = useState('balanced');
  const [useCommunity, setUseCommunity] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [debounced, setDebounced] = useState(params);
  useEffect(() => { const t = setTimeout(() => setDebounced(params), 250); return () => clearTimeout(t); }, [params]);
  const result = useAsync(() => evaluateTradeoffs(debounced, useCommunity), [JSON.stringify(debounced), useCommunity]);

  const set = (patch) => { setParams((p) => ({ ...p, ...patch })); setPreset(null); };
  const setObjective = (k, v) => { setParams((p) => ({ ...p, objectives: { ...p.objectives, [k]: v } })); setPreset(null); };
  const totalW = Object.values(params.objectives).reduce((a, b) => a + b, 0) || 1;
  const rows = result.data?.results || [];
  const shown = showAll ? rows : rows.filter((r) => r.selected);

  return (
    <div className="wrap">
      <div className="page-head">
        <h1 style={{ fontSize: 'clamp(2rem, 1.5rem + 2vw, 3rem)' }}>Trade-offs</h1>
        <p>Every project weighs things differently. Tell us what matters for yours, including what a site can give back to the place around it, and get a shortlist you can defend.</p>
        <SampleBanner>Sample sites with illustrative values. Your ML model and live community signals replace them once connected.</SampleBanner>
      </div>

      <div className="tradeoffs">
        <aside className="panel" aria-label="Your trade-offs">
          <div className="group">
            <div className="row" role="group" aria-label="Presets">
              {PRESET_NAMES.map(([id, label]) => (
                <button key={id} type="button" className="chip" aria-pressed={preset === id}
                  onClick={() => { const p = presets.data?.presets?.[id]; if (p) { setParams(p); setPreset(id); } }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="group">
            <h4>What matters most</h4>
            {OBJECTIVES.map(([k, label, hint]) => (
              <Slider key={k} id={`o-${k}`} label={label} hint={hint} value={params.objectives[k]} onChange={(v) => setObjective(k, v)}
                format={(v) => `${Math.round((100 * v) / totalW)}%`} />
            ))}
          </div>
          <div className="group">
            <h4>What the site gives back</h4>
            <Slider id="heat" label="Value reusing waste heat" value={Math.round(params.heat_reuse_value * 100)} onChange={(v) => set({ heat_reuse_value: v / 100 })}
              format={(v) => `${v}%`} hint="Cold places with heating demand can use the heat, which offsets a harsh climate." />
            <Slider id="jobs" label="Value creating jobs where needed" value={Math.round(params.jobs_value * 100)} onChange={(v) => set({ jobs_value: v / 100 })}
              format={(v) => `${v}%`} hint="Counts for more where unemployment is high." />
            <Slider id="mult" label="Jobs per direct job" min={1} max={5} step={0.5} value={params.jobs_multiplier} onChange={(v) => set({ jobs_multiplier: v })}
              format={(v) => v.toFixed(1)} hint="Direct jobs plus indirect ones: hotels, travel, restaurants and suppliers." />
          </div>
          <div className="group">
            <h4>Limits</h4>
            <Slider id="water" label="Highest water stress allowed" min={0} max={5} step={0.5} value={params.max_water_stress ?? 5}
              onChange={(v) => set({ max_water_stress: v >= 5 ? null : v })} format={(v) => (v >= 5 ? 'No limit' : `${v} of 5`)} />
            <Slider id="perstate" label="Sites per state on the shortlist" min={1} max={5} step={1} value={params.max_per_state ?? 5}
              onChange={(v) => set({ max_per_state: v })} />
            <Slider id="topn" label="Shortlist size" min={3} max={15} step={1} value={params.top_n} onChange={(v) => set({ top_n: v })} />
            <Switch id="mor" label="Leave out places with a moratorium" checked={params.exclude_moratoria} onChange={(v) => set({ exclude_moratoria: v })} />
            <Switch id="comm" label="Use community signals" checked={useCommunity} onChange={setUseCommunity} />
          </div>
        </aside>

        <div className="stack" style={{ gap: 18 }}>
          <section className="panel scatter" aria-label="Sustainability versus community acceptance">
            <div className="panel-title">
              <h3>Sustainability and community acceptance</h3>
              <span className="legend">
                <span className="row" style={{ gap: 6 }}><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="var(--moss)" /></svg>On your shortlist</span>
                <span className="row" style={{ gap: 6 }}><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--ink)" strokeDasharray="3 2" /></svg>Not beaten on every objective</span>
                <span>Bigger dot: more ecosystem benefit</span>
              </span>
            </div>
            <Scatter rows={rows} />
          </section>

          <section className="panel" aria-label="Shortlist">
            <div className="panel-title">
              <h3>{showAll ? `All ${rows.length} sites that meet your limits` : `Your shortlist of ${shown.length}`}</h3>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show shortlist only' : 'Show all sites'}</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Rank</th><th>Site</th><th>Overall</th><th>Objectives</th><th>Why it ranks here</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.site_id} className={r.selected ? 'picked' : ''}>
                      <td className="num">{r.rank}</td>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
                      <td>
                        <div className="utility">
                          <span className="num">{r.utility.toFixed(1)}</span>
                          <span className="track"><i style={{ width: `${r.utility}%` }} /></span>
                        </div>
                      </td>
                      <td>
                        <div className="mini" role="img" aria-label={OBJECTIVES.map(([k, l]) => `${l} ${Math.round(r.objectives[k])}`).join(', ')}>
                          {OBJECTIVES.map(([k, l]) => <i key={k} title={`${l}: ${Math.round(r.objectives[k])}`} style={{ height: `${Math.max(8, r.objectives[k])}%` }} />)}
                        </div>
                      </td>
                      <td>
                        <div className="stack" style={{ gap: 6 }}>
                          <span className="row" style={{ gap: 6 }}>{r.strengths.map((s) => <span className="tag" key={s}>{s}</span>)}</span>
                          {r.notes.map((n) => <span className="small muted" key={n}>{n}</span>)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>Bars in the objectives column, left to right: sustainability, speed to power, cost, community acceptance, ecosystem benefit.</p>
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

function Scatter({ rows }) {
  const W = 720, H = 420, m = { l: 52, r: 24, t: 16, b: 48 };
  const x = (v) => m.l + (v / 100) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / 100) * (H - m.t - m.b);
  const ticks = [0, 20, 40, 60, 80, 100];
  const ordered = useMemo(() => [...rows].sort((a, b) => a.selected - b.selected), [rows]);
  const labelled = new Set(rows.filter((r) => r.selected).slice(0, 6).map((r) => r.site_id));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Scatter plot of sites by sustainability and community acceptance">
      <g className="grid">
        {ticks.map((t) => <line key={`gx${t}`} x1={x(t)} x2={x(t)} y1={m.t} y2={H - m.b} />)}
        {ticks.map((t) => <line key={`gy${t}`} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />)}
      </g>
      <g className="axis">
        {ticks.map((t) => <text key={`tx${t}`} x={x(t)} y={H - m.b + 18} textAnchor="middle">{t}</text>)}
        {ticks.map((t) => <text key={`ty${t}`} x={m.l - 10} y={y(t) + 4} textAnchor="end">{t}</text>)}
        <text x={(m.l + W - m.r) / 2} y={H - 8} textAnchor="middle">Sustainability</text>
        <text transform={`translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">Community acceptance</text>
      </g>
      {ordered.map((r) => {
        const cx = x(r.objectives.sustainability), cy = y(r.objectives.community);
        const rad = 5 + (r.objectives.ecosystem / 100) * 11;
        return (
          <g key={r.site_id} className={`pt ${r.selected ? 'selected' : 'other'}`}>
            <circle cx={cx} cy={cy} r={rad}><title>{`${r.name}: sustainability ${Math.round(r.objectives.sustainability)}, community ${Math.round(r.objectives.community)}, ecosystem ${Math.round(r.objectives.ecosystem)}`}</title></circle>
            {r.pareto && <circle className="pareto" cx={cx} cy={cy} r={rad + 4} />}
            {labelled.has(r.site_id) && <text x={cx + rad + 6} y={cy + 4}>{r.name.split(',')[0]}</text>}
          </g>
        );
      })}
    </svg>
  );
}
