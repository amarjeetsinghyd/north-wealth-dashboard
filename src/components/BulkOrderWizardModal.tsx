import { useState, useMemo } from 'react';
import { X, ShieldAlert } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import type { Client } from '../types';

interface BulkOrderWizardModalProps {
  onClose: () => void;
  onSuccess: () => void;
  clients: Client[];
  initialMode: 'buy' | 'sell';
  initialSymbol?: string;
  initialSelectedClientIds?: string[];
  holdingsData?: any[]; // The holdings to sell from if selling
}

type Step = 'action' | 'clients' | 'price' | 'confirm';

export function BulkOrderWizardModal({ onClose, onSuccess, clients, initialMode, initialSymbol, initialSelectedClientIds, holdingsData }: BulkOrderWizardModalProps) {
  const [step, setStep] = useState<Step>(initialSymbol ? 'clients' : 'action');
  const [mode, setMode] = useState<'buy' | 'sell'>(initialMode);
  const [symbol, setSymbol] = useState(initialSymbol || '');
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set(initialSelectedClientIds || []));
  const [allocationPct, setAllocationPct] = useState<string>('10');
  const [priceMode, setPriceMode] = useState<'exact' | 'band'>('exact');
  const [exactPrice, setExactPrice] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const targetClients = useMemo(() => {
    if (mode === 'sell' && holdingsData) {
      return clients.filter(c => holdingsData.some(h => h.client_id === c.id));
    }
    return clients;
  }, [clients, mode, holdingsData]);

  const calculatedOrders = useMemo(() => {
    const orders: any[] = [];
    const p = priceMode === 'exact' ? parseFloat(exactPrice) : (parseFloat(minPrice) + parseFloat(maxPrice)) / 2;
    if (!p || p <= 0) return orders;

    targetClients.forEach(c => {
      if (!selectedClients.has(c.id)) return;
      if (mode === 'buy') {
        const cash = Math.max(0, ((c as any).totalCapital || 0) - ((c as any).invested || 0));
        const alloc = parseFloat(allocationPct) || 0;
        const budget = cash * (alloc / 100);
        const qty = Math.floor(budget / p);
        if (qty > 0) {
          orders.push({ client: c, qty, price: p, budget, mode: 'buy' });
        }
      } else {
        const h = holdingsData?.find(x => x.client_id === c.id);
        if (h && h.quantity > 0) {
          orders.push({ client: c, qty: h.quantity, price: p, mode: 'sell', holdingId: h.id });
        }
      }
    });
    return orders;
  }, [targetClients, selectedClients, mode, allocationPct, priceMode, exactPrice, minPrice, maxPrice, holdingsData]);

  const handleExecute = async () => {
    setIsProcessing(true);
    setError('');
    try {
      if (calculatedOrders.length === 0) throw new Error("No valid orders calculated.");
      const batchDate = new Date().toISOString();
      const p = priceMode === 'exact' ? parseFloat(exactPrice) : (parseFloat(minPrice) + parseFloat(maxPrice)) / 2;

      for (const order of calculatedOrders) {
        if (mode === 'buy') {
          await addDoc(collection(db, 'holdings'), {
            client_id: order.client.id,
            client_name: order.client.name,
            rm_name: order.client.rm_name || '',
            stock_symbol: symbol.toUpperCase(),
            nse_symbol: symbol.toUpperCase(),
            company_name: symbol.toUpperCase(),
            quantity: order.qty,
            buy_price: p,
            current_price: p,
            invested_amount: order.qty * p,
            current_value: order.qty * p,
            created_at: batchDate,
            updated_at: batchDate
          });
          
          await addDoc(collection(db, 'transactions'), {
            client_id: order.client.id,
            client_name: order.client.name,
            symbol: symbol.toUpperCase(),
            type: 'BUY',
            quantity: order.qty,
            price: p,
            total_value: order.qty * p,
            date: batchDate,
            notes: 'Bulk Buy (Wizard)'
          });
        } else {
          // Sell logic
          const val = order.qty * p;
          await updateDoc(doc(db, 'holdings', order.holdingId), {
            quantity: 0,
            current_value: 0,
            updated_at: batchDate
          });
          
          await addDoc(collection(db, 'transactions'), {
            client_id: order.client.id,
            client_name: order.client.name,
            symbol: symbol.toUpperCase(),
            type: 'SELL',
            quantity: order.qty,
            price: p,
            total_value: val,
            date: batchDate,
            notes: 'Bulk Sell (Wizard)'
          });
        }
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Execution failed');
      setIsProcessing(false);
    }
  };

  const toggleClient = (id: string) => {
    const next = new Set(selectedClients);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedClients(next);
  };

  const toggleAll = () => {
    if (selectedClients.size === targetClients.length) setSelectedClients(new Set());
    else setSelectedClients(new Set(targetClients.map(c => c.id)));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="animate-scale-up" style={{ background: 'var(--bg-elevated)', borderRadius: 16, width: '100%', maxWidth: 700, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
        
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(201,168,76,0.03)' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
            Bulk {mode === 'buy' ? 'Buy' : 'Sell'} Wizard
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#777', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
        </div>

        {/* Content */}
        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          {error && (
            <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: 8, marginBottom: 20, fontSize: 13, display: 'flex', gap: 8 }}>
              <ShieldAlert size={16} /> {error}
            </div>
          )}

          {step === 'action' && (
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 16 }}>1. Select Stock & Action</h3>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <button onClick={() => setMode('buy')} style={{ flex: 1, padding: 16, borderRadius: 8, border: mode === 'buy' ? '2px solid #C9A84C' : '1px solid var(--border-subtle)', background: mode === 'buy' ? 'rgba(201,168,76,0.1)' : 'transparent', fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer' }}>Buy</button>
                <button onClick={() => setMode('sell')} style={{ flex: 1, padding: 16, borderRadius: 8, border: mode === 'sell' ? '2px solid #ef4444' : '1px solid var(--border-subtle)', background: mode === 'sell' ? 'rgba(239,68,68,0.1)' : 'transparent', fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer' }}>Sell</button>
              </div>
              <input type="text" placeholder="Enter Stock Symbol (e.g. RELIANCE)" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
              <button disabled={!symbol} onClick={() => setStep('clients')} style={{ width: '100%', marginTop: 20, padding: 14, background: '#C9A84C', color: '#000', borderRadius: 8, border: 'none', fontWeight: 800, cursor: symbol ? 'pointer' : 'not-allowed', opacity: symbol ? 1 : 0.5 }}>Next Step →</button>
            </div>
          )}

          {step === 'clients' && (
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 16 }}>2. Select Clients {mode === 'buy' ? '& Allocation' : ''}</h3>
              {mode === 'buy' && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Allocation % of Free Cash (applies to all selected)</label>
                  <input type="number" value={allocationPct} onChange={e => setAllocationPct(e.target.value)} style={{ width: 100, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} /> %
                </div>
              )}
              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}><input type="checkbox" checked={selectedClients.size > 0 && selectedClients.size === targetClients.length} onChange={toggleAll} /></th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)' }}>Client Name</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--text-muted)' }}>{mode === 'buy' ? 'Free Cash' : 'Holding Qty'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetClients.map(c => {
                      const h = holdingsData?.find(x => x.client_id === c.id);
                      const freeCash = Math.max(0, ((c as any).totalCapital || 0) - ((c as any).invested || 0));
                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                          <td style={{ padding: '8px 12px' }}><input type="checkbox" checked={selectedClients.has(c.id)} onChange={() => toggleClient(c.id)} /></td>
                          <td style={{ padding: '8px 12px', fontWeight: 700 }}>{c.name}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                            {mode === 'buy' ? `₹${freeCash.toLocaleString('en-IN')}` : h?.quantity || 0}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button disabled={selectedClients.size === 0} onClick={() => setStep('price')} style={{ width: '100%', marginTop: 20, padding: 14, background: '#C9A84C', color: '#000', borderRadius: 8, border: 'none', fontWeight: 800, cursor: selectedClients.size > 0 ? 'pointer' : 'not-allowed', opacity: selectedClients.size > 0 ? 1 : 0.5 }}>Next Step →</button>
            </div>
          )}

          {step === 'price' && (
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 16 }}>3. Pricing Strategy</h3>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <button onClick={() => setPriceMode('exact')} style={{ flex: 1, padding: 12, borderRadius: 8, border: priceMode === 'exact' ? '2px solid #C9A84C' : '1px solid var(--border-subtle)', background: priceMode === 'exact' ? 'rgba(201,168,76,0.1)' : 'transparent', fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer' }}>Exact Price</button>
                <button onClick={() => setPriceMode('band')} style={{ flex: 1, padding: 12, borderRadius: 8, border: priceMode === 'band' ? '2px solid #C9A84C' : '1px solid var(--border-subtle)', background: priceMode === 'band' ? 'rgba(201,168,76,0.1)' : 'transparent', fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer' }}>Price Band (Min-Max)</button>
              </div>

              {priceMode === 'exact' ? (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Execution Price (₹)</label>
                  <input type="number" value={exactPrice} onChange={e => setExactPrice(e.target.value)} placeholder="e.g. 150.50" style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Min Price (₹)</label>
                    <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="e.g. 145.00" style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Max Price (₹)</label>
                    <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="e.g. 155.00" style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
                  </div>
                </div>
              )}

              <button disabled={priceMode === 'exact' ? !exactPrice : (!minPrice || !maxPrice)} onClick={() => setStep('confirm')} style={{ width: '100%', padding: 14, background: '#C9A84C', color: '#000', borderRadius: 8, border: 'none', fontWeight: 800, cursor: 'pointer' }}>Review Execution →</button>
            </div>
          )}

          {step === 'confirm' && (
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 16 }}>4. Confirm Execution</h3>
              <div style={{ background: 'rgba(0,0,0,0.03)', padding: 16, borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Action</span>
                  <strong style={{ color: mode === 'buy' ? '#22c55e' : '#ef4444' }}>BULK {mode.toUpperCase()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Stock Symbol</span>
                  <strong>{symbol.toUpperCase()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Target Clients</span>
                  <strong>{calculatedOrders.length}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Est. Execution Price</span>
                  <strong>₹{priceMode === 'exact' ? parseFloat(exactPrice).toFixed(2) : ((parseFloat(minPrice) + parseFloat(maxPrice))/2).toFixed(2)}</strong>
                </div>
              </div>

              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, maxHeight: 200, overflowY: 'auto', marginBottom: 20 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)' }}>Client</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--text-muted)' }}>Exec Qty</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--text-muted)' }}>Est Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculatedOrders.map((o, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 700 }}>{o.client.name}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{o.qty.toLocaleString('en-IN')}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>₹{(o.qty * o.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button disabled={isProcessing || calculatedOrders.length === 0} onClick={handleExecute} style={{ width: '100%', padding: 14, background: mode === 'buy' ? '#22c55e' : '#ef4444', color: '#fff', borderRadius: 8, border: 'none', fontWeight: 800, cursor: isProcessing ? 'wait' : 'pointer' }}>
                {isProcessing ? 'Executing...' : `Execute ${mode.toUpperCase()} for ${calculatedOrders.length} clients`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
