import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Users, BarChart2, LogOut } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import NorthWealthLogo from '../assets/North_Wealth_Light_Logo_Cropped.png';

interface LayoutProps { children: React.ReactNode; }

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => { logout(); navigate('/login'); };

  const isActive = (path: string) => location.pathname === path;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#000000' }}>
      {/* ── Navigation ─────────────────────────────────────────────── */}
      <header style={{
        background: '#000000',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        position: 'sticky', top: 0, zIndex: 100,
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
                color: '#ffffff', fontSize: 14, fontWeight: 500,
                cursor: 'pointer', borderRadius: 6,
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#C9A84C'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#ffffff'}
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
                border: '1.5px solid #C9A84C',
                borderRadius: 6,
                color: '#C9A84C',
                fontSize: 14, fontWeight: 700,
                textDecoration: 'none',
                transition: 'all 0.15s',
                letterSpacing: '0.2px',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = '#C9A84C';
                el.style.color = '#000000';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = 'transparent';
                el.style.color = '#C9A84C';
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
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '20px 32px',
        textAlign: 'center',
        color: '#444444',
        fontSize: 12,
        letterSpacing: '0.5px',
        background: '#000000',
      }}>
        NORTH<span style={{ color: '#C9A84C', fontWeight: 700 }}>WEALTH</span>
        &nbsp;&mdash;&nbsp;Portfolio Rebalancing Service&nbsp;&mdash;&nbsp;
        <span style={{ color: '#333' }}>SEBI Registered</span>
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
        color: active ? '#C9A84C' : '#a0a0a0',
        background: active ? 'rgba(201,168,76,0.08)' : 'transparent',
        textDecoration: 'none',
        transition: 'all 0.15s',
        letterSpacing: '0.1px',
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = '#ffffff';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = '#a0a0a0';
        }
      }}
    >
      {icon}{label}
    </Link>
  );
}
