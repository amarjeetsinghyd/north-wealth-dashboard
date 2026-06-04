interface SummaryCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  accentColor?: string;
}

export function SummaryCard({ title, value, subtitle, icon, trend, accentColor = '#C9A84C' }: SummaryCardProps) {
  const trendColor =
    trend === 'up' ? '#22c55e' :
    trend === 'down' ? '#ef4444' :
    '#a0a0a0';

  const valueColor = trend ? trendColor : '#ffffff';

  return (
    <div
      style={{
        background: '#111111',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        transition: 'border-color 0.2s ease, transform 0.2s ease',
        cursor: 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'rgba(201,168,76,0.35)';
        el.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'rgba(255,255,255,0.08)';
        el.style.transform = 'translateY(0)';
      }}
    >
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
        opacity: 0.6,
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 11, color: '#666666',
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px',
        }}>
          {title}
        </span>
        <div style={{
          width: 34, height: 34, borderRadius: 8,
          background: `${accentColor}18`,
          border: `1px solid ${accentColor}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accentColor,
        }}>
          {icon}
        </div>
      </div>

      <div>
        <div style={{
          fontSize: 26, fontWeight: 800,
          color: valueColor,
          letterSpacing: '-0.5px', lineHeight: 1.1,
        }}>
          {value}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 13, color: trend ? trendColor : '#666666',
            marginTop: 5, fontWeight: 600,
          }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
