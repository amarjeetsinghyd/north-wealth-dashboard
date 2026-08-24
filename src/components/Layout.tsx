import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Users, BarChart2, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../lib/useAuth';
import NorthWealthLogo from '../assets/North_Wealth_Logo_Transparent.png';
import { refreshAllPrices, getCachedPriceDate } from '../lib/globalRefresh';

interface LayoutProps { children: React.ReactNode; }

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('');
  const [priceDate, setPriceDate] = useState(getCachedPriceDate);

  // Keep priceDate in sync if another tab updates localStorage
  useEffect(() => {
    const onStorage = () => setPriceDate(getCachedPriceDate());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleRefreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshStatus('Starting…');
    try {
      const result = await refreshAllPrices(msg => setRefreshStatus(msg));
      setPriceDate(result.priceDate);
      setRefreshStatus(`✓ ${result.updated} holdings updated`);
      setTimeout(() => setRefreshStatus(''), 4000);
    } catch (err) {
      console.error('[GlobalRefresh] Failed:', err);
      setRefreshStatus('Refresh failed');
      setTimeout(() => setRefreshStatus(''), 4000);
    } finally {
      setRefreshing(false);
      // Dispatch a custom event so open ClientPortfolioPage tabs can reload their holdings
      window.dispatchEvent(new CustomEvent('nw:prices-refreshed'));
    }
  };

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

            {/* ── Global Refresh All Prices ── */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <button
                onClick={handleRefreshAll}
                disabled={refreshing}
                className="btn-glass-gold"
                title="Refresh prices for ALL clients in one click"
                style={{
                  padding: '7px 14px',
                  fontSize: 12, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 6,
                  opacity: refreshing ? 0.75 : 1,
                  cursor: refreshing ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <RefreshCw
                  size={13}
                  style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}
                />
                {refreshing ? 'Refreshing All…' : 'Refresh All Prices'}
              </button>

              {/* Status / date badge */}
              {(refreshStatus || priceDate) && (
                <span style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  letterSpacing: '0.3px', lineHeight: 1,
                  maxWidth: 180, textAlign: 'right',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {refreshStatus || (priceDate ? `Prices as of ${priceDate}` : '')}
                </span>
              )}
            </div>

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
        color: active ? '#8c6314' : 'var(--text-secondary)',
        background: active ? 'linear-gradient(135deg, rgba(201, 168, 76, 0.20), rgba(160, 124, 45, 0.12))' : 'transparent',
        border: active ? '1px solid rgba(201, 168, 76, 0.45)' : '1px solid transparent',
        boxShadow: active ? 'inset 0 1px 1px rgba(255, 255, 255, 0.85), 0 2px 8px rgba(201, 168, 76, 0.12)' : 'none',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
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
