import { useState, useMemo } from 'react';
import { X, ShieldAlert, TrendingUp, TrendingDown } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, addDoc, updateDoc, doc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import type { Client, Holding } from '../types';
import { getStockMeta } from '../lib/sectorMap';

interface BulkOrderWizardModalProps {
  onClose: () => void;
  onSuccess: () => void;
  clients: (Client & { totalCapital?: number; value?: number; invested?: number; mutual_funds?: number })[];
  initialMode: 'buy' | 'sell';
  initialSymbol?: string;
  initialSelectedClientIds?: string[];
  holdingsData?: Holding[]; // The holdings to sell from if selling or existing holdings
}

type Step = 'action' | 'clients' | 'price' | 'confirm';

function getClientFreeCash(c: Client & { totalCapital?: number; value?: number; invested?: number; mutual_funds?: number }) {
  if (c.asset_free_cash !== undefined && c.asset_free_cash !== null) {
    return c.asset_free_cash;
  }
  const cap = c.total_capital || c.totalCapital || 0;
  const currVal = c.value || c.invested || 0;
  const mf = c.mutual_funds || c.asset_mutual_funds || 0;
  return Math.max(0, cap - currVal - mf);
}

export function BulkOrderWizardModal({
  onClose,
  onSuccess,
  clients,
  initialMode,
  initialSymbol,
  initialSelectedClientIds,
  holdingsData,
}: BulkOrderWizardModalProps) {
  const [step, setStep] = useState<Step>(initialSymbol ? 'clients' : 'action');
  const [mode, setMode] = useState<'buy' | 'sell'>(initialMode);
  const [symbol, setSymbol] = useState<string>(initialSymbol ?? '');
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set(initialSelectedClientIds || []));
  const [allocationPct, setAllocationPct] = useState<string>('10');
  const [sellPercentage, setSellPercentage] = useState<number>(100);
  const [priceMode, setPriceMode] = useState<'exact' | 'band'>('exact');
  const [exactPrice, setExactPrice] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const cleanSym = (symbol || '').trim().toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
  const meta = getStockMeta(cleanSym);

  const targetClients = useMemo(() => {
    if (mode === 'sell' && holdingsData && holdingsData.length > 0) {
      return clients.filter(c => holdingsData.some(h => h.client_id === c.id));
    }
    return clients;
  }, [clients, mode, holdingsData]);

  interface CalculatedOrder {
    client: Client;
    qty: number;
    price: number;
    budget?: number;
    mode: 'buy' | 'sell';
    holding?: Holding;
  }

  const calculatedOrders = useMemo(() => {
    const orders: CalculatedOrder[] = [];
    const p = priceMode === 'exact' ? parseFloat(exactPrice) : (parseFloat(minPrice) + parseFloat(maxPrice)) / 2;
    if (!p || p <= 0) return orders;

    targetClients.forEach(c => {
      if (!selectedClients.has(c.id)) return;
      if (mode === 'buy') {
        const freeCash = getClientFreeCash(c);
        const alloc = parseFloat(allocationPct) || 0;
        const budget = freeCash * (alloc / 100);
        const qty = Math.floor(budget / p);
        if (qty > 0) {
          orders.push({ client: c, qty, price: p, budget, mode: 'buy' });
        }
      } else {
        const h = holdingsData?.find(x => x.client_id === c.id);
        if (h && h.quantity > 0 && h.id) {
          const qtyToSell = Math.max(1, Math.round((h.quantity * sellPercentage) / 100));
          orders.push({ client: c, qty: qtyToSell, price: p, mode: 'sell', holding: h });
        }
      }
    });
    return orders;
  }, [targetClients, selectedClients, mode, allocationPct, sellPercentage, priceMode, exactPrice, minPrice, maxPrice, holdingsData]);

  const handleExecute = async () => {
    setIsProcessing(true);
    setError('');
    try {
      if (calculatedOrders.length === 0) throw new Error("No valid orders calculated.");
      const batchDate = new Date().toISOString();
      const p = priceMode === 'exact' ? parseFloat(exactPrice) : (parseFloat(minPrice) + parseFloat(maxPrice)) / 2;
      const companyName = meta.companyName || cleanSym;

      for (const order of calculatedOrders) {
        if (mode === 'buy') {
          // Check if client already holds this scrip
          const qSnap = await getDocs(
            query(
              collection(db, 'holdings'),
              where('client_id', '==', order.client.id)
            )
          );
          const existing = qSnap.docs.find(d => {
            const hdata = d.data();
            const hSym = (hdata.nse_symbol || hdata.stock_symbol || '').toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
            return hSym === cleanSym;
          });

          if (existing) {
            const eh = existing.data() as Holding;
            const newQty = (eh.quantity || 0) + order.qty;
            const prevInvested = eh.invested_amount || ((eh.buy_price || 0) * (eh.quantity || 0));
            const newInvested = prevInvested + (order.qty * p);
            const newAvgBuy = newQty > 0 ? newInvested / newQty : p;
            const currPrice = eh.current_price > 0 ? eh.current_price : p;
            const newCurrentVal = newQty * currPrice;
            const unrealPnl = newCurrentVal - newInvested;
            const unrealPnlPct = newInvested > 0 ? (unrealPnl / newInvested) * 100 : 0;

            await updateDoc(doc(db, 'holdings', existing.id), {
              quantity: newQty,
              buy_price: newAvgBuy,
              invested_amount: newInvested,
              current_price: currPrice,
              current_value: newCurrentVal,
              unrealised_pnl: unrealPnl,
              unrealised_pnl_pct: unrealPnlPct,
              last_price_update: batchDate,
            });
          } else {
            await addDoc(collection(db, 'holdings'), {
              client_id: order.client.id,
              stock_symbol: cleanSym,
              nse_symbol: cleanSym,
              company_name: companyName,
              quantity: order.qty,
              buy_price: p,
              current_price: p,
              invested_amount: order.qty * p,
              current_value: order.qty * p,
              unrealised_pnl: 0,
              unrealised_pnl_pct: 0,
              realised_pnl: 0,
              source: 'Fresh',
              rebalancing_date: null,
              last_price_update: batchDate,
              created_at: batchDate,
            });
          }

          // Add Transaction record
          await addDoc(collection(db, 'transactions'), {
            client_id: order.client.id,
            date: batchDate.split('T')[0],
            action: 'BUY',
            stock_symbol: cleanSym,
            company_name: companyName,
            quantity: order.qty,
            price: p,
            total_value: order.qty * p,
            created_at: batchDate,
          });
        } else {
          // Sell logic
          if (!order.holding) continue;
          const h = order.holding;
          const totalVal = order.qty * p;
          const investedPerUnit = h.quantity > 0 ? (h.invested_amount || h.buy_price * h.quantity) / h.quantity : h.buy_price;
          const investedSold = investedPerUnit * order.qty;
          const profitLoss = totalVal - investedSold;
          const remainingQty = h.quantity - order.qty;

          if (remainingQty <= 0) {
            await deleteDoc(doc(db, 'holdings', h.id));
          } else {
            const remInvested = investedPerUnit * remainingQty;
            const currPrice = h.current_price > 0 ? h.current_price : p;
            const remVal = remainingQty * currPrice;
            const unrealPnl = remVal - remInvested;
            const unrealPnlPct = remInvested > 0 ? (unrealPnl / remInvested) * 100 : 0;

            await updateDoc(doc(db, 'holdings', h.id), {
              quantity: remainingQty,
              invested_amount: remInvested,
              current_value: remVal,
              unrealised_pnl: unrealPnl,
              unrealised_pnl_pct: unrealPnlPct,
              realised_pnl: (h.realised_pnl || 0) + profitLoss,
              last_price_update: batchDate,
            });
          }

          // Add Transaction record
          await addDoc(collection(db, 'transactions'), {
            client_id: order.client.id,
            date: batchDate.split('T')[0],
            action: 'SELL',
            stock_symbol: (h.nse_symbol || h.stock_symbol || cleanSym).toUpperCase(),
            company_name: h.company_name || companyName,
            quantity: order.qty,
            price: p,
            total_value: totalVal,
            created_at: batchDate,
          });
        }
      }
      onSuccess();
    } catch (err) {
      console.error('Bulk order execution error:', err);
      setError((err as Error).message || 'Execution failed');
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
      <div className="animate-scale-up" style={{ background: 'var(--bg-elevated)', borderRadius: 16, width: '100%', maxWidth: 740, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
        
        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: mode === 'buy' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: mode === 'buy' ? '#16a34a' : '#ef4444',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {mode === 'buy' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Bulk {mode === 'buy' ? 'Buy / Add Quantity' : 'Sell'} Wizard
              </h2>
              {cleanSym && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Scrip: <strong style={{ color: '#C9A84C' }}>{cleanSym}</strong> {meta.companyName ? `(${meta.companyName})` : ''}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
        </div>

        {/* Content */}
        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          {error && (
            <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: 8, marginBottom: 20, fontSize: 13, display: 'flex', gap: 8 }}>
              <ShieldAlert size={16} /> {error}
            </div>
          )}

          {/* STEP 1: Select Stock & Action */}
          {step === 'action' && (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                1. Select Action & Stock Symbol
              </h3>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <button
                  onClick={() => setMode('buy')}
                  style={{
                    flex: 1, padding: '14px 16px', borderRadius: 8,
                    border: mode === 'buy' ? '2px solid #16a34a' : '1px solid var(--border-default)',
                    background: mode === 'buy' ? 'rgba(34,197,94,0.08)' : 'transparent',
                    fontWeight: 600, color: mode === 'buy' ? '#16a34a' : 'var(--text-primary)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                  }}
                >
                  <TrendingUp size={16} /> Buy / Add More Quantity
                </button>
                <button
                  onClick={() => setMode('sell')}
                  style={{
                    flex: 1, padding: '14px 16px', borderRadius: 8,
                    border: mode === 'sell' ? '2px solid #ef4444' : '1px solid var(--border-default)',
                    background: mode === 'sell' ? 'rgba(239,68,68,0.08)' : 'transparent',
                    fontWeight: 600, color: mode === 'sell' ? '#ef4444' : 'var(--text-primary)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                  }}
                >
                  <TrendingDown size={16} /> Bulk Sell
                </button>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Stock Symbol (NSE / BSE)</label>
                <input
                  type="text"
                  placeholder="Enter Stock Symbol (e.g. RELIANCE, NESTLEIND, HDFCBANK)"
                  value={symbol}
                  onChange={e => setSymbol(e.target.value.toUpperCase())}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', boxSizing: 'border-box', fontSize: 14 }}
                />
                {meta.companyName && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    Recognized: <strong style={{ color: 'var(--text-primary)' }}>{meta.companyName}</strong> • Sector: <strong>{meta.sector}</strong>
                  </div>
                )}
              </div>

              <button
                disabled={!cleanSym}
                onClick={() => setStep('clients')}
                style={{
                  width: '100%', padding: 12, background: 'var(--color-primary-600)', color: '#fff',
                  borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14,
                  cursor: cleanSym ? 'pointer' : 'not-allowed', opacity: cleanSym ? 1 : 0.5,
                  transition: 'background 0.2s'
                }}
              >
                Next: Select Clients →
              </button>
            </div>
          )}

          {/* STEP 2: Select Clients & Allocation */}
          {step === 'clients' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  2. Select Clients {mode === 'buy' ? '& Free Cash Allocation' : '& Sell Quantity'}
                </h3>
                <button
                  onClick={() => setStep('action')}
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary-400)', fontSize: 12, cursor: 'pointer' }}
                >
                  ← Change Symbol
                </button>
              </div>

              {mode === 'buy' ? (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Free Cash Allocation % (Applies across selected clients):
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {[5, 10, 15, 20, 25, 50, 100].map(pct => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setAllocationPct(String(pct))}
                        style={{
                          padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                          border: allocationPct === String(pct) ? '1px solid var(--color-primary-500)' : '1px solid var(--border-subtle)',
                          background: allocationPct === String(pct) ? 'var(--color-primary-600)' : 'var(--bg-elevated)',
                          color: allocationPct === String(pct) ? '#ffffff' : 'var(--text-secondary)',
                          fontWeight: 500
                        }}
                      >
                        {pct}%
                      </button>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={allocationPct}
                        onChange={e => setAllocationPct(e.target.value)}
                        style={{ width: 60, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 12 }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Sell Percentage of Holding:
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[25, 50, 75, 100].map(pct => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setSellPercentage(pct)}
                        style={{
                          padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                          border: sellPercentage === pct ? '1px solid #ef4444' : '1px solid var(--border-subtle)',
                          background: sellPercentage === pct ? '#ef4444' : 'var(--bg-elevated)',
                          color: sellPercentage === pct ? '#ffffff' : 'var(--text-secondary)',
                          fontWeight: 600
                        }}
                      >
                        {pct === 100 ? '100% (Full Exit)' : `${pct}%`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, maxHeight: 280, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '8px 12px', width: 30 }}>
                        <input
                          type="checkbox"
                          checked={selectedClients.size > 0 && selectedClients.size === targetClients.length}
                          onChange={toggleAll}
                        />
                      </th>
                      <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Client Name</th>
                      {mode === 'buy' ? (
                        <>
                          <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Total Capital</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Free Cash</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Allocated Budget</th>
                        </>
                      ) : (
                        <>
                          <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Holding Qty</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Qty to Sell</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {targetClients.map(c => {
                      const h = holdingsData?.find(x => x.client_id === c.id);
                      const freeCash = getClientFreeCash(c);
                      const alloc = parseFloat(allocationPct) || 0;
                      const allocatedBudget = freeCash * (alloc / 100);
                      const isSelected = selectedClients.has(c.id);

                      return (
                        <tr
                          key={c.id}
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            background: isSelected ? 'rgba(201,168,76,0.04)' : 'transparent',
                            cursor: 'pointer'
                          }}
                          onClick={() => toggleClient(c.id)}
                        >
                          <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleClient(c.id)}
                            />
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</td>
                          {mode === 'buy' ? (
                            <>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>
                                ₹{(c.total_capital || c.totalCapital || 0).toLocaleString('en-IN')}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: freeCash > 0 ? '#16a34a' : 'var(--text-muted)' }}>
                                ₹{freeCash.toLocaleString('en-IN')}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--color-primary-400)' }}>
                                ₹{Math.round(allocatedBudget).toLocaleString('en-IN')}
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>
                                {h?.quantity?.toLocaleString('en-IN') || 0}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#ef4444' }}>
                                {Math.max(1, Math.round(((h?.quantity || 0) * sellPercentage) / 100)).toLocaleString('en-IN')}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <button
                disabled={selectedClients.size === 0}
                onClick={() => setStep('price')}
                style={{
                  width: '100%', marginTop: 20, padding: 12, background: 'var(--color-primary-600)', color: '#fff',
                  borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14,
                  cursor: selectedClients.size > 0 ? 'pointer' : 'not-allowed', opacity: selectedClients.size > 0 ? 1 : 0.5,
                  transition: 'background 0.2s'
                }}
              >
                Next: Pricing Strategy ({selectedClients.size} clients selected) →
              </button>
            </div>
          )}

          {/* STEP 3: Pricing Strategy */}
          {step === 'price' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  3. Pricing Strategy
                </h3>
                <button
                  onClick={() => setStep('clients')}
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary-400)', fontSize: 12, cursor: 'pointer' }}
                >
                  ← Back to Clients
                </button>
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <button
                  onClick={() => setPriceMode('exact')}
                  style={{
                    flex: 1, padding: 12, borderRadius: 8,
                    border: priceMode === 'exact' ? '2px solid var(--color-primary-500)' : '1px solid var(--border-default)',
                    background: priceMode === 'exact' ? 'rgba(201,168,76,0.08)' : 'transparent',
                    fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer'
                  }}
                >
                  Exact Price
                </button>
                <button
                  onClick={() => setPriceMode('band')}
                  style={{
                    flex: 1, padding: 12, borderRadius: 8,
                    border: priceMode === 'band' ? '2px solid var(--color-primary-500)' : '1px solid var(--border-default)',
                    background: priceMode === 'band' ? 'rgba(201,168,76,0.08)' : 'transparent',
                    fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer'
                  }}
                >
                  Price Band (Min - Max)
                </button>
              </div>

              {priceMode === 'exact' ? (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Execution Price (₹)</label>
                  <input
                    type="number"
                    value={exactPrice}
                    onChange={e => setExactPrice(e.target.value)}
                    placeholder="e.g. 1500.50"
                    autoFocus
                    style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', boxSizing: 'border-box', fontSize: 14 }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Min Price (₹)</label>
                    <input
                      type="number"
                      value={minPrice}
                      onChange={e => setMinPrice(e.target.value)}
                      placeholder="e.g. 1480.00"
                      style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', boxSizing: 'border-box', fontSize: 14 }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Max Price (₹)</label>
                    <input
                      type="number"
                      value={maxPrice}
                      onChange={e => setMaxPrice(e.target.value)}
                      placeholder="e.g. 1520.00"
                      style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', boxSizing: 'border-box', fontSize: 14 }}
                    />
                  </div>
                </div>
              )}

              <button
                disabled={priceMode === 'exact' ? !exactPrice : (!minPrice || !maxPrice)}
                onClick={() => setStep('confirm')}
                style={{
                  width: '100%', padding: 12, background: 'var(--color-primary-600)', color: '#fff',
                  borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14,
                  cursor: (priceMode === 'exact' ? exactPrice : (minPrice && maxPrice)) ? 'pointer' : 'not-allowed',
                  opacity: (priceMode === 'exact' ? exactPrice : (minPrice && maxPrice)) ? 1 : 0.5,
                  transition: 'background 0.2s'
                }}
              >
                Review Order Execution →
              </button>
            </div>
          )}

          {/* STEP 4: Review & Execute */}
          {step === 'confirm' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  4. Confirm Bulk Order Execution
                </h3>
                <button
                  onClick={() => setStep('price')}
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary-400)', fontSize: 12, cursor: 'pointer' }}
                >
                  ← Edit Price
                </button>
              </div>

              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: 16, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Action:</span>
                  <strong style={{ color: mode === 'buy' ? '#16a34a' : '#ef4444' }}>BULK {mode.toUpperCase()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Stock Symbol:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{cleanSym} {meta.companyName ? `(${meta.companyName})` : ''}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Eligible Orders:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{calculatedOrders.length} client(s)</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Execution Price:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    ₹{priceMode === 'exact' ? parseFloat(exactPrice).toFixed(2) : ((parseFloat(minPrice) + parseFloat(maxPrice)) / 2).toFixed(2)}
                  </strong>
                </div>
              </div>

              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, maxHeight: 220, overflowY: 'auto', marginBottom: 20 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--text-muted)' }}>Client</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Qty</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Est. Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculatedOrders.map((o, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--text-primary)' }}>{o.client.name}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{o.qty.toLocaleString('en-IN')}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 500, color: 'var(--text-primary)' }}>
                          ₹{(o.qty * o.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                disabled={isProcessing || calculatedOrders.length === 0}
                onClick={handleExecute}
                style={{
                  width: '100%', padding: 14, background: mode === 'buy' ? '#16a34a' : '#ef4444',
                  color: '#fff', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14,
                  cursor: isProcessing ? 'wait' : 'pointer', opacity: isProcessing ? 0.7 : 1,
                  transition: 'background 0.2s'
                }}
              >
                {isProcessing ? 'Executing in Firestore...' : `Execute ${mode.toUpperCase()} for ${calculatedOrders.length} Client(s)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
