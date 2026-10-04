import { Bullhorn, Chat, CheckmarkOutline, Document, Launch, Notification, Policy, Rss, Search, TrashCan } from '@carbon/icons-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createWatchlist, deleteWatchlist, getAwarenessMap, getRegion, getTopics, getWatchlists, searchAwareness } from '../api/client.js';
import USMap from '../components/USMap.jsx';
import { AlertFeed, LiveDot, SampleBanner, StanceTag, Switch } from '../components/ui.jsx';
import { useAlerts, useAsync } from '../hooks/useData.js';
import { CREDIBILITY_LABELS, EVENT_LABELS, formatDate, SOURCE_TYPE_LABELS, STATES, timeAgo } from '../lib/format.js';

const SOURCE_ICONS = { legislation: Policy, government: Document, news: Rss, advocacy: Bullhorn, social: Chat };
const STANCES = [['', 'All'], ['oppose', 'Opposed'], ['support', 'Supportive'], ['mixed', 'Mixed'], ['neutral', 'Neutral']];
const ALERT_KINDS = [['moratorium', 'Moratoria'], ['incentive', 'Incentives'], ['policy_change', 'Laws passed'], ['bill', 'Bills'], ['hearing', 'Hearings'], ['protest', 'Protests'], ['sentiment_shift', 'Sentiment shifts'], ['lawsuit', 'Lawsuits']];

export default function Pulse() {
  const [params] = useSearchParams();
  const regionParam = params.get('region');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(true);
  const [state, setState] = useState(regionParam && regionParam.length === 2 ? regionParam : '');
  const [county, setCounty] = useState(regionParam && regionParam.length === 5 ? regionParam : '');
  const [topic, setTopic] = useState('');
  const [stance, setStance] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [days, setDays] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [query, semantic, state, county, topic, stance, sourceType, days]);

  const topics = useAsync(() => getTopics(), []);
  const search = useAsync(
    () => searchAwareness({ q: query, semantic, state, county, topic, stance, source_type: sourceType, days, page, size: 10 }),
    [query, semantic, state, county, topic, stance, sourceType, days, page],
  );
  const region = county || state;
  const total = search.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 10));

  return (
    <div className="wrap">
      <div className="page-head">
        <h1 style={{ fontSize: 'clamp(2rem, 1.5rem + 2vw, 3rem)' }}>Community pulse</h1>
        <p>What people, councils and legislatures are saying about data centers, place by place. Each item is summarized in plain language and links to its source.</p>
        <SampleBanner>These are sample items written to show how the pulse works. They are not real events. Start the backend to see collected news, bills and posts.</SampleBanner>
      </div>

      <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(draft.trim()); }}>
        <Search size={20} aria-hidden="true" />
        <label htmlFor="q" className="sr-only">Search</label>
        <input id="q" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Try: water limits, tax exemption, rezoning hearing" />
        <button type="submit" className="btn btn-primary btn-small">Search</button>
      </form>

      <div className="filters">
        <Switch id="semantic" label="Search by meaning" checked={semantic} onChange={setSemantic} />
        <label className="sr-only" htmlFor="f-state">State</label>
        <select id="f-state" className="select" value={state} onChange={(e) => { setState(e.target.value); setCounty(''); }}>
          <option value="">All states</option>
          {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-topic">Topic</label>
        <select id="f-topic" className="select" value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="">All topics</option>
          {(topics.data?.topics || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-source">Source</label>
        <select id="f-source" className="select" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
          <option value="">All sources</option>
          {Object.entries(SOURCE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}s</option>)}
        </select>
        <label className="sr-only" htmlFor="f-days">Time</label>
        <select id="f-days" className="select" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="">Any time</option>
          <option value="7">Past week</option>
          <option value="30">Past month</option>
          <option value="90">Past 3 months</option>
          <option value="365">Past year</option>
        </select>
        <div className="segmented" role="group" aria-label="Stance">
          {STANCES.map(([v, label]) => <button key={label} type="button" aria-pressed={stance === v} onClick={() => setStance(v)}>{label}</button>)}
        </div>
        {county && <button type="button" className="chip" onClick={() => setCounty('')}>County {county}: clear</button>}
      </div>

      <div className="pulse">
        <section aria-label="Results" className="stack">
          <p className="small muted" aria-live="polite">
            {search.loading ? 'Searching' : `${total} item${total === 1 ? '' : 's'}`}
            {search.data?.mode === 'semantic' && ', ranked by meaning'}
            {query && <> for &ldquo;{query}&rdquo;</>}
          </p>
          <div className="results">
            {(search.data?.results || []).map((item) => <Result key={item.id} item={item} />)}
          </div>
          {!search.loading && total === 0 && (
            <div className="panel empty">
              <b>Nothing matches yet.</b>
              <span className="small">Try fewer filters, a broader phrase, or run the collectors from the backend.</span>
            </div>
          )}
          {search.error && <p className="error">Search failed. {search.error.message}</p>}
          {pages > 1 && (
            <div className="pagination">
              <button type="button" className="btn btn-quiet btn-small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span className="small num">Page {page} of {pages}</span>
              <button type="button" className="btn btn-quiet btn-small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </section>

        <aside aria-label="Region pulse and alerts">
          {region ? <RegionPulse region={region} /> : <PulseMap onPick={setState} />}
          <LiveAlerts />
          <Watchlists defaultState={state} />
        </aside>
      </div>
    </div>
  );
}

function usableCopy(value) {
  return Boolean(value && value.trim() && !/^[\s.!?“”"'‘’…]+$/.test(value.trim()));
}

function Result({ item }) {
  const a = item.analysis;
  const Icon = SOURCE_ICONS[item.source_type] || Rss;
  const hasLink = item.url && item.url !== '#';
  return (
    <article className="result">
      <div className="result-meta">
        <span><Icon size={16} aria-hidden="true" /> {SOURCE_TYPE_LABELS[item.source_type]}{item.outlet ? `, ${item.outlet}` : ''}</span>
        {item.region && <span>{item.region}</span>}
        <time dateTime={item.published_at}>{timeAgo(item.published_at)}</time>
        {item.sample && <span className="tag sample">Sample</span>}
      </div>
      <h3>{hasLink ? <a href={item.url} target="_blank" rel="noreferrer">{item.title} <Launch size={16} aria-label="opens source" style={{ verticalAlign: -2 }} /></a> : item.title}</h3>
      {usableCopy(a?.summary) && a.summary.trim() !== (item.title || '').trim() && <p className="summary">{a.summary}</p>}
      {usableCopy(a?.evidence) && (
        <blockquote className="quote" style={{ margin: 0 }}>
          &ldquo;{a.evidence}&rdquo;
          <small>{a.evidence_verified ? 'Quote found in the source' : 'Quote could not be matched to the source; treat with care'}</small>
        </blockquote>
      )}
      <div className="result-tags">
        {a && <StanceTag stance={a.stance} />}
        {a && <span className="tag">{EVENT_LABELS[a.event_type] || a.event_type}</span>}
        {a?.topic_labels?.map((t) => <span className="tag" key={t}>{t}</span>)}
        {item.bill?.bill_number && <span className="tag">{item.bill.bill_number}: {item.bill.latest_action}</span>}
        {item.corroborated && <span className="tag ok"><CheckmarkOutline size={16} aria-hidden="true" />Reported by 2+ outlets</span>}
        <span className="tag" title="How much this source counts toward a region's signals">{CREDIBILITY_LABELS[item.source_type]}</span>
      </div>
    </article>
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

function RegionPulse({ region }) {
  const r = useAsync(() => getRegion(region), [region]);
  const d = r.data;
  return (
    <section className="panel stack" aria-label="Region pulse">
      <div className="panel-title" style={{ margin: 0 }}><h3>{d?.name || 'Region'}</h3>{d?.features?.active_moratorium && <span className="tag oppose">Moratorium</span>}</div>
      {d && (
        <>
          <p className="small">{d.headline}</p>
          <Gauge label="Opposition" value={d.features.opposition_index} tone="oppose" />
          <Gauge label="Support" value={d.features.support_index} tone="support" />
          <div className="pc">
            <div className="pros">
              <h4>For building here</h4>
              <ul>{d.pros.map((p) => <li key={p.text}>{p.text}<small>{p.detail}</small></li>)}</ul>
              {!d.pros.length && <p className="small muted">No positive signals yet.</p>}
            </div>
            <div className="cons">
              <h4>Against building here</h4>
              <ul>{d.cons.map((c) => <li key={c.text}>{c.text}<small>{c.detail}</small></li>)}</ul>
              {!d.cons.length && <p className="small muted">No concerns recorded yet.</p>}
            </div>
          </div>
          {d.policies?.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <h4 style={{ margin: 0, fontSize: '0.92rem' }}>Bills and policies</h4>
              <ul className="note-list">{d.policies.map((p) => <li key={p.item_id}>{p.title}{p.status ? `: ${p.status}` : ''}</li>)}</ul>
            </div>
          )}
          {d.upcoming?.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <h4 style={{ margin: 0, fontSize: '0.92rem' }}>Coming up</h4>
              <ul className="note-list">{d.upcoming.map((u) => <li key={u.item_id}><b>{formatDate(u.date)}</b>: {u.summary}</li>)}</ul>
            </div>
          )}
        </>
      )}
      {r.error && <p className="error">{r.error.message}</p>}
    </section>
  );
}

function PulseMap({ onPick }) {
  const m = useAsync(() => getAwarenessMap('state'), []);
  const regions = m.data?.regions || [];
  const tone = (net) => (net <= -0.1 ? 'var(--oppose)' : net >= 0.1 ? 'var(--support)' : 'var(--neutral)');
  return (
    <section className="panel" aria-label="Sentiment by state">
      <div className="panel-title"><h3>Sentiment by state</h3><span className="tiny muted">pick a state</span></div>
      <USMap
        className="pulse-map"
        ariaLabel="States with community signals; red leans opposed, teal leans supportive"
        bubbles={regions.map((r) => ({
          id: r.region, lat: r.lat, lon: r.lon, r: 8 + Math.sqrt(r.coverage || 1) * 5, fill: tone(r.net_sentiment),
          title: `${STATES[r.region] || r.name}: ${r.coverage} items, opposition ${Math.round(r.opposition_index * 100)}, support ${Math.round(r.support_index * 100)}`,
          label: r.region,
        }))}
        onSelect={onPick}
      />
      <p className="tiny muted" style={{ marginTop: 6 }}>Red leans opposed, teal leans supportive. Bigger circles have more coverage.</p>
    </section>
  );
}

function LiveAlerts() {
  const { alerts, connected, fresh } = useAlerts(12);
  return (
    <section className="panel" aria-label="Live alerts">
      <div className="panel-title"><h3>Live alerts</h3><LiveDot on={connected} /></div>
      <AlertFeed alerts={alerts} fresh={fresh} />
    </section>
  );
}

function Watchlists({ defaultState }) {
  const [list, setList] = useState([]);
  const [st, setSt] = useState(defaultState || '');
  const [kinds, setKinds] = useState(['moratorium', 'incentive', 'policy_change', 'sentiment_shift']);
  const [hook, setHook] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { getWatchlists().then((d) => setList(d.watchlists)).catch(() => {}); }, []);
  useEffect(() => { if (defaultState) setSt(defaultState); }, [defaultState]);

  const save = async (e) => {
    e.preventDefault();
    if (!st) { setMessage('Pick a state to watch.'); return; }
    try {
      const w = await createWatchlist({ name: `${STATES[st]} watch`, states: [st], kinds, webhook_url: hook || null });
      setList((l) => [...l, w]);
      setMessage(`Watching ${STATES[st]}. New alerts appear in the feed${hook ? ' and post to your webhook' : ''}.`);
    } catch (err) {
      setMessage(`Could not save the watch: ${err.message}`);
    }
  };

  return (
    <section className="panel stack" aria-label="Watch a region">
      <div className="panel-title" style={{ margin: 0 }}><h3><Notification size={16} aria-hidden="true" style={{ verticalAlign: -2 }} /> Watch a region</h3></div>
      <form className="stack" onSubmit={save}>
        <label className="field" htmlFor="w-state"><span>State</span>
          <select id="w-state" className="select" value={st} onChange={(e) => setSt(e.target.value)}>
            <option value="">Choose a state</option>
            {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <fieldset className="row" style={{ border: 'none', padding: 0, margin: 0, gap: 6 }}>
          <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Tell me about</legend>
          {ALERT_KINDS.map(([k, label]) => (
            <button key={k} type="button" className="chip" aria-pressed={kinds.includes(k)} onClick={() => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}>{label}</button>
          ))}
        </fieldset>
        <label className="field" htmlFor="w-hook"><span>Slack or Discord webhook (optional)</span>
          <input id="w-hook" className="input" type="url" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://hooks.slack.com/..." />
        </label>
        <button type="submit" className="btn btn-primary btn-small" style={{ justifySelf: 'start' }}>Start watching</button>
        {message && <p className="small" role="status">{message}</p>}
      </form>
      {list.length > 0 && (
        <ul className="note-list" style={{ listStyle: 'none', paddingLeft: 0 }}>
          {list.map((w) => (
            <li key={w.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{w.name}{w.kinds?.length ? `: ${w.kinds.length} alert types` : ''}</span>
              <button type="button" className="icon-btn" aria-label={`Stop watching ${w.name}`} onClick={async () => { await deleteWatchlist(w.id); setList((l) => l.filter((x) => x.id !== w.id)); }}><TrashCan size={16} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
