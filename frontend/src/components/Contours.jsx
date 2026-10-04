import { contours } from 'd3-contour';
import { geoIdentity, geoPath } from 'd3-geo';
import { useMemo } from 'react';

// A topographic field for the hero: hills and valleys drawn as contour lines, like a survey sheet.
const W = 144;
const H = 72;
const CELL = 10;

function elevation(x, y) {
  const hills = [
    [0.22, 0.35, 0.16, 1.0], [0.62, 0.62, 0.2, 0.9], [0.86, 0.28, 0.12, 0.7], [0.4, 0.8, 0.14, 0.6], [0.1, 0.75, 0.1, 0.5],
  ];
  let z = 0;
  for (const [cx, cy, s, a] of hills) {
    const dx = x / W - cx;
    const dy = y / H - cy;
    z += a * Math.exp(-(dx * dx + dy * dy * 0.6) / (2 * s * s));
  }
  z += 0.08 * Math.sin(x / 7.3 + Math.cos(y / 9.1)) + 0.06 * Math.cos(y / 5.7 - x / 13);
  return z;
}

export default function Contours({ className = '' }) {
  const paths = useMemo(() => {
    const values = new Float64Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values[y * W + x] = elevation(x, y);
    const gen = contours().size([W, H]).thresholds(16);
    const toPath = geoPath(geoIdentity().scale(CELL));
    return gen(values).map((c) => toPath(c));
  }, []);
  return (
    <svg className={`hero-contours ${className}`} viewBox={`0 0 ${W * CELL} ${H * CELL}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} className="draw" style={{ animationDelay: `${i * 0.05}s` }} />
      ))}
    </svg>
  );
}
