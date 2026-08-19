import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Users, BarChart2, LogOut } from 'lucide-react';
import { useAuth } from '../lib/useAuth';
import NorthWealthLogo from '../assets/North_Wealth_Logo_Transparent.png';

interface LayoutProps { children: React.ReactNode; }

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => { logout(); navigate('/login'); };

  const isActive = (path: string) => location.pathname === path;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* ── Navigation ─────────────────────────────────────────────── */}
      <header style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{
          maxWidth: 1400, margin: '0 auto',
          padding: '0 32px', height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          {/* Logo */}
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <img
              src={NorthWealthLogo}
              alt="North Wealth"
              style={{ height: 48, width: 'auto', borderRadius: 0 }}
            />
          </Link>

          {/* Nav links (center) */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NavLink
              to="/" label="Clients" icon={<Users size={14} />}
              active={isActive('/')}
            />
            <NavLink
              to="/analytics" label="Analytics" icon={<BarChart2 size={14} />}
              active={isActive('/analytics')}
            />
          </nav>

          {/* Actions (right) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handleLogout}
              style={{
                padding: '8px 18px',
                background: 'transparent', border: 'none',
                color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500,
                cursor: 'pointer', borderRadius: 6,
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--gold-dark)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <LogOut size={14} /> Logout
              </span>
            </button>

            {/* Dashboard outline-gold button */}
            <Link
              to="/"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 20px',
                background: 'transparent',
                border: '1.5px solid var(--border-strong)',
                borderRadius: 6,
                color: 'var(--text-secondary)',
                fontSize: 14, fontWeight: 700,
                textDecoration: 'none',
                transition: 'all 0.15s',
                letterSpacing: '0.2px',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'var(--gold)';
                el.style.color = 'var(--gold-dark)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'var(--border-strong)';
                el.style.color = 'var(--text-secondary)';
              }}
            >
              Clients
            </Link>
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────── */}
      <main style={{
        flex: 1,
        maxWidth: 1400, margin: '0 auto',
        width: '100%',
        padding: '40px 32px',
      }}>
        {children}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--border-default)',
        padding: '20px 32px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: 12,
        letterSpacing: '0.5px',
        background: 'var(--bg-surface)',
      }}>
        NORTH<span style={{ color: 'var(--gold)', fontWeight: 700 }}>WEALTH</span>
        &nbsp;&mdash;&nbsp;Portfolio Rebalancing Service&nbsp;&mdash;&nbsp;
        <span style={{ color: 'var(--text-secondary)' }}>SEBI Registered</span>
      </footer>
    </div>
  );
}

function NavLink({
  to, label, icon, active,
}: { to: string; label: string; icon: React.ReactNode; active: boolean }) {
  return (
    <Link
      to={to}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 16px',
        borderRadius: 6,
        fontSize: 14, fontWeight: 500,
        color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
        background: active ? 'var(--gold-subtle)' : 'transparent',
        textDecoration: 'none',
        transition: 'all 0.15s',
        letterSpacing: '0.1px',
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
        }
      }}
    >
      {icon}{label}
    </Link>
  );
}
