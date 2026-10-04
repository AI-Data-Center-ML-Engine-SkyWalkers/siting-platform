import { Add, ArrowDown, ArrowUp, Close, Subtract } from '@carbon/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { enginePareto, engineSolve, engineSweep, getEngineMeta } from '../api/client.js';
import PremiumSlider from '../components/PremiumSlider.jsx';
import { useAsync } from '../hooks/useData.js';
import { fmtNum, fmtWithUnit, shortLabel, tagsFor, ttpTag } from '../lib/metrics.js';

const PILLAR_IDS = new Set(['power', 'carbon', 'water', 'hazard', 'permission', 'land', 'cobenefit']);
const LIMIT_ORDER = ['time_to_power_yrs', 'co2_t', 'water_ml', 'energy_cost_musd', 'water_stress_2050', 'pue', 'wue', 'facility_mwh', 'co2_avg_grid_t'];
const GIVE_UP_METRICS = ['co2_t', 'water_ml', 'water_stress_2050', 'energy_cost_musd', 'time_to_power_yrs'];
const MAX_LIMITS = 3;
const SWEEP_STEPS = 12;

function niceStep(span) {
  if (!(span > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(span));
  const m = span / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

function sliderRange(m) {
  if (m.id === 'time_to_power_yrs') return { min: Math.floor(m.min), max: Math.ceil(m.max), step: 1 };
  if (m.unit === '0-1') return { min: Math.floor(m.min * 100) / 100, max: Math.ceil(m.max * 100) / 100, step: 0.01 };
  const step = niceStep((m.max - m.min) / 100);
  return { min: Math.floor(m.min / step) * step, max: Math.ceil(m.max / step) * step, step };
}

const opFor = (m) => (m.better === 'low' ? '<=' : '>=');
const loosestValue = (m) => { const r = sliderRange(m); return m.better === 'low' ? r.max : r.min; };
const approx = (v) => {
  const a = Math.abs(v);
  if (a < 10) return fmtNum(a);
  const p = 10 ** (Math.floor(Math.log10(a)) - 1);
  return (Math.round(a / p) * p).toLocaleString();
};
const placeName = (r) => (r ? `${r.county}, ${r.state}` : '');

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [key, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

function Tags({ tags }) {
  return tags.map((t) => <span key={t} className="tag judgment-tag">{t}</span>);
}

export default function Limits() {
  const navigate = useNavigate();
  const meta = useAsync(() => getEngineMeta(), []);
  const offline = meta.data?.unavailable;
  const metrics = meta.data?.metrics || [];
  const pillars = meta.data?.pillars || [];
  const byId = useMemo(() => Object.fromEntries(metrics.map((m) => [m.id, m])), [metrics]);
  const limitable = useMemo(
    () => LIMIT_ORDER.map((id) => byId[id]).filter((m) => m && m.min != null && m.max != null)
      .concat(metrics.filter((m) => PILLAR_IDS.has(m.id) && m.min != null)),
    [byId, metrics],
  );
  const axisMetrics = useMemo(() => metrics.filter((m) => !PILLAR_IDS.has(m.id) && m.id !== 'score'), [metrics]);

  const [objective, setObjective] = useState('score');
  const [limits, setLimits] = useState([]);
  const [ignore, setIgnore] = useState([]);
  const [minScore, setMinScore] = useState(0.6);
  const [tighten, setTighten] = useState('time_to_power_yrs');
  const [watch, setWatch] = useState('co2_t');
  const [px, setPx] = useState('co2_t');
  const [py, setPy] = useState('energy_cost_musd');

  const ready = metrics.length > 0;
  const constraints = limits.filter((l) => byId[l.metric]).map((l) => [l.metric, opFor(byId[l.metric]), l.value]);
  const body = useDebounced({ objective, constraints, ignore_pillars: ignore, min_score: minScore });

  const solved = useAsync(
    () => (ready ? engineSolve({ ...body, top_n: 10 }) : Promise.resolve(null)),
    [JSON.stringify(body), ready],
  );

  const sweepValues = useMemo(() => {
    const m = byId[tighten];
    if (!m || m.min == null) return null;
    if (tighten === 'time_to_power_yrs') {
      const out = [];
      for (let v = Math.ceil(m.max); v >= Math.floor(m.min); v -= 1) out.push(v);
      return out;
    }
    const [from, to] = m.better === 'low' ? [m.max, m.min] : [m.min, m.max];
    return Array.from({ length: SWEEP_STEPS }, (_, i) => from + ((to - from) * i) / (SWEEP_STEPS - 1));
  }, [byId, tighten]);
  const sweepBody = {
    metric: tighten,
    values: sweepValues,
    objective: body.objective,
    constraints: body.constraints.filter((c) => c[0] !== tighten),
    ignore_pillars: body.ignore_pillars,
    min_score: body.min_score,
  };
  const swept = useAsync(
    () => (ready && sweepValues ? engineSweep(sweepBody) : Promise.resolve(null)),
    [JSON.stringify(sweepBody), ready],
  );
  const pareto = useAsync(
    () => (ready ? enginePareto({ x: px, y: py, min_score: body.min_score }) : Promise.resolve(null)),
    [px, py, body.min_score, ready],
  );

  if (meta.loading && !meta.data) return <section className="panel"><p className="empty">Loading the trade-off engine</p></section>;
  if (offline) {
    return (
      <section className="panel">
        <div className="empty">
          <b>{meta.data.message}</b>
          <span className="small">Start it with <code>uvicorn service.main:app --port 8001</code> in the scoring repo, and set <code>SCORING_PROVIDER=http</code> in <code>backend/.env</code>.</span>
        </div>
      </section>
    );
  }
  if (meta.error) return <section className="panel"><p className="error">Could not reach the trade-off engine. {meta.error.message}</p></section>;

  const s = solved.data;
  const best = s?.best;
  const reference = pareto.data?.reference;
  const refName = reference ? placeName(reference) : 'the reference county';
  const solvedObjective = s?.objective ?? objective;
  const goalMeta = byId[solvedObjective];
  const goalText = solvedObjective === 'score'
    ? 'the best overall score'
    : `the ${goalMeta?.better === 'low' ? 'lowest' : 'highest'} ${shortLabel(goalMeta?.label, goalMeta?.id)}`;

  const usedMetrics = new Set(limits.map((l) => l.metric));
  const addLimit = () => {
    const m = limitable.find((x) => !usedMetrics.has(x.id));
    if (m) setLimits((ls) => [...ls, { metric: m.id, value: loosestValue(m) }]);
  };
  const setLimit = (i, patch) => setLimits((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLimit = (i) => setLimits((ls) => ls.filter((_, j) => j !== i));
  const toggleIgnore = (id) => setIgnore((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const openSite = (fips) => navigate(`/sites?site=${encodeURIComponent(fips)}`);

  const applyLoosest = (binding) => {
    const v = binding.loosest_feasible;
    if (binding.metric === 'score') {
      setMinScore(Math.max(0, Math.floor(v * 20) / 20));
      return;
    }
    const m = byId[binding.metric];
    const { step } = sliderRange(m);
    const snapped = binding.op.startsWith('<') ? Math.ceil(v / step) * step : Math.floor(v / step) * step;
    setLimits((ls) => ls.map((l) => (l.metric === binding.metric ? { ...l, value: Number(snapped.toFixed(4)) } : l)));
  };

  return (
    <div className="tradeoffs limits">
      <aside className="panel" aria-label="Goal and limits">
        <div className="group">
          <h4>Goal</h4>
          <label className="field" htmlFor="limits-goal">
            <span className="sr-only">Goal</span>
            <select id="limits-goal" className="select" value={objective} onChange={(e) => setObjective(e.target.value)}>
              <option value="score">Best overall</option>
              {metrics.filter((m) => m.id !== 'score').map((m) => (
                <option key={m.id} value={m.id}>{m.better === 'low' ? 'Lowest' : 'Highest'} {optionLabel(m)}</option>
              ))}
            </select>
          </label>
          {tagsFor(objective).length > 0 && <div className="row" style={{ gap: 6 }}><Tags tags={tagsFor(objective)} /></div>}
        </div>

        <div className="group">
          <h4>Limits</h4>
          {!limits.length && <p className="tiny muted">No limits yet. Add one, such as time to power, and slide it tighter.</p>}
          {limits.map((l, i) => {
            const m = byId[l.metric];
            if (!m) return null;
            const r = sliderRange(m);
            return (
              <div key={`${l.metric}-${i}`} className="limit-row">
                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <select
                    className="select"
                    aria-label={`Limit ${i + 1} metric`}
                    value={l.metric}
                    onChange={(e) => setLimit(i, { metric: e.target.value, value: loosestValue(byId[e.target.value]) })}
                  >
                    {limitable.filter((x) => x.id === l.metric || !usedMetrics.has(x.id)).map((x) => (
                      <option key={x.id} value={x.id}>{optionLabel(x)}</option>
                    ))}
                  </select>
                  <button type="button" className="icon-btn" onClick={() => removeLimit(i)} aria-label={`Remove limit on ${shortLabel(m.label, m.id)}`}><Close size={16} aria-hidden="true" /></button>
                </div>
                <PremiumSlider
                  id={`limit-${i}`}
                  label={`${opFor(m) === '<=' ? 'At most' : 'At least'}`}
                  min={r.min}
                  max={r.max}
                  step={r.step}
                  value={l.value}
                  onChange={(v) => setLimit(i, { value: v })}
                  format={(v) => fmtWithUnit(v, m.unit)}
                />
                <Tags tags={tagsFor(m.id)} />
              </div>
            );
          })}
          {limits.length < MAX_LIMITS && (
            <button type="button" className="btn btn-quiet btn-small" style={{ justifySelf: 'start' }} onClick={addLimit} disabled={!limitable.length}>
              <Add size={16} aria-hidden="true" />Add limit
            </button>
          )}
        </div>

        <div className="group">
          <h4>Ignore in score</h4>
          <p className="tiny muted" style={{ marginTop: -8 }}>Leave a pillar out of the overall score, for example to accept more climate risk.</p>
          <div className="preset-row" role="group" aria-label="Pillars to ignore">
            {pillars.map((p) => (
              <button key={p.id} type="button" className="chip" aria-pressed={ignore.includes(p.id)} onClick={() => toggleIgnore(p.id)}>{p.label}</button>
            ))}
          </div>
        </div>

        <div className="group">
          <PremiumSlider
            id="limits-min-score"
            label="Minimum overall score"
            min={0}
            max={0.7}
            step={0.05}
            value={minScore}
            onChange={setMinScore}
            format={(v) => v.toFixed(2)}
            hint="Keeps answers among buildable sites."
          />
        </div>
      </aside>

      <div className="stack" style={{ gap: 14 }}>
        <section className="panel" aria-label="Answer">
          {solved.error && <p className="error">The trade-off engine failed. {solved.error.message}</p>}
          {!s && !solved.error && <p className="empty">Solving</p>}
          {s && best && (
            <AnswerCard best={best} s={s} goalText={goalText} byId={byId} refName={refName} reference={reference} objective={solvedObjective} onOpen={openSite} />
          )}
          {s && !best && s.binding && <NoAnswer binding={s.binding} byId={byId} onApply={() => applyLoosest(s.binding)} />}
          {s && !best && !s.binding && <p className="empty">No county meets these limits.</p>}
        </section>

        <section className="panel" aria-label="Trade-off curve">
          <div className="panel-title">
            <h3>Trade-off curve</h3>
            <div className="row" style={{ gap: 8 }}>
              <label className="field inline-field"><span>Tighten</span>
                <select className="select" value={tighten} onChange={(e) => setTighten(e.target.value)}>
                  {axisMetrics.map((m) => <option key={m.id} value={m.id}>{optionLabel(m)}</option>)}
                </select>
              </label>
              <label className="field inline-field"><span>Watch</span>
                <select className="select" value={watch} onChange={(e) => setWatch(e.target.value)}>
                  {axisMetrics.map((m) => <option key={m.id} value={m.id}>{optionLabel(m)}</option>)}
                </select>
              </label>
            </div>
          </div>
          {swept.error && <p className="error">{swept.error.message}</p>}
          {swept.data?.rows && byId[tighten] && byId[watch] && (
            <Curve rows={swept.data.rows} tighten={byId[tighten]} watch={byId[watch]} />
          )}
        </section>

        <section className="panel" aria-label="Pareto front">
          <div className="panel-title">
            <h3>Pareto front</h3>
            <div className="row" style={{ gap: 8 }}>
              <label className="field inline-field"><span>X</span>
                <select className="select" value={px} onChange={(e) => setPx(e.target.value)}>
                  {axisMetrics.map((m) => <option key={m.id} value={m.id}>{optionLabel(m)}</option>)}
                </select>
              </label>
              <label className="field inline-field"><span>Y</span>
                <select className="select" value={py} onChange={(e) => setPy(e.target.value)}>
                  {axisMetrics.map((m) => <option key={m.id} value={m.id}>{optionLabel(m)}</option>)}
                </select>
              </label>
            </div>
          </div>
          {pareto.error && <p className="error">{pareto.error.message}</p>}
          {pareto.data?.points && byId[px] && byId[py] && (
            <Pareto data={pareto.data} xm={byId[px]} ym={byId[py]} bestFips={best?.fips} onOpen={openSite} />
          )}
        </section>
      </div>

      <aside className="panel" aria-label="Top 10 under your limits">
        <div className="panel-title"><h3>Top 10 under your limits</h3></div>
        {s && <p className="tiny muted" style={{ marginTop: -6 }}>{s.n_feasible.toLocaleString()} counties meet your limits. Click one for the deep dive.</p>}
        <ol className="leaderboard">
          {(s?.top || []).map((r, i) => (
            <li key={r.fips}>
              <button type="button" className={`lb-row${i < 3 ? ' podium' : ''}`} onClick={() => openSite(r.fips)}>
                <span className="lb-rank">{i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="lb-name" style={{ display: 'block' }}>{placeName(r)}</span>
                  <span className="lb-sub">
                    {solvedObjective === 'score'
                      ? <span>Time to power {fmtNum(r.time_to_power_yrs)} yrs</span>
                      : <span>{fmtWithUnit(r.objective_value, goalMeta?.unit)}</span>}
                    {ttpTag(r) && <span className="tag judgment-tag">{ttpTag(r)}</span>}
                  </span>
                </span>
                <span className="lb-score">{Math.round(100 * r.score)}<small>score</small></span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function AnswerCard({ best, s, goalText, byId, refName, reference, objective, onOpen }) {
  const worse = (s.compare || [])
    .filter((r) => GIVE_UP_METRICS.includes(r.metric) && r.change === 'worse' && byId[r.metric])
    .map((r) => ({ ...r, size: Math.abs(r.abs_change) / Math.max(1e-9, byId[r.metric].max - byId[r.metric].min) }))
    .sort((a, b) => b.size - a.size)[0];
  const isRef = reference && best.fips === reference.fips;
  let giveUp;
  if (isRef) giveUp = <>nothing: {refName} itself is the answer.</>;
  else if (!worse) giveUp = <>nothing on carbon, water, cost or time to power compared with {refName}.</>;
  else {
    const pct = worse.pct_change != null ? ` (${worse.pct_change > 0 ? '+' : ''}${Math.round(worse.pct_change)}%)` : '';
    giveUp = <>on <b>{shortLabel(worse.label, worse.metric)}</b>: {fmtWithUnit(worse.best, worse.unit)} against {fmtWithUnit(worse.reference, worse.unit)} in {refName}{pct}.</>;
  }
  const rows = (s.compare || []).filter((r) => !PILLAR_IDS.has(r.metric));
  return (
    <div className="answer">
      <div className="answer-head">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow-glow"><i aria-hidden="true" />Answer</span>
          <h2 style={{ fontSize: '1.4rem' }}>{placeName(best)}</h2>
          <p className="small">To get {goalText} within your limits, you give up {giveUp}</p>
        </div>
        <div className="kpis answer-kpis">
          <div className="kpi"><b>{Math.round(100 * best.score)}</b><span>overall score</span></div>
          {objective !== 'score' && <div className="kpi"><b>{fmtNum(s.objective_value, byId[objective]?.unit)}</b><span>{byId[objective]?.unit}</span></div>}
          <div className="kpi"><b>{s.n_feasible.toLocaleString()}</b><span>counties fit</span></div>
        </div>
      </div>
      <button type="button" className="btn btn-quiet btn-small" style={{ justifySelf: 'start' }} onClick={() => onOpen(best.fips)}>Open site deep dive</button>
      <div className="table-wrap">
        <table className="compare-table">
          <thead><tr><th>Metric</th><th>{placeName(best)}</th><th>{refName}</th><th>Change</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const sign = r.abs_change > 0 ? 1 : r.abs_change < 0 ? -1 : 0;
              const cls = r.change === 'better' ? 'up' : r.change === 'worse' ? 'down' : 'same';
              const Icon = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Subtract;
              return (
                <tr key={r.metric}>
                  <td>{shortLabel(r.label, r.metric)} <Tags tags={tagsFor(r.metric)} /></td>
                  <td className="num">{fmtWithUnit(r.best, r.unit)} {r.metric === 'time_to_power_yrs' && <Tags tags={tagsFor(r.metric, best).filter((t) => t !== 'assumption')} />}</td>
                  <td className="num">{fmtWithUnit(r.reference, r.unit)} {r.metric === 'time_to_power_yrs' && reference && <Tags tags={tagsFor(r.metric, reference)} />}</td>
                  <td>
                    <span className={`delta ${cls}`}>
                      <Icon size={16} aria-hidden="true" />
                      {r.change === 'same' ? 'same' : `${fmtNum(Math.abs(r.abs_change), r.unit)}${r.pct_change != null ? ` (${Math.abs(Math.round(r.pct_change))}%)` : ''}`}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NoAnswer({ binding, byId, onApply }) {
  const m = byId[binding.metric];
  const label = binding.metric === 'score' ? 'Minimum overall score' : shortLabel(m?.label || binding.metric, binding.metric);
  const unit = binding.metric === 'score' ? '0-1' : m?.unit;
  return (
    <div className="empty" style={{ justifyItems: 'start', textAlign: 'left' }}>
      <b>No county meets these limits.</b>
      <span className="small">
        The binding limit is <b>{label}</b> {binding.op} {fmtWithUnit(binding.asked, unit)}: on its own it removes {binding.removes.toLocaleString()} of {binding.n_candidates.toLocaleString()} counties.
        {binding.loosest_feasible != null && <> The loosest value that works is <b>{fmtWithUnit(binding.loosest_feasible, unit)}</b>.</>}
        {binding.n_other_feasible === 0 && ' Your other limits also rule out every county, so loosen those too.'}
      </span>
      {binding.loosest_feasible != null && (
        <button type="button" className="btn btn-primary btn-small" onClick={onApply}>Use {fmtWithUnit(binding.loosest_feasible, unit)}</button>
      )}
    </div>
  );
}

// ---------- Charts (plain SVG) ----------
const W = 640;
const H = 280;
const PAD = { l: 64, r: 20, t: 18, b: 42 };

function scale(lo, hi, a, b) {
  const span = hi - lo || 1;
  return (v) => a + ((v - lo) / span) * (b - a);
}
function ticks(lo, hi, n = 5) {
  const step = niceStep((hi - lo) / n);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Number(v.toFixed(6)));
  return out;
}
function extent(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (!v.length) return [0, 1];
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

function Axes({ xs, ys, xLo, xHi, yLo, yHi, xLabel, yLabel }) {
  return (
    <>
      <g className="grid">
        {ticks(yLo, yHi).map((t) => <line key={`gy${t}`} x1={PAD.l} x2={W - PAD.r} y1={ys(t)} y2={ys(t)} />)}
      </g>
      <g className="axis">
        {ticks(xLo, xHi).map((t) => (
          <text key={`x${t}`} x={xs(t)} y={H - PAD.b + 16} textAnchor="middle">{fmtNum(t)}</text>
        ))}
        {ticks(yLo, yHi).map((t) => (
          <text key={`y${t}`} x={PAD.l - 8} y={ys(t) + 4} textAnchor="end">{fmtNum(t)}</text>
        ))}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle">{xLabel}</text>
        <text x={14} y={(PAD.t + H - PAD.b) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(PAD.t + H - PAD.b) / 2})`}>{yLabel}</text>
      </g>
    </>
  );
}

const optionLabel = (m) => {
  const tags = tagsFor(m.id);
  return `${shortLabel(m.label, m.id)}${tags.length ? ` (${tags.join(', ')})` : ''}`;
};
const axisLabel = (m) => {
  const tags = tagsFor(m.id);
  return `${shortLabel(m.label, m.id)}${tags.length ? `, ${tags.join(', ')}` : ''}${m.unit && !['0-1', '0-5'].includes(m.unit) ? ` (${m.unit})` : ''}`;
};

function Curve({ rows, tighten, watch }) {
  const pts = rows.filter((r) => r.fips && r[watch.id] != null);
  if (!pts.length) return <p className="empty">No county meets your other limits anywhere along this range.</p>;

  const firstChange = rows.findIndex((r) => r.best_changed);
  let headline = `Tightening ${shortLabel(tighten.label, tighten.id).toLowerCase()} across this range does not change the best county.`;
  if (firstChange > 0) {
    const loose = rows[firstChange - 1];
    const tight = [...rows].reverse().find((r) => r.fips);
    const d = tight[watch.id] - loose[watch.id];
    const worse = watch.better === 'low' ? d > 0 : d < 0;
    const more = d > 0 ? 'more' : 'less';
    const what = watch.unit && watch.unit !== '0-1' ? watch.unit : shortLabel(watch.label, watch.id);
    const lead = tighten.id === 'time_to_power_yrs'
      ? `Power in ${fmtNum(tight[tighten.id])} years instead of ${fmtNum(loose[tighten.id])}`
      : `${shortLabel(tighten.label, tighten.id)} at ${fmtWithUnit(tight[tighten.id], tighten.unit)} instead of ${fmtWithUnit(loose[tighten.id], tighten.unit)}`;
    headline = Math.abs(d) < 1e-9
      ? `${lead} changes the county but not ${shortLabel(watch.label, watch.id)}.`
      : `${lead} ${worse ? 'costs' : 'saves'} ~${approx(d)} ${more} ${what}.`;
  }

  const [xLo, xHi] = extent(pts.map((r) => r.limit));
  const [yLo, yHi] = extent(pts.map((r) => r[watch.id]));
  const xs = scale(xLo, xHi, PAD.l, W - PAD.r);
  const ys = scale(yLo, yHi, H - PAD.b, PAD.t);
  const sorted = [...pts].sort((a, b) => a.limit - b.limit);
  const path = sorted.map((r, i) => `${i ? 'L' : 'M'}${xs(r.limit)},${ys(r[watch.id])}`).join(' ');
  const tighterLeft = tighten.better === 'low';

  return (
    <div className="scatter chart">
      <p className="curve-headline">{headline}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={headline}>
        <Axes xs={xs} ys={ys} xLo={xLo} xHi={xHi} yLo={yLo} yHi={yHi}
          xLabel={`${axisLabel(tighten)} limit, ${tighterLeft ? 'tighter to the left' : 'tighter to the right'}`} yLabel={axisLabel(watch)} />
        <path className="curve-line" d={path} />
        {sorted.map((r) => (
          <g key={r.limit} className={`pt${r.best_changed ? ' change' : ''}`}>
            <circle cx={xs(r.limit)} cy={ys(r[watch.id])} r={r.best_changed ? 6 : 4} />
            <title>{`Limit ${fmtWithUnit(r.limit, tighten.unit)}: ${placeName(r)}, ${fmtWithUnit(r[watch.id], watch.unit)}`}</title>
            {r.best_changed && <text x={xs(r.limit)} y={ys(r[watch.id]) - 12} textAnchor="middle">{placeName(r)}</text>}
          </g>
        ))}
        {sorted[sorted.length - 1] && !sorted[sorted.length - 1].best_changed && (
          <g className="pt">
            <text x={xs(sorted[sorted.length - 1].limit) - 4} y={ys(sorted[sorted.length - 1][watch.id]) - 12} textAnchor="end">{placeName(sorted[sorted.length - 1])}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

function Pareto({ data, xm, ym, bestFips, onOpen }) {
  const pts = data.points.filter((p) => p[xm.id] != null && p[ym.id] != null);
  if (!pts.length) return <p className="empty">No candidates with both values at this minimum score.</p>;
  const [xLo, xHi] = extent(pts.map((p) => p[xm.id]));
  const [yLo, yHi] = extent(pts.map((p) => p[ym.id]));
  const xs = scale(xLo, xHi, PAD.l, W - PAD.r);
  const ys = scale(yLo, yHi, H - PAD.b, PAD.t);
  const front = pts.filter((p) => p.on_front).sort((a, b) => a[xm.id] - b[xm.id]);
  const frontPath = front.map((p, i) => `${i ? 'L' : 'M'}${xs(p[xm.id])},${ys(p[ym.id])}`).join(' ');
  const labeled = pts.filter((p) => p.is_reference || p.fips === bestFips);

  return (
    <div className="scatter chart">
      <p className="tiny muted">{pts.length} candidates scoring at least {fmtNum(data.min_score)}. {front.length} are on the front: nothing beats them on both axes.</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Pareto front of ${axisLabel(xm)} against ${axisLabel(ym)}`}>
        <Axes xs={xs} ys={ys} xLo={xLo} xHi={xHi} yLo={yLo} yHi={yHi} xLabel={axisLabel(xm)} yLabel={axisLabel(ym)} />
        {pts.filter((p) => !p.on_front).map((p) => (
          <g key={p.fips} className="pt other" onClick={() => onOpen(p.fips)}>
            <circle cx={xs(p[xm.id])} cy={ys(p[ym.id])} r={3.5} />
            <title>{`${placeName(p)}: ${fmtWithUnit(p[xm.id], xm.unit)}, ${fmtWithUnit(p[ym.id], ym.unit)}`}</title>
          </g>
        ))}
        {frontPath && <path className="front-line" d={frontPath} />}
        {front.map((p) => (
          <g key={p.fips} className="pt selected" onClick={() => onOpen(p.fips)}>
            <circle cx={xs(p[xm.id])} cy={ys(p[ym.id])} r={5} />
            <title>{`${placeName(p)} (on the front): ${fmtWithUnit(p[xm.id], xm.unit)}, ${fmtWithUnit(p[ym.id], ym.unit)}`}</title>
          </g>
        ))}
        {labeled.map((p, i) => (
          <g key={`l-${p.fips}`} className={`pt ${p.is_reference ? 'ref' : 'best'}`} onClick={() => onOpen(p.fips)}>
            <circle cx={xs(p[xm.id])} cy={ys(p[ym.id])} r={7} className="ring" />
            <text x={xs(p[xm.id]) + 10} y={ys(p[ym.id]) + (i % 2 ? 16 : -10)}>{placeName(p)}{p.is_reference ? ' (reference)' : ' (current best)'}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
