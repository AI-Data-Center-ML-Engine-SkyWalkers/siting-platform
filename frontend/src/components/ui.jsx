import { AlertTriangle, ArrowDown, ArrowUp, BadgeCheck, Ban, Building2, Gavel, Landmark, Megaphone, MessageCircle, Minus, Scale, Sprout, Users } from 'lucide-react';
import { useDataMode } from '../hooks/useData.js';
import { STANCE_LABELS, timeAgo } from '../lib/format.js';

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
    <span className={`mode-chip ${mode}`} title={mode === 'live' ? 'Connected to the Groundwork backend' : 'Backend not connected: showing sample data'}>
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
      <AlertTriangle aria-hidden="true" />
      <span>{children || 'You are looking at sample data, not real events. Start the backend to see live results.'}</span>
    </div>
  );
}

export function Slider({ id, label, value, onChange, min = 0, max = 100, step = 5, hint, format = (v) => v }) {
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p>{hint}</p>}
    </div>
  );
}

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
  if (!change) return <span className="delta same"><Minus aria-hidden="true" />same</span>;
  const up = change > 0;
  return (
    <span className={`delta ${up ? 'up' : 'down'}`} title={`${up ? 'Up' : 'Down'} ${Math.abs(change)} after community signals`}>
      {up ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
      {Math.abs(change)}
    </span>
  );
}

const KIND_ICONS = {
  moratorium: Ban, restriction: Scale, incentive: Sprout, bill: Landmark, policy_change: Gavel, hearing: Users,
  zoning: Building2, protest: Megaphone, lawsuit: Gavel, project_canceled: Ban, sentiment_shift: MessageCircle,
};
const GOOD_KINDS = new Set(['incentive']);

export function AlertFeed({ alerts, fresh = new Set(), empty = 'No alerts yet. They appear here as soon as something changes.' }) {
  if (!alerts.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="feed">
      {alerts.map((a) => {
        const Icon = KIND_ICONS[a.kind] || BadgeCheck;
        const tone = GOOD_KINDS.has(a.kind) ? 'good' : `sev${a.severity}`;
        return (
          <li key={a.id} className={fresh.has(a.id) ? 'fresh' : ''}>
            <span className={`kind ${tone}`} aria-hidden="true"><Icon /></span>
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
