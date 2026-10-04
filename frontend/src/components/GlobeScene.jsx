import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import { feature } from 'topojson-client';
import statesTopo from 'us-atlas/states-10m.json';
import countries from 'world-atlas/countries-110m.json';
import { STATES } from '../lib/format.js';

// Other countries are faint dots for context; the US is drawn as interactive states.
// North Korea's 110m outline makes the H3 polyfill throw; it is too small to matter at this resolution.
const WORLD = feature(countries, countries.objects.countries).features.filter((f) => f.id !== '408' && f.id !== '840');
const NAME_TO_ABBR = Object.fromEntries(Object.entries(STATES).map(([abbr, name]) => [name, abbr]));
const US_STATES = feature(statesTopo, statesTopo.objects.states).features
  .map((f) => ({ ...f, abbr: NAME_TO_ABBR[f.properties.name] }))
  .filter((f) => f.abbr);

export const HOME_VIEW = { lat: 40, lng: -98, altitude: 1.32 };
const START_VIEW = { lat: 14, lng: -32, altitude: 3.3 };
// Phones need the camera further out to fit the country
const homeView = () => (window.innerWidth < 700 ? { ...HOME_VIEW, lat: 42, altitude: 2.3 } : HOME_VIEW);
const GRID_RADIUS = 7; // scene units; the globe radius is 100
const IDLE_RETURN_MS = 7000;
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The scan sweeps west to east over Alaska and the contiguous US, then rests before the next pass
const SCAN_FROM = -172;
const SCAN_TO = -64;
const SWEEP_S = 6.5;
const PERIOD_S = 8.2;

// Score ramp from deep teal to bright lime, as hex for WebGL (matches --s1..--s5 in styles.css)
const RAMP = ['#0f4c5c', '#0f8b8d', '#2bb3a0', '#6cc644', '#a3e635'];
export function rampHex(score, lo, hi) {
  if (hi - lo < 1e-9) return RAMP[2];
  const t = Math.min(0.999, Math.max(0, (score - lo) / (hi - lo)));
  return RAMP[Math.floor(t * RAMP.length)];
}
const STATE_RAMP = ['#b9e3dd', '#8fd6cb', '#58c6b2', '#93d86c', '#c2ef6e'];
function stateHex(score, lo, hi) {
  if (hi - lo < 1e-9) return STATE_RAMP[2];
  const t = Math.min(0.999, Math.max(0, (score - lo) / (hi - lo)));
  return STATE_RAMP[Math.floor(t * STATE_RAMP.length)];
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const scoreOf = (s) => s.final_score ?? s.score;
const fmtLng = (lng) => `${Math.abs(lng).toFixed(1)}° ${lng < 0 ? 'W' : 'E'}`;

// ---------- Scanner: a shader shell over the US with a sweeping line, its trail, a survey graticule and frame brackets ----------
const MASK_GLSL = /* glsl */ `
  uniform vec4 uConus;   // lngMin, lngMax, latMin, latMax
  uniform vec4 uAlaska;
  float boxMask(vec4 b, float lng, float lat) {
    float x = smoothstep(b.x - 1.2, b.x + 0.8, lng) * (1.0 - smoothstep(b.y - 0.8, b.y + 1.2, lng));
    float y = smoothstep(b.z - 1.2, b.z + 0.8, lat) * (1.0 - smoothstep(b.w - 0.8, b.w + 1.2, lat));
    return x * y;
  }
  vec2 lngLat(vec3 p) {
    vec3 n = normalize(p);
    float lat = degrees(asin(clamp(n.y, -1.0, 1.0)));
    float lng = 90.0 - degrees(atan(n.z, n.x));
    if (lng > 180.0) lng -= 360.0;
    return vec2(lng, lat);
  }
`;

const SHELL_FRAG = /* glsl */ `
  uniform float uScan;
  uniform float uReveal;
  uniform float uDim;
  uniform vec3 uTeal;
  uniform vec3 uLime;
  uniform vec3 uInk;
  varying vec3 vPos;
  ${MASK_GLSL}
  void main() {
    vec2 ll = lngLat(vPos);
    float lng = ll.x, lat = ll.y;
    float mask = max(boxMask(uConus, lng, lat), boxMask(uAlaska, lng, lat));

    // Frame brackets at the corners of the contiguous US box
    float dl = min(lng - uConus.x, uConus.y - lng);
    float dt = min(lat - uConus.z, uConus.w - lat);
    float w = fwidth(lng) * 1.6;
    float inside = step(0.0, dl) * step(0.0, dt);
    float bracket = inside * max(
      (1.0 - smoothstep(0.0, w, dt)) * (1.0 - step(3.2, dl)),
      (1.0 - smoothstep(0.0, w, dl)) * (1.0 - step(3.2, dt)));

    if (mask < 0.002 && bracket < 0.01) discard;

    float d = uScan - lng;                        // > 0 behind the line
    float line = exp(-pow(d / 0.38, 2.0));
    float trail = d > 0.0 ? exp(-d / 11.0) : 0.0;

    vec2 g = abs(fract(vec2(lng, lat) / 2.5 + 0.5) - 0.5) * 2.5;
    vec2 gw = fwidth(vec2(lng, lat));
    float grid = max(1.0 - smoothstep(gw.x * 0.6, gw.x * 1.6, g.x), 1.0 - smoothstep(gw.y * 0.6, gw.y * 1.6, g.y));

    float a = mask * (0.03 + grid * (0.045 + 0.5 * trail) + 0.16 * trail + 0.9 * line);
    vec3 col = mix(uTeal, uLime, clamp(line * 1.2 + trail * 0.35, 0.0, 1.0));
    col = mix(col, uInk, bracket * 0.6);
    a = max(a, bracket * 0.75);
    gl_FragColor = vec4(col, a * uReveal * uDim);
  }
`;

const CURTAIN_VERT = /* glsl */ `
  attribute float aH;
  varying float vH;
  varying vec3 vWorld;
  void main() {
    vH = aH;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const CURTAIN_FRAG = /* glsl */ `
  uniform float uReveal;
  uniform float uDim;
  uniform float uOn;
  uniform vec3 uTeal;
  uniform vec3 uLime;
  varying float vH;
  varying vec3 vWorld;
  ${MASK_GLSL}
  void main() {
    vec2 ll = lngLat(vWorld);
    float mask = max(boxMask(uConus, ll.x, ll.y), boxMask(uAlaska, ll.x, ll.y));
    float a = mask * pow(1.0 - vH, 1.8) * 0.55 * uReveal * uDim * uOn;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uLime, uTeal, vH), a);
  }
`;

function buildScanner(R) {
  const uniforms = {
    uScan: { value: 999 },
    uReveal: { value: 0 },
    uDim: { value: 1 },
    uOn: { value: 1 },
    uConus: { value: new THREE.Vector4(-125, -66.5, 24.3, 49.6) },
    uAlaska: { value: new THREE.Vector4(-170, -140.5, 54.5, 71.6) },
    uTeal: { value: new THREE.Color('#0d9488') },
    uLime: { value: new THREE.Color('#84cc16') },
    uInk: { value: new THREE.Color('#0f4c5c') },
  };
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.011, 180, 120),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
    }),
  );
  shell.renderOrder = 2;

  // The light curtain: a meridian strip rising off the surface, rotated to the scan longitude every frame
  const segs = 90;
  const pos = [];
  const h = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const lat = 20 + (52 * i) / segs;
    const phi = ((90 - lat) * Math.PI) / 180;
    for (const [k, r] of [[0, R * 1.011], [1, R * 1.075]]) {
      // longitude 0: theta = 90 degrees, so x = 0
      pos.push(0, r * Math.cos(phi), r * Math.sin(phi));
      h.push(k);
    }
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
  geo.setIndex(idx);
  const curtain = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader: CURTAIN_VERT, fragmentShader: CURTAIN_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  curtain.renderOrder = 3;

  const group = new THREE.Group();
  group.add(shell, curtain);
  group.userData = { uniforms, curtain };
  return group;
}

// ---------- The holographic survey grid that unfolds around a selected site ----------
function buildHoloGrid() {
  const R = GRID_RADIUS;
  const group = new THREE.Group();
  const mat = (opacity) => new THREE.LineBasicMaterial({ color: 0x0d9488, transparent: true, opacity, depthWrite: false });
  const contours = [];
  for (let k = 1; k <= 6; k++) {
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const r = ((R * k) / 6.4) * (1 + 0.07 * Math.sin(3 * a + k * 1.7) + 0.04 * Math.sin(5 * a - k));
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat(0.55));
    contours.push(line);
    group.add(line);
  }
  const gridPts = [];
  const step = R / 5;
  for (let v = -R + step; v < R; v += step) {
    const half = Math.sqrt(Math.max(0, R * R - v * v));
    gridPts.push(new THREE.Vector3(-half, v, 0), new THREE.Vector3(half, v, 0));
    gridPts.push(new THREE.Vector3(v, -half, 0), new THREE.Vector3(v, half, 0));
  }
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPts), mat(0.16));
  group.add(grid);
  const bezelPts = [];
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    bezelPts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
  }
  const bezel = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bezelPts), mat(0.85));
  group.add(bezel);
  const tickPts = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const inner = i % 4 === 0 ? R * 0.9 : R * 0.95;
    tickPts.push(new THREE.Vector3(Math.cos(a) * inner, Math.sin(a) * inner, 0), new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), mat(0.7)));
  const sweep = new THREE.Mesh(
    new THREE.CircleGeometry(R, 48, 0, Math.PI / 4),
    new THREE.MeshBasicMaterial({ color: 0x14b8a6, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  );
  group.add(sweep);
  const scan = new THREE.Mesh(
    new THREE.RingGeometry(R * 0.97, R, 96),
    new THREE.MeshBasicMaterial({ color: 0x84cc16, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
  );
  group.add(scan);
  const cross = [
    new THREE.Vector3(-R * 0.12, 0, 0), new THREE.Vector3(-R * 0.03, 0, 0), new THREE.Vector3(R * 0.03, 0, 0), new THREE.Vector3(R * 0.12, 0, 0),
    new THREE.Vector3(0, -R * 0.12, 0), new THREE.Vector3(0, -R * 0.03, 0), new THREE.Vector3(0, R * 0.03, 0), new THREE.Vector3(0, R * 0.12, 0),
  ];
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cross), mat(1)));
  group.userData = { born: performance.now(), contours, grid, sweep, scan, bezel };
  group.scale.setScalar(0.001);
  return group;
}

function animateGrid(group, now) {
  const { born, contours, grid, sweep, scan, bezel } = group.userData;
  const t = (now - born) / 1000;
  const reveal = reduceMotion() ? 1 : 1 - Math.pow(1 - Math.min(1, Math.max(0, (t - 0.9) / 1.3)), 3); // starts as the camera arrives
  group.scale.setScalar(0.001 + reveal);
  sweep.rotation.z = -t * 1.4;
  sweep.material.opacity = 0.16 * reveal;
  const s = (t * 0.45) % 1;
  scan.scale.setScalar(0.05 + s * 0.95);
  scan.material.opacity = 0.7 * (1 - s) * reveal;
  grid.material.opacity = 0.16 * reveal;
  bezel.material.opacity = 0.85 * reveal;
  contours.forEach((c, i) => { c.material.opacity = (0.35 + 0.3 * Math.sin(t * 2.2 - i * 0.7)) * reveal; });
}

// ---------- Site markers: flat glowing dots that ping when the scan passes ----------
function makeMarker(site, handlers) {
  const el = document.createElement('div');
  el.className = 'site-mark';
  el.innerHTML = '<button type="button" class="mk"><span class="mk-ping"></span><span class="mk-core"></span><span class="mk-rank"></span></button><span class="mk-tip" role="tooltip"><b></b><small></small></span>';
  const btn = el.querySelector('.mk');
  // Keep pointer events away from the globe's own click handling, which would also hit the state underneath
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) btn.addEventListener(type, (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => { e.stopPropagation(); handlers.current.onSelect(el.dataset.id); });
  btn.addEventListener('pointerenter', () => handlers.current.onHover(el.dataset.id));
  btn.addEventListener('pointerleave', () => handlers.current.onHover(null));
  btn.addEventListener('focus', () => handlers.current.onHover(el.dataset.id));
  btn.addEventListener('blur', () => handlers.current.onHover(null));
  el.dataset.id = site.site_id;
  return el;
}

function viewFor(sites) {
  if (!sites.length) return HOME_VIEW;
  const lats = sites.map((s) => s.lat);
  const lngs = sites.map((s) => s.lon);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const spread = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lngs) - Math.min(...lngs)) * Math.cos((lat * Math.PI) / 180));
  return { lat, lng, altitude: Math.min(1.32, Math.max(0.42, 0.32 + spread / 38)) };
}

export default function GlobeScene({ sites, selectedId, hoveredId, onSelect, onHover, scan = true, areas = [], onStateClick, focusKey = '' }) {
  const globeRef = useRef(null);
  const wrapRef = useRef(null);
  const gridRef = useRef(null);
  const scannerRef = useRef(null);
  const flightRef = useRef(null);
  const idleRef = useRef(null);
  const homeRef = useRef(homeView());
  const readoutRef = useRef({});
  const markerCache = useRef(new Map());
  const handlers = useRef({ onSelect, onHover });
  handlers.current = { onSelect, onHover };
  const live = useRef({ scan, selectedId, revealAt: null, prevScan: SCAN_FROM - 10, flagged: 0, sweep: -1 });
  live.current.scan = scan;
  live.current.selectedId = selectedId;
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [ready, setReady] = useState(false);
  const [hoverState, setHoverState] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const material = useMemo(() => new THREE.MeshPhongMaterial({
    color: new THREE.Color('#eaf7f3'), emissive: new THREE.Color('#cdeee6'), emissiveIntensity: 0.45,
    specular: new THREE.Color('#bdf0e4'), shininess: 18, transparent: true, opacity: 0.98,
  }), []);

  const scores = sites.map(scoreOf);
  const lo = scores.length ? Math.min(...scores) : 0;
  const hi = scores.length ? Math.max(...scores) : 100;
  const selected = sites.find((s) => s.site_id === selectedId) || null;
  const markers = useMemo(() => sites.map((s, i) => ({ ...s, _rank: i + 1 })), [sites]);
  const markersRef = useRef(markers);
  markersRef.current = markers;

  const stateStats = useMemo(() => {
    const out = {};
    sites.forEach((s) => {
      const o = (out[s.state] = out[s.state] || { n: 0, best: -1, bestName: '' });
      o.n += 1;
      if (scoreOf(s) > o.best) { o.best = scoreOf(s); o.bestName = s.name; }
    });
    return out;
  }, [sites]);

  // ---------- Camera ----------
  const flyHome = useCallback((ms = 1600) => {
    globeRef.current?.pointOfView(homeRef.current, reduceMotion() ? 0 : ms);
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !ready) return;
    clearTimeout(flightRef.current);
    const quick = reduceMotion();
    if (selected) {
      globe.pointOfView({ lat: selected.lat, lng: selected.lon, altitude: Math.max(globe.pointOfView().altitude, 0.9) }, quick ? 0 : 900);
      flightRef.current = setTimeout(() => globe.pointOfView({ lat: selected.lat, lng: selected.lon, altitude: 0.42 }, quick ? 0 : 1500), quick ? 0 : 850);
    } else {
      flyHome();
    }
    return () => clearTimeout(flightRef.current);
  }, [selectedId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Choosing states focuses the camera on their sites
  useEffect(() => {
    if (!ready) return;
    homeRef.current = areas.length ? viewFor(sites) : homeView();
    if (!selectedId) flyHome(1500);
  }, [focusKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const onReady = () => {
    const globe = globeRef.current;
    const controls = globe.controls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 132;
    controls.maxDistance = 460;
    controls.autoRotate = false;
    // After the user drags away and lets go, drift back to the area being scanned
    controls.addEventListener('start', () => clearTimeout(idleRef.current));
    controls.addEventListener('end', () => {
      clearTimeout(idleRef.current);
      idleRef.current = setTimeout(() => { if (!live.current.selectedId) flyHome(2200); }, IDLE_RETURN_MS);
    });

    const scanner = buildScanner(globe.getGlobeRadius());
    globe.scene().add(scanner);
    scannerRef.current = scanner;

    // Intro: fly in from the Atlantic and switch the scanner on as the US comes into view
    const quick = reduceMotion();
    globe.pointOfView(quick ? homeRef.current : START_VIEW, 0);
    if (!quick) setTimeout(() => globe.pointOfView(homeRef.current, 2600), 120);
    live.current.revealAt = performance.now() + (quick ? 0 : 1700);
    setReady(true);
  };

  useEffect(() => () => {
    clearTimeout(idleRef.current);
    const s = scannerRef.current;
    if (s) {
      s.parent?.remove(s);
      s.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    }
  }, []);

  // ---------- Frame loop: scanner sweep, marker pings, survey grid, readout ----------
  useEffect(() => {
    let raf;
    const t0 = performance.now();
    const loop = (now) => {
      if (gridRef.current) animateGrid(gridRef.current, now);
      const scanner = scannerRef.current;
      const L = live.current;
      if (scanner) {
        const u = scanner.userData.uniforms;
        const quick = reduceMotion();
        const reveal = L.revealAt == null ? 0 : quick ? 1 : Math.min(1, Math.max(0, (now - L.revealAt) / 1200));
        u.uReveal.value = reveal;
        u.uDim.value += ((L.selectedId ? 0.22 : 1) - u.uDim.value) * 0.08;
        const sweeping = L.scan && !quick && reveal > 0;
        const elapsed = (now - t0) / 1000;
        const t = elapsed % PERIOD_S;
        const sweepNo = Math.floor(elapsed / PERIOD_S);
        if (sweepNo !== L.sweep) { L.sweep = sweepNo; L.flagged = 0; L.prevScan = SCAN_FROM - 10; }
        const lng = sweeping && t < SWEEP_S ? SCAN_FROM + (t / SWEEP_S) * (SCAN_TO - SCAN_FROM) : 999;
        u.uScan.value = lng;
        u.uOn.value = lng < 900 ? 1 : 0;
        scanner.userData.curtain.rotation.y = lng < 900 ? (lng * Math.PI) / 180 : 0;

        // Ping each marker as the line crosses it
        if (lng < 900) {
          for (const m of markersRef.current) {
            if (m.lon > L.prevScan && m.lon <= lng) {
              const el = markerCache.current.get(m.site_id);
              if (el) {
                el.classList.remove('ping');
                void el.offsetWidth; // restart the animation
                el.classList.add('ping');
              }
              L.flagged += 1;
            }
          }
          L.prevScan = lng;
        }

        const r = readoutRef.current;
        if (r.state) {
          const label = L.selectedId ? 'Local area scan' : !L.scan || quick ? 'Scan paused' : lng < 900 ? 'Scanning the US' : 'Scan complete';
          if (r.state.textContent !== label) r.state.textContent = label;
          const where = lng < 900 && !L.selectedId ? fmtLng(lng) : '';
          if (r.lng.textContent !== where) r.lng.textContent = where;
          const total = markersRef.current.length;
          const count = L.selectedId ? '' : lng < 900 ? `${Math.min(L.flagged, total)} of ${total} sites flagged` : `${total} sites in view`;
          if (r.count.textContent !== count) r.count.textContent = count;
          r.box.classList.toggle('active', lng < 900 && !L.selectedId);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------- Markers ----------
  const markerFor = useCallback((d) => {
    let el = markerCache.current.get(d.site_id);
    if (!el) {
      el = makeMarker(d, handlers);
      markerCache.current.set(d.site_id, el);
    }
    return el;
  }, []);

  useEffect(() => {
    markers.forEach((s, i) => {
      const el = markerFor(s);
      const sc = scoreOf(s);
      el.style.setProperty('--c', rampHex(sc, lo, hi));
      el.style.setProperty('--sz', `${Math.round(9 + ((sc - lo) / Math.max(1, hi - lo)) * 9)}px`);
      el.classList.toggle('top', i < 10);
      el.classList.toggle('sel', s.site_id === selectedId);
      el.classList.toggle('dim', Boolean(selectedId) && s.site_id !== selectedId);
      el.classList.toggle('hot', s.site_id === hoveredId);
      el.querySelector('.mk-rank').textContent = i < 10 ? String(i + 1) : '';
      el.querySelector('.mk-tip b').textContent = s.name;
      el.querySelector('.mk-tip small').textContent = `Rank ${i + 1}, score ${Math.round(sc)}`;
      el.querySelector('.mk').setAttribute('aria-label', `${s.name}: rank ${i + 1}, score ${Math.round(sc)}`);
    });
  }, [markers, selectedId, hoveredId, lo, hi, markerFor]);

  // ---------- States ----------
  const stateCap = (f) => {
    const st = stateStats[f.abbr];
    const hov = f === hoverState;
    if (areas.includes(f.abbr)) return `rgba(163, 230, 53, ${hov ? 0.8 : 0.62})`;
    if (st) return hexA(stateHex(st.best, lo, hi), hov ? 0.85 : 0.6);
    return `rgba(13, 148, 136, ${hov ? 0.2 : 0.07})`;
  };
  const stateLabel = (f) => {
    const st = stateStats[f.abbr];
    const body = st
      ? `${st.n} candidate site${st.n > 1 ? 's' : ''}<br/>Best: ${esc(st.bestName)}, score <span>${Math.round(st.best)}</span><br/><em>${areas.includes(f.abbr) ? 'Click to clear the focus' : 'Click to focus on this state'}</em>`
      : 'No candidate sites in view';
    return `<div class="globe-tip"><b>${esc(f.properties.name)}</b>${body}</div>`;
  };

  const rings = selected ? [{ lat: selected.lat, lng: selected.lon, main: true }] : [];

  return (
    <div ref={wrapRef} className="globe-stage" aria-label="Interactive globe scanning US candidate sites. Use the dashboards to choose a site with the keyboard.">
      <Globe
        ref={globeRef}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        globeMaterial={material}
        showAtmosphere
        atmosphereColor="#2dd4bf"
        atmosphereAltitude={0.16}
        animateIn={false}
        onGlobeReady={onReady}
        onGlobeClick={() => selectedId && onSelect(null)}
        hexPolygonsData={WORLD}
        hexPolygonResolution={3}
        hexPolygonMargin={0.6}
        hexPolygonUseDots
        hexPolygonAltitude={0.003}
        hexPolygonColor={() => (selectedId ? 'rgba(13, 148, 136, 0.1)' : 'rgba(13, 148, 136, 0.22)')}
        polygonsData={US_STATES}
        polygonAltitude={(f) => (selectedId ? 0.002 : f === hoverState ? 0.024 : 0.007)}
        polygonCapColor={stateCap}
        polygonSideColor={() => (selectedId ? 'rgba(13, 148, 136, 0.08)' : 'rgba(13, 148, 136, 0.28)')}
        polygonStrokeColor={(f) => (areas.includes(f.abbr) ? 'rgba(77, 124, 15, 0.9)' : 'rgba(15, 118, 110, 0.55)')}
        polygonCapCurvatureResolution={4}
        polygonLabel={stateLabel}
        polygonsTransitionDuration={260}
        onPolygonHover={(f) => setHoverState(f || null)}
        onPolygonClick={(f) => {
          if (selectedId) onSelect(null);
          else if (f?.abbr && (stateStats[f.abbr] || areas.includes(f.abbr))) onStateClick?.(f.abbr);
        }}
        htmlElementsData={markers}
        htmlLat="lat"
        htmlLng="lon"
        htmlAltitude={0.013}
        htmlElement={markerFor}
        htmlElementVisibilityModifier={(el, visible) => el.classList.toggle('behind', !visible)}
        htmlTransitionDuration={0}
        ringsData={rings}
        ringLat="lat"
        ringLng="lng"
        ringAltitude={0.014}
        ringColor={() => (t) => `rgba(101, 163, 13, ${(1 - t) * 0.95})`}
        ringMaxRadius={3.6}
        ringPropagationSpeed={2.2}
        ringRepeatPeriod={700}
        customLayerData={selected ? [{ ...selected, key: selected.site_id }] : []}
        customThreeObject={() => {
          const group = buildHoloGrid();
          gridRef.current = group;
          return group;
        }}
        customThreeObjectUpdate={(obj, d) => {
          const globe = globeRef.current;
          if (!globe) return;
          const p = globe.getCoords(d.lat, d.lon, 0.016);
          obj.position.set(p.x, p.y, p.z);
          obj.lookAt(0, 0, 0);
          if (obj.userData.siteId !== d.site_id) {
            obj.userData.siteId = d.site_id;
            obj.userData.born = performance.now();
            obj.scale.setScalar(0.001);
          }
          gridRef.current = obj;
        }}
      />
      <div className="scan-readout glass" aria-hidden="true" ref={(n) => { readoutRef.current.box = n; }}>
        <span className="scan-dot" />
        <b ref={(n) => { readoutRef.current.state = n; }}>Scanning the US</b>
        <span className="scan-lng" ref={(n) => { readoutRef.current.lng = n; }} />
        <span ref={(n) => { readoutRef.current.count = n; }} />
      </div>
    </div>
  );
}
