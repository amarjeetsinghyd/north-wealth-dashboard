interface BadgeProps {
  value: number;
  showSign?: boolean;
  suffix?: string;
  size?: 'sm' | 'md';
}

export function PnLBadge({ value, showSign = true, suffix = '' }: BadgeProps) {
  const isPositive = value >= 0;
  const color = isPositive ? 'var(--color-success-500)' : 'var(--color-error-500)';
  const bg = isPositive ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 'var(--radius-full)',
      background: bg,
      color,
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      letterSpacing: '0.2px',
    }}>
      {showSign && value > 0 ? '+' : ''}
      {value.toFixed(2)}{suffix}
    </span>
  );
}
