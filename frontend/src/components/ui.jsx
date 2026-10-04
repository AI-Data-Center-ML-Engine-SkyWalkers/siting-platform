import { Analytics, ArrowDown, ArrowUp, Bullhorn, DocumentTasks, Error as Prohibited, Group, Locked, MapBoundary, Money, Notification, Policy, Scales, Subtract, WarningAlt } from '@carbon/icons-react';
import { useDataMode } from '../hooks/useData.js';
import { STANCE_LABELS, timeAgo } from '../lib/format.js';

export function ImasonsMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="10" width="6" height="18" fill="#bdbdbd" />
      <rect x="13" y="10" width="6" height="18" fill="currentColor" />
      <rect x="22" y="10" width="6" height="18" fill="#bdbdbd" />
      <rect x="14" y="4" width="4" height="4" fill="currentColor" />
    </svg>
  );
}

export function BrandMark() {
  // Concentric contour rings around a summit: the "groundwork" survey mark
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M16 3.5c7.2 0 12.5 5.2 12.5 12.1 0 7.4-5.6 12.9-12.8 12.9C8.6 28.5 3.5 23 3.5 16.2 3.5 9 9 3.5 16 3.5Z" />
      <path d="M16.3 8.4c4.6 0 7.7 3.3 7.7 7.6 0 4.7-3.4 8-8 8-4.4 0-7.6-3.3-7.6-7.7 0-4.5 3.3-7.9 7.9-7.9Z" />
      <path d="M16.2 13c1.9 0 3.2 1.4 3.2 3.2 0 1.9-1.4 3.2-3.3 3.2-1.8 0-3.1-1.3-3.1-3.1 0-1.9 1.3-3.3 3.2-3.3Z" fill="currentColor" />
    </svg>
  );
}

export function ModeChip() {
  const mode = useDataMode();
  if (!mode) return null;
  return (
    <span className={`mode-chip ${mode}`} title={mode === 'live' ? 'Connected to the SitewellEco² backend' : 'Backend not connected: showing sample data'}>
      <i aria-hidden="true" />
      {mode === 'live' ? 'Live data' : 'Sample data'}
    </span>
  );
}

export function SampleBanner({ children }) {
  const mode = useDataMode();
  if (mode !== 'sample') return null;
  return (
    <div className="sample-banner" role="note">
      <WarningAlt size={16} aria-hidden="true" />
      <span>{children || 'You are looking at sample data, not real events. Start the backend to see live results.'}</span>
    </div>
  );
}

export { default as Slider } from './PremiumSlider.jsx';

export function Switch({ id, label, checked, onChange }) {
  return (
    <label className="switch" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function StanceTag({ stance }) {
  return <span className={`tag ${stance}`}>{STANCE_LABELS[stance] || stance}</span>;
}

export function RankDelta({ change }) {
  if (!change) return <span className="delta same"><Subtract size={16} aria-hidden="true" />same</span>;
  const up = change > 0;
  return (
    <span className={`delta ${up ? 'up' : 'down'}`} title={`${up ? 'Up' : 'Down'} ${Math.abs(change)} after community signals`}>
      {up ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
      {Math.abs(change)}
    </span>
  );
}

const KIND_ICONS = {
  moratorium: Prohibited, restriction: Locked, incentive: Money, bill: Policy, policy_change: DocumentTasks, hearing: Group,
  zoning: MapBoundary, protest: Bullhorn, lawsuit: Scales, project_canceled: Prohibited, sentiment_shift: Analytics,
};
const GOOD_KINDS = new Set(['incentive']);

export function AlertFeed({ alerts, fresh = new Set(), empty = 'No alerts yet. They appear here as soon as something changes.' }) {
  if (!alerts.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="feed">
      {alerts.map((a) => {
        const Icon = KIND_ICONS[a.kind] || Notification;
        const tone = GOOD_KINDS.has(a.kind) ? 'good' : `sev${a.severity}`;
        return (
          <li key={a.id} className={fresh.has(a.id) ? 'fresh' : ''}>
            <span className={`kind ${tone}`} aria-hidden="true"><Icon size={16} /></span>
            <div>
              <b>{a.title}</b>
              <p>{a.body}</p>
              <time dateTime={a.created_at}>{timeAgo(a.created_at)}</time>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function LiveDot({ on }) {
  return <span className={`live-dot ${on ? 'on' : ''}`}><i aria-hidden="true" />{on ? 'Live' : 'Connecting'}</span>;
}
