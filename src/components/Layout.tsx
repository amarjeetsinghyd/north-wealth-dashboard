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
        background: 'rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(229, 231, 235, 0.65)',
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)',
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
              style={{ height: 46, width: 'auto', borderRadius: 0, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.05))' }}
            />
          </Link>

          {/* Nav links (center) */}
          <nav style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(243, 244, 246, 0.7)',
            padding: '4px 6px',
            borderRadius: 12,
            border: '1px solid rgba(229, 231, 235, 0.8)',
            backdropFilter: 'blur(8px)',
          }}>
            <NavLink
              to="/" label="Clients" icon={<Users size={15} />}
              active={isActive('/')}
            />
            <NavLink
              to="/analytics" label="Analytics" icon={<BarChart2 size={15} />}
              active={isActive('/analytics')}
            />
          </nav>

          {/* Actions (right) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handleLogout}
              className="btn-glass-light"
              style={{
                padding: '7px 16px',
                fontSize: 13, fontWeight: 500,
                color: 'var(--text-secondary)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <LogOut size={14} /> Logout
              </span>
            </button>
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
        padding: '6px 16px',
        borderRadius: 8,
        fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? '#ffffff' : 'var(--text-secondary)',
        background: active ? 'linear-gradient(135deg, rgba(201,168,76,0.95), rgba(160,124,45,0.95))' : 'transparent',
        boxShadow: active ? '0 2px 8px rgba(201,168,76,0.35), inset 0 1px 0 rgba(255,255,255,0.4)' : 'none',
        textDecoration: 'none',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        letterSpacing: '0.1px',
      }}
      onMouseEnter={e => {
        if (!active) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = 'rgba(255, 255, 255, 0.9)';
          el.style.color = 'var(--text-primary)';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = 'transparent';
          el.style.color = 'var(--text-secondary)';
        }
      }}
    >
      {icon}{label}
    </Link>
  );
}
