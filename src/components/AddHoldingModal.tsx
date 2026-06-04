import { useState } from 'react';
import { X, CircleCheck as CheckCircle } from 'lucide-react';
import { upsertHoldings, insertTransaction } from '../lib/queries';

interface AddHoldingModalProps {
  clientId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddHoldingModal({ clientId, onClose, onSuccess }: AddHoldingModalProps) {
  const [symbol, setSymbol] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!symbol.trim() || !buyPrice || !quantity) return;
    setSaving(true);
    setError('');

    const qty = parseFloat(quantity);
    const price = parseFloat(buyPrice);

    try {
      await upsertHoldings([{
        client_id: clientId,
        stock_symbol: symbol.trim().toUpperCase(),
        nse_symbol: null,
        company_name: companyName.trim(),
        buy_price: price,
        quantity: qty,
        invested_amount: qty * price,
        current_price: 0,
        current_value: 0,
        unrealised_pnl: 0,
        unrealised_pnl_pct: 0,
        realised_pnl: 0,
        rebalancing_date: null,
        last_price_update: null,
      }]);

      await insertTransaction({
        client_id: clientId,
        date,
        action,
        stock_symbol: symbol.trim().toUpperCase(),
        company_name: companyName.trim(),
        quantity: qty,
        price,
        total_value: qty * price,
      });

      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add holding');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-default)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-base)',
    outline: 'none',
    transition: 'border-color 0.15s',
  };

  const labelStyle = {
    display: 'block' as const,
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: 6,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'var(--space-4)',
    }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="animate-fade-in" style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        width: '100%', maxWidth: 500,
        boxShadow: 'var(--shadow-xl)',
      }}>
        <div style={{
          padding: 'var(--space-5) var(--space-6)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Add Holding</h2>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div style={{ padding: 'var(--space-10)', textAlign: 'center' }}>
            <CheckCircle size={44} style={{ color: 'var(--color-success-500)', margin: '0 auto var(--space-4)', display: 'block' }} />
            <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Holding added successfully</p>
          </div>
        ) : (
          <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div>
                <label style={labelStyle}>Stock Symbol *</label>
                <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="e.g. RELIANCE" style={inputStyle}
                  onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'}
                  onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'}
                />
              </div>
              <div>
                <label style={labelStyle}>Action</label>
                <select value={action} onChange={e => setAction(e.target.value as 'BUY' | 'SELL')} style={inputStyle}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Company Name</label>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Reliance Industries" style={inputStyle}
                onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'}
                onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div>
                <label style={labelStyle}>Buy Price (₹) *</label>
                <input type="number" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} placeholder="0.00" style={inputStyle}
                  onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'}
                  onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'}
                />
              </div>
              <div>
                <label style={labelStyle}>Quantity *</label>
                <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" style={inputStyle}
                  onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'}
                  onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'}
                />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Transaction Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle}
                onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'}
                onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'}
              />
            </div>

            {buyPrice && quantity && (
              <div style={{
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3) var(--space-4)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-primary-400)',
              }}>
                Invested Amount: ₹{(parseFloat(buyPrice || '0') * parseFloat(quantity || '0')).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            )}

            {error && <p style={{ color: 'var(--color-error-400)', fontSize: 'var(--text-sm)' }}>{error}</p>}
          </div>
        )}

        {!done && (
          <div style={{
            padding: 'var(--space-4) var(--space-6)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end',
          }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', fontWeight: 500, border: '1px solid var(--border-default)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !symbol.trim() || !buyPrice || !quantity}
              style={{
                padding: '9px 24px',
                borderRadius: 'var(--radius-md)',
                background: symbol.trim() && buyPrice && quantity ? 'var(--color-primary-600)' : 'var(--color-neutral-700)',
                color: 'white',
                fontSize: 'var(--text-sm)', fontWeight: 600,
                border: 'none',
                cursor: saving || !symbol.trim() || !buyPrice || !quantity ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Add Holding'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
