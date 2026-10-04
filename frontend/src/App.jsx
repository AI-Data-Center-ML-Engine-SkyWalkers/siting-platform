import { Close, Location, Menu, Radar, Scales } from '@carbon/icons-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BrandMark, ModeChip } from './components/ui.jsx';
import { useDataMode } from './hooks/useData.js';
import Landing from './pages/Landing.jsx';
import Pulse from './pages/Pulse.jsx';
import Tradeoffs from './pages/Tradeoffs.jsx';

const Explorer = lazy(() => import('./pages/Explorer.jsx'));

const NAV = [
  { to: '/sites', label: 'Site finder', desc: 'Rank and explore candidate sites', icon: Location },
  { to: '/tradeoffs', label: 'Trade-offs', desc: 'Balance economic, social and ecological value', icon: Scales },
  { to: '/pulse', label: 'Community pulse', desc: 'News, bills and sentiment by place', icon: Radar },
];

const NAV_KEY = 'sitewelleco.sidenav';
let menuOpenMemory;
function initialNavOpen() {
  if (typeof menuOpenMemory === 'boolean') return menuOpenMemory;
  try { return localStorage.getItem(NAV_KEY) !== 'closed'; } catch { return true; }
}

function pageLabel(pathname) {
  if (pathname === '/') return '';
  if (pathname === '/sites') return 'Site finder';
  return NAV.find((n) => pathname.startsWith(n.to))?.label || '';
}

export default function App() {
  const { pathname } = useLocation();
  const immersive = pathname === '/sites';
  const [menuOpen, setMenuOpen] = useState(initialNavOpen);
  const burgerRef = useRef(null);
  useEffect(() => {
    menuOpenMemory = menuOpen;
    try { localStorage.setItem(NAV_KEY, menuOpen ? 'open' : 'closed'); } catch { /* storage can be unavailable */ }
  }, [menuOpen]);

  return (
    <div className={`app${menuOpen ? ' sidenav-open' : ''}`}>
      <header className="nav">
        <div className="nav-inner">
          <button
            ref={burgerRef}
            type="button"
            className="burger"
            aria-label={menuOpen ? 'Hide navigation' : 'Show navigation'}
            aria-expanded={menuOpen}
            aria-controls="nav-drawer"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <Link to="/" className="brand" aria-label="SitewellEco² home"><BrandMark /><span>SitewellEco²</span></Link>
          {pageLabel(pathname) ? <span className="crumb" aria-current="page">{pageLabel(pathname)}</span> : null}
          <span className="nav-spacer" />
          <ModeChip />
        </div>
      </header>
      <NavDrawer open={menuOpen} onClose={() => { setMenuOpen(false); burgerRef.current?.focus(); }} />
      <div className="shell">
      <main>
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<div className="page"><Landing /></div>} />
          <Route path="/about" element={<div className="page"><Landing /></div>} />
          <Route path="/sites" element={<Explorer />} />
          <Route path="/tradeoffs" element={<div className="page"><Tradeoffs /></div>} />
          <Route path="/pulse" element={<div className="page"><Pulse /></div>} />
          <Route path="*" element={<div className="page"><Landing /></div>} />
        </Routes>
        </Suspense>
      </main>
      {!immersive && (
        <footer className="wrap footer">
          <span>Every signal links to its public source. Bill data includes LegiScan (CC BY 4.0) and Open States.</span>
        </footer>
      )}
      </div>
    </div>
  );
}

function NavDrawer({ open, onClose }) {
  const mode = useDataMode();
  return (
    <aside id="nav-drawer" className={`sidenav${open ? ' open' : ''}`} aria-label="Side navigation" inert={open ? undefined : ''}>
      <div className="sidenav-head">
        <Link to="/" className="brand" aria-label="SitewellEco² home"><BrandMark /><span>SitewellEco²</span></Link>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Hide navigation" title="Hide navigation"><Close size={20} aria-hidden="true" /></button>
      </div>

      <p className="sidenav-label">Workspace</p>
      <nav aria-label="Main">
        <ul className="sidenav-list">
          {NAV.map(({ to, label, desc, icon: Icon }) => (
            <li key={to}>
              <NavLink to={to} className="sidenav-link">
                <Icon size={20} aria-hidden="true" />
                <span><b>{label}</b><small>{desc}</small></span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <p className="sidenav-label">Data</p>
      <div className="sidenav-status">
        <ModeChip />
        <span>{mode === 'live' ? 'Connected to the SitewellEco² backend: scores, news, bills and posts are live.' : 'The backend is not connected, so the app shows illustrative sample sites and signals.'}</span>
      </div>

      <div className="sidenav-keys">
        <p className="sidenav-label">Keyboard shortcuts</p>
        <dl className="shortcuts">
          <div><dt><kbd>[</kbd></dt><dd>Show or hide controls</dd></div>
          <div><dt><kbd>]</kbd></dt><dd>Show or hide insights</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Back to all sites</dd></div>
        </dl>
      </div>
    </aside>
  );
}
