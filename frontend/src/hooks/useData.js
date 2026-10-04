import { useEffect, useRef, useState } from 'react';
import { alertStreamUrl, dataMode, getAlerts } from '../api/client.js';
import { SAMPLE_LIVE_ALERTS } from '../api/sample/awareness.js';

export function useDataMode() {
  const [mode, setMode] = useState(null);
  useEffect(() => { dataMode().then(setMode); }, []);
  return mode;
}

/** Runs an async loader whenever deps change; keeps the last good data while reloading. */
export function useAsync(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    loader()
      .then((data) => id === seq.current && setState({ data, error: null, loading: false }))
      .catch((error) => id === seq.current && setState((s) => ({ ...s, error, loading: false })));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/** Recent alerts plus live ones as they arrive (server-sent events, or a simulation in sample mode). */
export function useAlerts(limit = 20) {
  const [alerts, setAlerts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [fresh, setFresh] = useState(new Set());

  useEffect(() => {
    let source = null;
    const timers = [];
    let cancelled = false;
    const push = (a) => {
      setAlerts((prev) => [a, ...prev.filter((p) => p.id !== a.id)].slice(0, limit));
      setFresh((prev) => new Set(prev).add(a.id));
      timers.push(setTimeout(() => setFresh((prev) => { const n = new Set(prev); n.delete(a.id); return n; }), 6000));
    };
    (async () => {
      const mode = await dataMode();
      const initial = await getAlerts(limit).catch(() => ({ alerts: [] }));
      if (cancelled) return;
      setAlerts(initial.alerts);
      if (mode === 'live') {
        source = new EventSource(alertStreamUrl());
        source.addEventListener('ready', () => setConnected(true));
        source.addEventListener('alert', (e) => push(JSON.parse(e.data)));
        source.onerror = () => setConnected(false);
      } else {
        setConnected(true);
        SAMPLE_LIVE_ALERTS.forEach((a, i) => {
          timers.push(setTimeout(() => push({ ...a, id: 1000 + i, created_at: new Date().toISOString() }), 20000 * (i + 1)));
        });
      }
    })();
    return () => {
      cancelled = true;
      source?.close();
      timers.forEach(clearTimeout);
    };
  }, [limit]);

  return { alerts, connected, fresh };
}
