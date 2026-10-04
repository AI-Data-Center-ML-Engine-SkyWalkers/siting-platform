import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import us from 'us-atlas/states-albers-10m.json';

// The us-atlas "albers" file is pre-projected with this exact projection, so points line up.
const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const path = geoPath();
const NATION = path(feature(us, us.objects.nation));
const BORDERS = path(mesh(us, us.objects.states, (a, b) => a !== b));

export const project = (lon, lat) => projection([lon, lat]);

/**
 * markers: [{ id, lat, lon, fill, r?, text?, title, label? }]
 * bubbles: [{ id, lat, lon, fill, stroke, r, title, label? }]
 */
export default function USMap({ markers = [], bubbles = [], selectedId, onSelect, ariaLabel = 'Map of the United States', className = '' }) {
  const placed = markers
    .map((m) => ({ ...m, xy: project(m.lon, m.lat) }))
    .filter((m) => m.xy)
    .sort((a, b) => (a.id === selectedId) - (b.id === selectedId) || (b.r || 9) - (a.r || 9));
  const placedBubbles = bubbles.map((b) => ({ ...b, xy: project(b.lon, b.lat) })).filter((b) => b.xy);
  const selected = placed.find((m) => m.id === selectedId);
  const activate = (id) => onSelect && onSelect(id);

  return (
    <div className={`map ${className}`}>
      <svg viewBox="0 0 975 610" role="group" aria-label={ariaLabel}>
        <path className="land" d={NATION} />
        <path className="borders" d={BORDERS} />
        {placedBubbles.map((b) => (
          <g key={b.id} role="button" tabIndex={0} aria-label={b.title} onClick={() => activate(b.id)} onKeyDown={(e) => e.key === 'Enter' && activate(b.id)}>
            <circle className="bubble" cx={b.xy[0]} cy={b.xy[1]} r={b.r} fill={b.fill} stroke={b.stroke || b.fill}>
              <title>{b.title}</title>
            </circle>
            {b.label && <text className="label" x={b.xy[0]} y={b.xy[1] + 4} textAnchor="middle">{b.label}</text>}
          </g>
        ))}
        {placed.map((m, i) => (
          <g
            key={m.id}
            className="marker"
            role="button"
            tabIndex={0}
            aria-label={m.title}
            style={{ animationDelay: `${0.9 + i * 0.06}s` }}
            onClick={() => activate(m.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), activate(m.id))}
          >
            <circle className="dot" cx={m.xy[0]} cy={m.xy[1]} r={m.r || 9} fill={m.fill} style={{ animationDelay: `${0.9 + i * 0.06}s`, transformOrigin: `${m.xy[0]}px ${m.xy[1]}px` }}>
              <title>{m.title}</title>
            </circle>
            {m.text != null && (
              <text x={m.xy[0]} y={m.xy[1] + 4.5} textAnchor="middle">{m.text}</text>
            )}
            {m.label && <text className="label" x={m.xy[0] + (m.r || 9) + 5} y={m.xy[1] + 4}>{m.label}</text>}
          </g>
        ))}
        {selected && <circle className="ring" cx={selected.xy[0]} cy={selected.xy[1]} r={(selected.r || 9) + 6} />}
      </svg>
    </div>
  );
}
