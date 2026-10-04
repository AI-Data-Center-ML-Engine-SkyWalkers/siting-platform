import { Search } from '@carbon/icons-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef, useState } from 'react';
import { HOME_VIEW, rampHex } from './GlobeScene.jsx';

// Satellite imagery with streets and labels, on a 3D globe that zooms down to street level.
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
export const MAP_STYLES = [
  { id: 'satellite-streets', label: 'Satellite streets', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'satellite', label: 'Satellite', url: 'mapbox://styles/mapbox/satellite-v9' },
  { id: 'standard-satellite', label: 'Satellite 3D (Standard)', url: 'mapbox://styles/mapbox/standard-satellite' },
  { id: 'terrain', label: 'Terrain', url: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'night', label: 'Night streets', url: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', url: 'mapbox://styles/mapbox/light-v11' },
];
const DEFAULT_STYLE = import.meta.env.VITE_MAPBOX_STYLE || MAP_STYLES[0].url;
const TONE_COLORS = ['match', ['get', 'tone'], 'against', '#f43f5e', 'for', '#14b8a6', 'watch', '#f59e0b', '#94a3b8'];
const HOME = { center: [HOME_VIEW.lng, HOME_VIEW.lat], zoom: 2.7, pitch: 0, bearing: 0 };
const GRID_KM = 3.2;
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Keep the area of interest clear of whichever dashboards are open
function padding(insets = { left: true, right: true }) {
  if (window.innerWidth < 980) return { left: 20, right: 20, top: 120, bottom: window.innerHeight * 0.45 };
  return { left: insets.left ? 350 : 20, right: insets.right ? 412 : 20, top: 80, bottom: 60 };
}

// ---------- Holographic survey grid, in real kilometres around the site ----------
function offset(lat0, lng0, dxKm, dyKm) {
  return [lng0 + dxKm / (111.32 * Math.cos((lat0 * Math.PI) / 180)), lat0 + dyKm / 110.574];
}

function holoGeoJSON(site, t, reveal) {
  const { lat, lon } = site;
  const R = Math.max(0.01, GRID_KM * reveal);
  const features = [];
  const line = (coords, kind, o) => features.push({ type: 'Feature', properties: { kind, o }, geometry: { type: 'LineString', coordinates: coords } });
  const circle = (r, wobble = 0, k = 0, n = 120) => Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + wobble * (0.07 * Math.sin(3 * a + k * 1.7) + 0.04 * Math.sin(5 * a - k)));
    return offset(lat, lon, Math.cos(a) * rr, Math.sin(a) * rr);
  });
  for (let k = 1; k <= 6; k++) {
    line(circle((R * k) / 6.4, 1, k), 'contour', (0.35 + 0.3 * Math.sin(t * 2.2 - k * 0.7)) * reveal);
  }
  const step = R / 5;
  for (let v = -R + step; v < R - 1e-9; v += step) {
    const half = Math.sqrt(Math.max(0, R * R - v * v));
    line([offset(lat, lon, -half, v), offset(lat, lon, half, v)], 'grid', 0.22 * reveal);
    line([offset(lat, lon, v, -half), offset(lat, lon, v, half)], 'grid', 0.22 * reveal);
  }
  line(circle(R), 'bezel', 0.9 * reveal);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const inner = i % 4 === 0 ? R * 0.9 : R * 0.95;
    line([offset(lat, lon, Math.cos(a) * inner, Math.sin(a) * inner), offset(lat, lon, Math.cos(a) * R, Math.sin(a) * R)], 'tick', 0.7 * reveal);
  }
  const s = (t * 0.45) % 1;
  line(circle(R * (0.05 + 0.95 * s)), 'scan', 0.8 * (1 - s) * reveal);
  const c = R * 0.12;
  line([offset(lat, lon, -c, 0), offset(lat, lon, c, 0)], 'cross', reveal);
  line([offset(lat, lon, 0, -c), offset(lat, lon, 0, c)], 'cross', reveal);
  const a0 = -t * 1.4;
  const sector = [offset(lat, lon, 0, 0)];
  for (let i = 0; i <= 24; i++) {
    const a = a0 + (i / 24) * (Math.PI / 4);
    sector.push(offset(lat, lon, Math.cos(a) * R, Math.sin(a) * R));
  }
  sector.push(offset(lat, lon, 0, 0));
  features.push({ type: 'Feature', properties: { kind: 'sweep', o: 0.2 * reveal }, geometry: { type: 'Polygon', coordinates: [sector] } });
  return { type: 'FeatureCollection', features };
}

const EMPTY = { type: 'FeatureCollection', features: [] };

function applyVisibility(map, layers) {
  const set = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  ['sites-halo', 'sites-dot', 'sites-rank'].forEach((id) => set(id, layers.sites));
  set('sites-heat', layers.heatmap);
  set('events-dot', layers.events);
}

// Several events can share a county centroid; fan them out slightly so each can be clicked
function jitter(fc) {
  const seen = {};
  return {
    ...fc,
    features: (fc.features || []).map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
      const n = (seen[key] = (seen[key] || 0) + 1) - 1;
      if (!n) return f;
      const a = n * 2.4;
      const r = 0.05 * Math.sqrt(n);
      return { ...f, geometry: { type: 'Point', coordinates: [lon + r * Math.cos(a), lat + r * Math.sin(a)] } };
    }),
  };
}

function sitesGeoJSON(sites, selectedId, hoveredId) {
  const scores = sites.map((s) => s.final_score ?? s.score);
  const lo = scores.length ? Math.min(...scores) : 0;
  const hi = scores.length ? Math.max(...scores) : 100;
  return {
    type: 'FeatureCollection',
    features: sites.map((s, i) => ({
      type: 'Feature',
      id: i,
      properties: {
        id: s.site_id, name: s.name, rank: i + 1, top: i < 10, score: Math.round(s.final_score ?? s.score),
        color: rampHex(s.final_score ?? s.score, lo, hi), sel: s.site_id === selectedId, hov: s.site_id === hoveredId,
      },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  };
}

export default function MapboxStage({
  sites, selectedId, hoveredId, onSelect, onHover, spin = true,
  styleId = 'satellite-streets', layers = { sites: true, heatmap: false, events: true }, events = null, focusKey = '',
  insets = { left: true, right: true },
}) {
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const loadedRef = useRef(false);
  const everLoaded = useRef(false);
  const handlers = useRef({ onSelect, onHover });
  const state = useRef({ selectedId, spin, interacting: false, revealStart: null });
  const data = useRef({ sites: EMPTY, events: EMPTY, layers });
  handlers.current = { onSelect, onHover };
  state.current.selectedId = selectedId;
  state.current.spin = spin;
  state.current.sites = sites;
  data.current.layers = layers;
  const [error, setError] = useState(null);

  // Create the map once
  useEffect(() => {
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: (MAP_STYLES.find((m) => m.id === styleId) || {}).url || DEFAULT_STYLE,
      projection: 'globe',
      ...HOME,
      attributionControl: false,
      antialias: true,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'site-popup', offset: 14 });

    map.on('error', (e) => { if (!everLoaded.current) setError(e?.error?.message || 'The map could not load.'); });
    map.on('style.load', () => {
      map.setFog({
        // A bright sky around the globe to match the light interface
        color: 'rgb(255, 255, 255)', 'high-color': 'rgb(167, 232, 220)', 'horizon-blend': 0.06,
        'space-color': 'rgb(236, 248, 245)', 'star-intensity': 0,
      });
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
      }
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.4 });
      for (const id of ['sites', 'holo', 'events']) {
        if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: id === 'holo' ? EMPTY : data.current[id] });
      }
      const add = (layer) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
      add({ id: 'sites-heat', type: 'heatmap', source: 'sites', maxzoom: 9,
        paint: {
          'heatmap-weight': ['/', ['get', 'score'], 100],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 28, 8, 70],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 1, 8, 2],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, '#0f4c5c', 0.4, '#0f8b8d', 0.6, '#2bb3a0', 0.8, '#6cc644', 1, '#a3e635'],
          'heatmap-opacity': 0.7,
        } });
      add({ id: 'holo-sweep', type: 'fill', source: 'holo', filter: ['==', ['get', 'kind'], 'sweep'],
        paint: { 'fill-color': '#2dd4bf', 'fill-opacity': ['get', 'o'], 'fill-emissive-strength': 1 } });
      add({ id: 'holo-glow', type: 'line', source: 'holo', filter: ['in', ['get', 'kind'], ['literal', ['bezel', 'contour', 'scan']]],
        paint: { 'line-color': '#2dd4bf', 'line-width': 7, 'line-blur': 6, 'line-opacity': ['*', ['get', 'o'], 0.45], 'line-emissive-strength': 1 } });
      add({ id: 'holo-lines', type: 'line', source: 'holo', filter: ['!=', ['get', 'kind'], 'sweep'],
        paint: {
          'line-color': ['match', ['get', 'kind'], 'scan', '#bef264', 'cross', '#ffffff', '#5eead4'],
          'line-width': ['match', ['get', 'kind'], 'bezel', 2.4, 'scan', 2, 'cross', 2, 'grid', 0.8, 1.3],
          'line-opacity': ['get', 'o'], 'line-emissive-strength': 1,
        } });
      add({ id: 'events-dot', type: 'circle', source: 'events',
        paint: {
          'circle-color': TONE_COLORS,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, ['+', 3, ['get', 'severity']], 12, ['+', 6, ['*', 2, ['get', 'severity']]]],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.92, 'circle-emissive-strength': 1,
          'circle-translate': [0, 0],
        } });
      add({ id: 'sites-halo', type: 'circle', source: 'sites',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, ['case', ['any', ['get', 'sel'], ['get', 'hov']], 16, 10], 12, ['case', ['get', 'sel'], 34, 22]],
          'circle-blur': 1, 'circle-opacity': 0.55, 'circle-emissive-strength': 1,
        } });
      add({ id: 'sites-dot', type: 'circle', source: 'sites',
        paint: {
          'circle-color': ['case', ['get', 'sel'], '#ffffff', ['get', 'color']],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, ['case', ['get', 'sel'], 7, ['get', 'hov'], 7, 5], 12, ['case', ['get', 'sel'], 12, 9]],
          'circle-stroke-color': ['case', ['get', 'sel'], '#0d9488', '#ffffff'], 'circle-stroke-width': ['case', ['get', 'sel'], 3, 1.5], 'circle-emissive-strength': 1,
        } });
      add({ id: 'sites-rank', type: 'symbol', source: 'sites', filter: ['all', ['get', 'top'], ['!', ['get', 'sel']]],
        layout: {
          'text-field': ['to-string', ['get', 'rank']], 'text-size': 12, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-offset': [0, -1.7], 'text-allow-overlap': true, 'text-ignore-placement': true,
        },
        paint: { 'text-color': '#06302f', 'text-halo-color': '#bef264', 'text-halo-width': 5, 'text-emissive-strength': 1 } });
      applyVisibility(map, data.current.layers);
      loadedRef.current = true;
      everLoaded.current = true;
      setError(null);
      map.fire('sitewell:ready');
    });

    const flyToSite = (id) => {
      const site = (state.current.sites || []).find((s) => s.site_id === id);
      if (!site) return;
      const timing = reduceMotion() ? { duration: 0 } : {};
      map.flyTo({
        center: [site.lon, site.lat], zoom: 13, pitch: 62, bearing: -24,
        padding: padding(insetsRef.current), speed: 0.85, curve: 1.5, essential: true, ...timing,
      });
    };
    const pickSite = (e) => {
      const f = e.features?.[0];
      if (!f) return;
      e.originalEvent?.stopPropagation?.();
      const id = f.properties.id;
      if (state.current.selectedId === id) flyToSite(id);
      handlers.current.onSelect(id);
    };
    const tipOn = (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      handlers.current.onHover(p.id);
      popup.setLngLat(e.features[0].geometry.coordinates)
        .setHTML(`<div class="globe-tip"><b>${esc(p.name)}</b>Rank ${p.rank}, score <span>${p.score}</span></div>`)
        .addTo(map);
    };
    const tipOff = () => { map.getCanvas().style.cursor = ''; handlers.current.onHover(null); popup.remove(); };
    for (const layer of ['sites-dot', 'sites-halo', 'sites-rank']) {
      map.on('click', layer, pickSite);
      map.on('mouseenter', layer, tipOn);
      map.on('mouseleave', layer, tipOff);
    }
    map.on('click', (e) => {
      if (e.defaultPrevented) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: ['sites-dot', 'sites-halo', 'sites-rank'].filter((id) => map.getLayer(id)) });
      if (hits[0]) handlers.current.onSelect(hits[0].properties.id);
    });
    const eventPopup = new mapboxgl.Popup({ closeButton: true, className: 'site-popup', offset: 10, maxWidth: '300px' });
    map.on('mouseenter', 'events-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'events-dot', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'events-dot', (e) => {
      const p = e.features[0].properties;
      const link = p.url && p.url !== '#' ? `<a href="${esc(p.url)}" target="_blank" rel="noreferrer">Open source</a>` : '<em>Sample item</em>';
      eventPopup.setLngLat(e.features[0].geometry.coordinates)
        .setHTML(`<div class="globe-tip event-tip"><b>${esc(p.title)}</b><p>${esc(p.summary)}</p><small>${esc(p.region || '')}, ${esc(p.outlet || '')}</small>${link}</div>`)
        .addTo(map);
    });

    // Idle spin while zoomed out
    const spinGlobe = () => {
      const s = state.current;
      if (!s.spin || s.selectedId || s.interacting || reduceMotion() || map.getZoom() > 4.5) return;
      const center = map.getCenter();
      center.lng -= 2;
      map.easeTo({ center, duration: 1000, easing: (n) => n });
    };
    const stopSpin = () => { state.current.interacting = true; };
    const resumeSpin = () => { state.current.interacting = false; spinGlobe(); };
    map.on('mousedown', stopSpin);
    map.on('touchstart', stopSpin);
    map.on('mouseup', resumeSpin);
    map.on('touchend', resumeSpin);
    map.on('moveend', spinGlobe);
    map.once('idle', spinGlobe);

    // Animate the survey grid around the selected site
    let raf;
    const animate = (now) => {
      const s = state.current;
      const site = s.site;
      if (loadedRef.current && site && s.revealStart != null) {
        const t = (now - s.revealStart) / 1000;
        const reveal = reduceMotion() ? 1 : 1 - Math.pow(1 - Math.min(1, t / 1.3), 3);
        map.getSource('holo')?.setData(holoGeoJSON(site, t, reveal));
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    // Follow the container, which also changes size when the side navigation opens or closes
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      popup.remove();
      map.remove();
    };
  }, []);

  const whenReady = (fn) => {
    const map = mapRef.current;
    if (loadedRef.current) fn(map);
    else map.once('sitewell:ready', () => fn(map));
  };

  // Keep site markers in sync with the ranking, hover and selection
  useEffect(() => {
    data.current.sites = sitesGeoJSON(sites, selectedId, hoveredId);
    whenReady((map) => map.getSource('sites')?.setData(data.current.sites));
  }, [sites, selectedId, hoveredId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    data.current.events = jitter(events || EMPTY);
    whenReady((map) => map.getSource('events')?.setData(data.current.events));
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { whenReady((map) => applyVisibility(map, layers)); }, [layers.sites, layers.heatmap, layers.events]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening or closing a dashboard slides the focus point so it stays in the clear
  const firstInsets = useRef(true);
  useEffect(() => {
    if (firstInsets.current) { firstInsets.current = false; return; }
    whenReady((map) => { if (map.getZoom() > 4.5) map.easeTo({ padding: padding(insets), duration: reduceMotion() ? 0 : 500 }); });
  }, [insets.left, insets.right]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map style switch: the style.load handler re-adds our layers and data
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) { firstStyle.current = false; return; }
    const style = MAP_STYLES.find((m) => m.id === styleId);
    if (!style) return;
    loadedRef.current = false;
    mapRef.current.setStyle(style.url, { diff: false }); // full reload so style.load re-adds our layers
  }, [styleId]);

  // Choosing areas zooms the map to the sites in them
  useEffect(() => {
    if (!focusKey || selectedId || !sites.length) return;
    whenReady((map) => {
      const lons = sites.map((s) => s.lon);
      const lats = sites.map((s) => s.lat);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: padding(insetsRef.current), maxZoom: 8, pitch: 30, duration: reduceMotion() ? 0 : 2200, essential: true });
    });
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Camera flight into the local area, then the survey grid unfolds
  const hadSelection = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    const site = sites.find((s) => s.site_id === selectedId);
    if (!site && !hadSelection.current) return; // first mount: the map already starts at HOME
    hadSelection.current = Boolean(site);
    const fly = () => {
      // Mapbox reads any 'duration' key, even undefined, so only pass it for reduced motion
      const timing = reduceMotion() ? { duration: 0 } : {};
      if (site) {
        state.current.site = site;
        state.current.revealStart = null;
        map.getSource('holo')?.setData(EMPTY);
        map.flyTo({ center: [site.lon, site.lat], zoom: 12.4, pitch: 62, bearing: -24, padding: padding(insetsRef.current), speed: 0.8, curve: 1.6, essential: true, ...timing });
        map.once('moveend', () => { if (state.current.site === site) state.current.revealStart = performance.now(); });
      } else {
        state.current.site = null;
        state.current.revealStart = null;
        map.getSource('holo')?.setData(EMPTY);
        map.flyTo({ ...HOME, padding: { left: 0, right: 0, top: 0, bottom: 0 }, speed: 1.1, curve: 1.5, essential: true, ...timing });
      }
    };
    if (loadedRef.current) fly();
    else map.once('sitewell:ready', fly);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="globe-stage">
      <div ref={containerRef} className="mapbox-stage" />
      <MapSearch mapRef={mapRef} insetsRef={insetsRef} />
      {error && <div className="map-error glass">The satellite map could not load: {error} Check VITE_MAPBOX_TOKEN.</div>}
    </div>
  );
}

function MapSearch({ mapRef, insetsRef }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('');
  const abort = useRef(null);
  const pin = useRef(null);
  useEffect(() => () => pin.current?.remove(), []);

  const find = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setStatus('Searching');
    const center = mapRef.current?.getCenter();
    const params = new URLSearchParams({ q: q.trim(), access_token: TOKEN, limit: '5', country: 'us' });
    if (center) params.set('proximity', `${center.lng},${center.lat}`);
    try {
      const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`, { signal: abort.current.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.features || []);
      setStatus(data.features?.length ? '' : 'No places match. Try a city, county or street.');
    } catch (err) {
      if (err.name !== 'AbortError') setStatus(`Search failed: ${err.message}`);
    }
  };

  const go = (f) => {
    const map = mapRef.current;
    const bbox = f.properties.bbox;
    if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: padding(insetsRef.current), pitch: 50, duration: 3200, essential: true });
    else map.flyTo({ center: f.geometry.coordinates, zoom: 15, pitch: 55, padding: padding(insetsRef.current), speed: 0.9, curve: 1.6, essential: true });
    // Drop a pin on the place that was found
    if (!pin.current) {
      const el = document.createElement('div');
      el.className = 'search-pin';
      pin.current = new mapboxgl.Marker({ element: el });
    }
    pin.current.setLngLat(f.geometry.coordinates).addTo(map);
    setResults([]);
    setStatus('');
    setQ(f.properties.full_address || f.properties.name);
  };

  return (
    <div className="map-search">
      <form className="map-search-bar glass" role="search" onSubmit={find}>
        <Search size={16} aria-hidden="true" />
        <label htmlFor="map-q" className="sr-only">Search for a street or area</label>
        <input id="map-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for street or area..." autoComplete="off" />
        <button type="submit" className="btn btn-primary btn-small">Find</button>
      </form>
      {(results.length > 0 || status) && (
        <ul className="map-results glass" aria-label="Places found" aria-live="polite">
          {status && <li className="small muted" style={{ padding: '8px 12px' }}>{status}</li>}
          {results.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => go(f)}>
                <b>{f.properties.name}</b>
                <span>{f.properties.place_formatted || f.properties.full_address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
