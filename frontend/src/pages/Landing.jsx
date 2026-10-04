import { MapPinned, Radar, SlidersHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { rankSites } from '../api/client.js';
import Contours from '../components/Contours.jsx';
import USMap from '../components/USMap.jsx';
import { AlertFeed, LiveDot } from '../components/ui.jsx';
import { useAlerts, useAsync, useDataMode } from '../hooks/useData.js';

const STEPS = [
  ['Collect public data', 'Grid carbon, water stress, climate risk, land and transmission from government datasets.'],
  ['Score every site', 'Our model weighs each factor and ranks candidate sites on sustainability.'],
  ['Listen to communities', 'News, bills, council agendas and public posts adjust the ranking up or down.'],
  ['Weigh your trade-offs', 'You decide how much speed, cost, community and local benefit matter.'],
  ['Stay alerted', 'Hear about moratoria, incentives and shifts in local sentiment as they happen.'],
];

const TIERS = [
  ['Official records', 100, 'State bills, county agendas and federal notices'],
  ['Established news', 80, 'Local and national outlets, through GDELT and news feeds'],
  ['Advocacy groups', 60, 'Newsletters from groups that track data center fights and subsidies'],
  ['Public posts', 40, 'Bluesky, Mastodon and Reddit, counted by region, never by person'],
];

export default function Landing() {
  const mode = useDataMode();
  const top = useAsync(() => rankSites({ n: 10, community: true }), []);
  const { alerts, connected, fresh } = useAlerts(6);
  const sites = top.data?.sites || [];

  return (
    <>
      <section className="hero">
        <Contours />
        <div className="wrap hero-inner">
          <div className="hero-copy">
            <h1>Find where the next data center belongs.</h1>
            <p className="lede">
              Groundwork ranks US sites on clean power, water, climate risk and community support, then tells you when local laws or sentiment change.
            </p>
            <div className="row">
              <Link to="/sites" className="btn btn-primary"><MapPinned aria-hidden="true" />Find a site</Link>
              <Link to="/pulse" className="btn btn-quiet"><Radar aria-hidden="true" />Check community pulse</Link>
            </div>
          </div>
          <figure className="hero-map" style={{ margin: 0 }}>
            <USMap
              ariaLabel="Top ten candidate sites"
              markers={sites.map((s, i) => ({
                id: s.site_id, lat: s.lat, lon: s.lon, r: 12, text: i + 1,
                fill: i < 3 ? 'var(--moss)' : 'var(--fern)',
                title: `${i + 1}. ${s.name}, score ${Math.round(s.final_score ?? s.score)}`,
              }))}
            />
            <figcaption className="hero-caption">
              <span>Top 10 sites right now, after community signals</span>
              {mode === 'sample' && <span>Sample data</span>}
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h2>Three tools, one decision</h2>
            <p>Site engineers and developers use them together: shortlist with the site finder, test priorities in trade-offs, and keep watching the community pulse.</p>
          </div>
          <div className="engines">
            <div className="engine">
              <span className="icon"><MapPinned aria-hidden="true" /></span>
              <h3>Site finder</h3>
              <p>Ranks every candidate site with the scoring model, then moves sites up or down based on what their communities are saying.</p>
              <Link to="/sites">Open the site finder</Link>
            </div>
            <div className="engine">
              <span className="icon"><SlidersHorizontal aria-hidden="true" /></span>
              <h3>Trade-offs</h3>
              <p>Set what matters for your project, including what a site gives back: waste heat for cold towns, and jobs where work is scarce.</p>
              <Link to="/tradeoffs">Explore trade-offs</Link>
            </div>
            <div className="engine">
              <span className="icon"><Radar aria-hidden="true" /></span>
              <h3>Community pulse</h3>
              <p>Search news, bills, council agendas and public posts about data centers, with plain-language summaries and live alerts.</p>
              <Link to="/pulse">Check the pulse</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h2>How a site gets its score</h2>
          </div>
          <ol className="steps">
            {STEPS.map(([title, text]) => (
              <li key={title}><b>{title}</b><p>{text}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" style={{ borderBottom: 'none' }}>
        <div className="wrap ground">
          <div className="panel">
            <div className="panel-title">
              <h3>Latest alerts</h3>
              <LiveDot on={connected} />
            </div>
            <AlertFeed alerts={alerts} fresh={fresh} />
          </div>
          <div className="stack" style={{ gap: 18 }}>
            <h2>Every signal is traceable</h2>
            <p className="muted">
              Each item links to its source. The AI must quote the sentence it relied on, and quotes not found in the source are flagged. Signals count by how trustworthy their source is.
            </p>
            <div className="tiers">
              {TIERS.map(([name, weight, desc]) => (
                <div className="tier" key={name}>
                  <b className="small">{name}</b>
                  <span className="bar" role="img" aria-label={`${name}: weight ${weight} of 100`}><i style={{ width: `${weight}%` }} /></span>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
