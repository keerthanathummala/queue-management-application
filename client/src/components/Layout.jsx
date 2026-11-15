import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, DEMO } from '../api.js';
import { useAuth } from '../auth.jsx';
import { TicketMark } from './Ticket.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const [queues, setQueues] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const refreshQueues = useCallback(async () => {
    try {
      const d = await api('/queues');
      setQueues(d.queues);
      return d.queues;
    } catch {
      setQueues((q) => q ?? []);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshQueues();
    const t = setInterval(refreshQueues, 10000);
    return () => clearInterval(t);
  }, [refreshQueues]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className={`rail ${menuOpen ? 'open' : ''}`}>
        <div className="rail-head">
          <NavLink to="/" className="brand">
            <TicketMark />
            <span>Queuedesk</span>
          </NavLink>
          <button className="rail-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        <nav className="rail-nav" aria-label="Main">
          <NavLink to="/" end>
            All queues
          </NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <div className="rail-section">Your queues</div>
          {queues === null && <div className="rail-muted">Loading…</div>}
          {queues?.length === 0 && <div className="rail-muted">No queues yet</div>}
          {queues?.map((q) => (
            <NavLink key={q.id} to={`/queues/${q.id}`} className="rail-queue">
              <span className="rail-queue-name">{q.name}</span>
              <span className="rail-count" aria-label={`${q.waitingCount} waiting`}>
                {q.waitingCount}
              </span>
            </NavLink>
          ))}
        </nav>
        {DEMO && (
          <div className="rail-demo">
            <p>Demo mode: data is saved in this browser only.</p>
            <button
              className="btn-link-light"
              onClick={async () => {
                if (!window.confirm('Reset the demo? All queues and accounts in this browser go back to the sample data.')) return;
                const { resetDemo } = await import('../demoApi.js');
                await resetDemo();
                logout({ explicit: true });
              }}
            >
              Reset demo data
            </button>
          </div>
        )}
        <div className="rail-foot">
          <div className="rail-user">
            <strong>{user?.name}</strong>
            <span>{user?.email}</span>
          </div>
          <button className="btn-ghost-light" onClick={() => logout({ explicit: true })}>
            Log out
          </button>
        </div>
      </aside>
      <main id="main" className="main">
        <Outlet context={{ queues, refreshQueues }} />
      </main>
    </div>
  );
}
