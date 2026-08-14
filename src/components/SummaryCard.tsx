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
    trend === 'up' ? 'var(--color-success-500)' :
    trend === 'down' ? 'var(--color-error-500)' :
    'var(--text-muted)';

  const valueColor = trend ? trendColor : 'var(--text-primary)';

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease',
        cursor: 'default',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'var(--gold)';
        el.style.transform = 'translateY(-2px)';
        el.style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'var(--border-default)';
        el.style.transform = 'translateY(0)';
        el.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
        opacity: 0.8,
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 11, color: 'var(--text-muted)',
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px',
        }}>
          {title}
        </span>
        <div style={{
          width: 34, height: 34, borderRadius: 8,
          background: 'var(--gold-subtle)',
          border: '1px solid var(--border-gold)',
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
            fontSize: 13, color: trend ? trendColor : 'var(--text-secondary)',
            marginTop: 5, fontWeight: 600,
          }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
