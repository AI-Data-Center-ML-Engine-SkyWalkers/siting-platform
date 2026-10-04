import { NavLink, Route, Routes, Link } from 'react-router-dom';
import { BrandMark, ModeChip } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import SiteFinder from './pages/SiteFinder.jsx';
import Tradeoffs from './pages/Tradeoffs.jsx';
import Pulse from './pages/Pulse.jsx';

export default function App() {
  return (
    <>
      <header className="nav">
        <div className="wrap nav-inner">
          <Link to="/" className="brand"><BrandMark />Groundwork</Link>
          <nav className="nav-links" aria-label="Main">
            <NavLink to="/sites">Site finder</NavLink>
            <NavLink to="/tradeoffs">Trade-offs</NavLink>
            <NavLink to="/pulse">Community pulse</NavLink>
          </nav>
          <span className="nav-spacer" />
          <ModeChip />
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/sites" element={<SiteFinder />} />
          <Route path="/tradeoffs" element={<Tradeoffs />} />
          <Route path="/pulse" element={<Pulse />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </main>
      <footer className="wrap footer">
        <span>Groundwork, built for the iMasons Datacenter track.</span>
        <span>Every signal links to its public source. Bill data includes LegiScan (CC BY 4.0) and Open States.</span>
      </footer>
    </>
  );
}
