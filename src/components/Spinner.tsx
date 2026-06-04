export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="animate-spin"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid var(--border-default)',
        borderTopColor: 'var(--color-primary-500)',
      }}
    />
  );
}
