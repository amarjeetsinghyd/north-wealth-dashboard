interface SummaryCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  accentColor?: string;
}

export function SummaryCard({ title, value, subtitle, icon, trend, accentColor = 'var(--gold)' }: SummaryCardProps) {
  const trendColor =
    trend === 'up' ? '#16a34a' :
    trend === 'down' ? '#ef4444' :
    'var(--text-muted)';

  const valueColor = trend ? trendColor : 'var(--text-primary)';

  return (
    <div
      className="glass-card glass-card-interactive"
      style={{
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top ambient accent glow */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
        opacity: 0.85,
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 11, color: 'var(--text-muted)',
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px',
        }}>
          {title}
        </span>
        <div style={{
          width: 34, height: 34, borderRadius: 10,
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(229, 231, 235, 0.8)',
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accentColor,
        }}>
          {icon}
        </div>
      </div>

      <div>
        <div style={{
          fontSize: 24, fontWeight: 700,
          color: valueColor,
          letterSpacing: '-0.4px', lineHeight: 1.1,
        }}>
          {value}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 12, color: trend ? trendColor : 'var(--text-secondary)',
            marginTop: 4, fontWeight: 600,
          }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
