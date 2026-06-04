import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleAlert as AlertCircle, TrendingUp } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import NorthWealthLogo from '../assets/North_Wealth_Light_Logo_Cropped.png';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password');
      setIsLoading(false);
      return;
    }
    const success = await login(username, password);
    if (success) { navigate('/'); }
    else { setError('Invalid username or password'); }
    setIsLoading(false);
  };

  const inputBase: React.CSSProperties = {
    width: '100%', padding: '13px 16px',
    borderRadius: 8,
    border: '1.5px solid rgba(255,255,255,0.12)',
    background: '#111111',
    color: '#ffffff',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.15s',
    fontFamily: 'inherit',
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: '#000000',
    }}>
      {/* Left panel — branding */}
      <div style={{
        flex: '1 1 55%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px 72px',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Subtle background pattern */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.03,
          backgroundImage: 'radial-gradient(circle at 30% 50%, #C9A84C 0%, transparent 60%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Logo */}
          <div style={{ marginBottom: 64 }}>
            <img src={NorthWealthLogo} alt="North Wealth" style={{ height: 64, width: 'auto', borderRadius: 0 }} />
          </div>

          {/* SEBI badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px',
            background: 'rgba(201,168,76,0.10)',
            border: '1px solid rgba(201,168,76,0.25)',
            borderRadius: 999,
            marginBottom: 32,
          }}>
            <TrendingUp size={13} style={{ color: '#C9A84C' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', letterSpacing: '1px', textTransform: 'uppercase' }}>
              SEBI Registered
            </span>
          </div>

          <h1 style={{
            fontSize: 52, fontWeight: 900, lineHeight: 1.08,
            letterSpacing: '-1.5px', marginBottom: 8, color: '#ffffff',
          }}>
            Wealth Creation.
          </h1>
          <h1 style={{
            fontSize: 52, fontWeight: 900, lineHeight: 1.08,
            letterSpacing: '-1.5px', marginBottom: 28, color: '#C9A84C',
          }}>
            Optimized.
          </h1>

          <p style={{ color: '#666666', fontSize: 16, lineHeight: 1.6, maxWidth: 420 }}>
            Institutional-grade investment strategies tailored to ambitious individuals.
          </p>

          {/* Feature bullets */}
          <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {[
              { icon: '📊', title: 'Real-Time Portfolio Analytics', desc: 'Live price feeds from NSE for accurate portfolio valuation' },
              { icon: '⚖️', title: 'Smart Rebalancing', desc: 'AI-assisted rebalancing aligned with Dynamic Alpha Strategy' },
              { icon: '🛡️', title: 'Risk Intelligence', desc: 'Sector-wise concentration & health scoring' },
            ].map(f => (
              <div key={f.title} style={{ display: 'flex', gap: 16 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'rgba(201,168,76,0.08)',
                  border: '1px solid rgba(201,168,76,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, flexShrink: 0,
                }}>{f.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, color: '#ffffff', fontSize: 14, marginBottom: 3 }}>{f.title}</div>
                  <div style={{ color: '#555555', fontSize: 13, lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div style={{
        flex: '1 1 45%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 48px',
        background: '#000000',
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          {/* Card */}
          <div style={{
            background: '#0f0f0f',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 16,
            padding: '36px 32px',
          }}>
            <h2 style={{
              fontSize: 22, fontWeight: 800, color: '#ffffff',
              marginBottom: 6, letterSpacing: '-0.3px',
            }}>Welcome back</h2>
            <p style={{ fontSize: 13, color: '#555555', marginBottom: 28 }}>
              Sign in to your portfolio manager
            </p>

            {error && (
              <div style={{
                display: 'flex', gap: 10, padding: '12px 14px',
                marginBottom: 20,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 8, alignItems: 'flex-start',
              }}>
                <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 13, color: '#ef4444', margin: 0 }}>{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#888888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter username"
                  disabled={isLoading}
                  style={{ ...inputBase, opacity: isLoading ? 0.6 : 1 }}
                  onFocus={e => (e.target as HTMLElement).style.borderColor = '#C9A84C'}
                  onBlur={e => (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)'}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#888888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  disabled={isLoading}
                  style={{ ...inputBase, opacity: isLoading ? 0.6 : 1 }}
                  onFocus={e => (e.target as HTMLElement).style.borderColor = '#C9A84C'}
                  onBlur={e => (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)'}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                style={{
                  marginTop: 8,
                  padding: '13px 20px',
                  borderRadius: 8,
                  background: isLoading ? '#333' : '#C9A84C',
                  color: '#000000',
                  fontSize: 14, fontWeight: 800,
                  border: 'none',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.18s',
                  letterSpacing: '0.3px',
                }}
                onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLElement).style.background = '#DFC06A'; }}
                onMouseLeave={e => { if (!isLoading) (e.currentTarget as HTMLElement).style.background = '#C9A84C'; }}
              >
                {isLoading ? 'Signing in...' : 'Sign In →'}
              </button>
            </form>
          </div>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#333333', marginTop: 20 }}>
            Demo credentials available upon request
          </p>
        </div>
      </div>
    </div>
  );
}
