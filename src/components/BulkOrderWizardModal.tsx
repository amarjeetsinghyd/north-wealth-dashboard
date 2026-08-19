import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
  holdingsData?: Holding[];
}

type Step = 'action' | 'clients' | 'price' | 'confirm';
type BuyAllocType = 'percent_cash' | 'fixed_qty' | 'fixed_amount';

function getClientFreeCash(c: Client & { totalCapital?: number; value?: number; invested?: number; mutual_funds?: number }) {
  if (c.asset_free_cash !== undefined && c.asset_free_cash !== null) {
    return Math.max(0, c.asset_free_cash);
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
  
  // Buy Allocation Controls
  const [buyAllocType, setBuyAllocType] = useState<BuyAllocType>('percent_cash');
  const [allocationPct, setAllocationPct] = useState<string>('10');
  const [fixedQtyValue, setFixedQtyValue] = useState<string>('10');
  const [fixedAmountValue, setFixedAmountValue] = useState<string>('25000');
  const [customClientQty, setCustomClientQty] = useState<Record<string, number>>({});

  // Sell Allocation Controls
  const [sellPercentage, setSellPercentage] = useState<number>(100);

  // Pricing Strategy & Execution Layer
  const [priceMode, setPriceMode] = useState<'exact' | 'band'>('exact');
  const [exactPrice, setExactPrice] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [executionDate, setExecutionDate] = useState<string>(new Date().toISOString().split('T')[0] || '');
  const [strategyBucket, setStrategyBucket] = useState<'Long-Term' | 'Momentum'>('Long-Term');
  
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

  const effectivePrice = useMemo(() => {
    if (priceMode === 'exact') {
      return parseFloat(exactPrice) || 0;
    }
    const minP = parseFloat(minPrice) || 0;
    const maxP = parseFloat(maxPrice) || 0;
    return (minP + maxP) / 2;
  }, [priceMode, exactPrice, minPrice, maxPrice]);

  const calculatedOrders = useMemo(() => {
    const orders: CalculatedOrder[] = [];
    const p = effectivePrice > 0 ? effectivePrice : 1;

    targetClients.forEach(c => {
      if (!selectedClients.has(c.id)) return;
      if (mode === 'buy') {
        let qty = 0;
        let budget = 0;

        if (customClientQty[c.id] !== undefined) {
          qty = customClientQty[c.id] ?? 0;
          budget = qty * p;
        } else if (buyAllocType === 'percent_cash') {
          const freeCash = getClientFreeCash(c);
          const alloc = parseFloat(allocationPct) || 0;
          budget = freeCash * (alloc / 100);
          qty = p > 0 ? Math.floor(budget / p) : 0;
          if (qty <= 0 && freeCash === 0) {
            qty = 1;
            budget = qty * p;
          }
        } else if (buyAllocType === 'fixed_qty') {
          qty = parseInt(fixedQtyValue, 10) || 0;
          budget = qty * p;
        } else if (buyAllocType === 'fixed_amount') {
          budget = parseFloat(fixedAmountValue) || 0;
          qty = p > 0 ? Math.floor(budget / p) : 0;
        }

        if (qty > 0) {
          orders.push({ client: c, qty, price: p, budget, mode: 'buy' });
        }
      } else {
        const h = holdingsData?.find(x => x.client_id === c.id);
        if (h && h.quantity > 0 && h.id) {
          const qtyToSell = (customClientQty[c.id] !== undefined)
            ? (customClientQty[c.id] ?? 0)
            : Math.max(1, Math.round((h.quantity * sellPercentage) / 100));
          if (qtyToSell > 0) {
            orders.push({ client: c, qty: qtyToSell, price: p, mode: 'sell', holding: h });
          }
        }
      }
    });
    return orders;
  }, [targetClients, selectedClients, mode, buyAllocType, allocationPct, fixedQtyValue, fixedAmountValue, customClientQty, sellPercentage, effectivePrice, holdingsData]);

  const handleExecute = async () => {
    setIsProcessing(true);
    setError('');
    try {
      if (effectivePrice <= 0) throw new Error("Please enter a valid price before executing.");
      if (calculatedOrders.length === 0) throw new Error("No valid orders calculated. Please select clients and quantity.");
      
      const nowIso = new Date().toISOString();
      const tradeDate = executionDate || nowIso.split('T')[0];
      const p = effectivePrice;
      const companyName = meta.companyName || cleanSym;
      const priceRangeStr = priceMode === 'band' ? `₹${minPrice} - ₹${maxPrice}` : null;

      for (const order of calculatedOrders) {
        const clientRef = doc(db, 'clients', order.client.id);
        const currFreeCash = getClientFreeCash(order.client);

        if (mode === 'buy') {
          const qSnap = await getDocs(
            query(
              collection(db, 'holdings'),
              where('client_id', '==', order.client.id)
            )
          );
          const existing = qSnap.docs.find(d => {
            const hdata = d.data() as any;
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
              purchase_date: tradeDate,
              last_price_update: nowIso,
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
              purchase_date: tradeDate,
              rebalancing_date: null,
              last_price_update: nowIso,
              created_at: nowIso,
            });
          }

          // Deduct from Client's Free Cash
          const newFreeCash = Math.max(0, currFreeCash - (order.qty * p));
          await updateDoc(clientRef, { asset_free_cash: newFreeCash });

          // Add Transaction record
          await addDoc(collection(db, 'transactions'), {
            client_id: order.client.id,
            date: tradeDate,
            action: 'BUY',
            stock_symbol: cleanSym,
            company_name: companyName,
            quantity: order.qty,
            price: p,
            total_value: order.qty * p,
            price_range: priceRangeStr,
            bucket: strategyBucket,
            created_at: nowIso,
          });
        } else {
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
              last_price_update: nowIso,
            });
          }

          // Add to Client's Free Cash
          const newFreeCash = currFreeCash + totalVal;
          await updateDoc(clientRef, { asset_free_cash: newFreeCash });

          // Add Transaction record
          await addDoc(collection(db, 'transactions'), {
            client_id: order.client.id,
            date: tradeDate,
            action: 'SELL',
            stock_symbol: (h.nse_symbol || h.stock_symbol || cleanSym).toUpperCase(),
            company_name: h.company_name || companyName,
            quantity: order.qty,
            price: p,
            total_value: totalVal,
            price_range: priceRangeStr,
            bucket: strategyBucket,
            created_at: nowIso,
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

  return createPortal(
    <div
      className="glass-modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass-modal animate-scale-up" style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid rgba(229, 231, 235, 0.6)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.65)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: mode === 'buy' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              color: mode === 'buy' ? '#16a34a' : '#ef4444',
              border: `1px solid ${mode === 'buy' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            }}>
              {mode === 'buy' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Bulk {mode === 'buy' ? 'Buy / Add More Quantity' : 'Sell'} Wizard
              </h2>
              {cleanSym && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Scrip: <strong style={{ color: '#C9A84C' }}>{cleanSym}</strong> {meta.companyName ? `(${meta.companyName})` : ''}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(0,0,0,0.05)', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          {error && (
            <div style={{ padding: 12, background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, marginBottom: 20, fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
              <ShieldAlert size={16} /> {error}
            </div>
          )}

          {/* STEP 1: Select Stock & Action */}
          {step === 'action' && (
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                1. Select Action & Stock Symbol
              </h3>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={() => setMode('buy')}
                  style={{
                    flex: 1, padding: '14px 16px', borderRadius: 12,
                    border: mode === 'buy' ? '2px solid #22c55e' : '1px solid rgba(229, 231, 235, 0.8)',
                    background: mode === 'buy' ? 'rgba(34,197,94,0.09)' : 'rgba(255, 255, 255, 0.5)',
                    backdropFilter: 'blur(8px)',
                    fontWeight: 600, color: mode === 'buy' ? '#16a34a' : 'var(--text-primary)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    boxShadow: mode === 'buy' ? '0 4px 15px rgba(34,197,94,0.15)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <TrendingUp size={16} /> Buy / Add More Quantity
                </button>
                <button
                  type="button"
                  onClick={() => setMode('sell')}
                  style={{
                    flex: 1, padding: '14px 16px', borderRadius: 12,
                    border: mode === 'sell' ? '2px solid #ef4444' : '1px solid rgba(229, 231, 235, 0.8)',
                    background: mode === 'sell' ? 'rgba(239,68,68,0.09)' : 'rgba(255, 255, 255, 0.5)',
                    backdropFilter: 'blur(8px)',
                    fontWeight: 600, color: mode === 'sell' ? '#ef4444' : 'var(--text-primary)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    boxShadow: mode === 'sell' ? '0 4px 15px rgba(239,68,68,0.15)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <TrendingDown size={16} /> Bulk Sell
                </button>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 6 }}>Stock Symbol (NSE / BSE)</label>
                <input
                  type="text"
                  placeholder="Enter Stock Symbol (e.g. RELIANCE, NESTLEIND, HDFCBANK)"
                  value={symbol}
                  onChange={e => setSymbol(e.target.value.toUpperCase())}
                  className="glass-input"
                  style={{ width: '100%', padding: '12px 16px', boxSizing: 'border-box', fontSize: 14 }}
                  autoFocus
                />
                
                {/* Quick Pick Chips */}
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Quick Pick:</span>
                  {['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'ITC', 'NIFTYBEES', 'GOLDBEES'].map(sym => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => setSymbol(sym)}
                      style={{
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: cleanSym === sym ? 'rgba(201, 168, 76, 0.22)' : 'rgba(0, 0, 0, 0.04)',
                        border: cleanSym === sym ? '1px solid rgba(201, 168, 76, 0.5)' : '1px solid rgba(0, 0, 0, 0.08)',
                        color: cleanSym === sym ? '#8c6314' : 'var(--text-secondary)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {sym}
                    </button>
                  ))}
                </div>

                {meta.companyName && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="glass-pill-green" style={{ fontSize: 11 }}>✓ Recognized: <strong style={{ marginLeft: 2 }}>{meta.companyName}</strong></span>
                    <span className="glass-pill-gold" style={{ fontSize: 11 }}>Sector: <strong style={{ marginLeft: 2 }}>{meta.sector}</strong></span>
                    <span className="glass-pill" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>M.Cap: <strong style={{ marginLeft: 2 }}>{meta.marketCap}</strong></span>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={!cleanSym}
                onClick={() => setStep('clients')}
                className="btn-glass-gold"
                style={{
                  width: '100%', padding: 13, fontSize: 14,
                  cursor: cleanSym ? 'pointer' : 'not-allowed', opacity: cleanSym ? 1 : 0.5,
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
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  2. Select Clients & Allocation
                </h3>
                <button
                  type="button"
                  onClick={() => setStep('action')}
                  className="btn-glass-light"
                  style={{ padding: '4px 12px', fontSize: 12 }}
                >
                  ← Change Symbol
                </button>
              </div>

              {mode === 'buy' ? (
                <div className="glass-card" style={{ padding: 16, marginBottom: 16, background: 'rgba(255, 255, 255, 0.65)' }}>
                  <div style={{ display: 'flex', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: buyAllocType === 'percent_cash' ? 600 : 400, color: 'var(--text-primary)' }}>
                      <input
                        type="radio"
                        name="buyAllocType"
                        checked={buyAllocType === 'percent_cash'}
                        onChange={() => setBuyAllocType('percent_cash')}
                      />
                      % of Free Cash
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: buyAllocType === 'fixed_qty' ? 600 : 400, color: 'var(--text-primary)' }}>
                      <input
                        type="radio"
                        name="buyAllocType"
                        checked={buyAllocType === 'fixed_qty'}
                        onChange={() => setBuyAllocType('fixed_qty')}
                      />
                      Fixed Shares / Client
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: buyAllocType === 'fixed_amount' ? 600 : 400, color: 'var(--text-primary)' }}>
                      <input
                        type="radio"
                        name="buyAllocType"
                        checked={buyAllocType === 'fixed_amount'}
                        onChange={() => setBuyAllocType('fixed_amount')}
                      />
                      Fixed ₹ Budget / Client
                    </label>
                  </div>

                  {buyAllocType === 'percent_cash' && (
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                        Free Cash % to deploy across clients (auto-allocates 1 share if Free Cash is ₹0):
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {[5, 10, 15, 20, 25, 50, 100].map(pct => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setAllocationPct(String(pct))}
                            className={allocationPct === String(pct) ? 'btn-glass-gold' : 'btn-glass-light'}
                            style={{ padding: '4px 10px', fontSize: 12 }}
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
                            className="glass-input"
                            style={{ width: 55, padding: '4px 8px', fontSize: 12, textAlign: 'center' }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>%</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {buyAllocType === 'fixed_qty' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Number of Shares for Each Client:</span>
                      <input
                        type="number"
                        min="1"
                        value={fixedQtyValue}
                        onChange={e => setFixedQtyValue(e.target.value)}
                        className="glass-input"
                        style={{ width: 90, padding: '6px 10px', fontSize: 13, textAlign: 'center' }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>shares</span>
                    </div>
                  )}

                  {buyAllocType === 'fixed_amount' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Target Investment per Client (₹):</span>
                      <input
                        type="number"
                        min="100"
                        step="500"
                        value={fixedAmountValue}
                        onChange={e => setFixedAmountValue(e.target.value)}
                        className="glass-input"
                        style={{ width: 120, padding: '6px 10px', fontSize: 13 }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="glass-card" style={{ padding: 16, marginBottom: 16, background: 'rgba(255, 255, 255, 0.65)' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Sell Percentage of Holding:
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[25, 50, 75, 100].map(pct => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setSellPercentage(pct)}
                        className={sellPercentage === pct ? 'btn-glass-red' : 'btn-glass-light'}
                        style={{ padding: '6px 14px', fontSize: 12 }}
                      >
                        {pct === 100 ? '100% (Full Exit)' : `${pct}%`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="glass-card" style={{ maxHeight: 280, overflowY: 'auto', padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'rgba(255, 255, 255, 0.92)', backdropFilter: 'blur(8px)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid rgba(229, 231, 235, 0.8)' }}>
                      <th style={{ padding: '9px 12px', width: 30 }}>
                        <input
                          type="checkbox"
                          checked={selectedClients.size > 0 && selectedClients.size === targetClients.length}
                          onChange={toggleAll}
                        />
                      </th>
                      <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Client Name</th>
                      {mode === 'buy' ? (
                        <>
                          <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Free Cash</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Target Shares</th>
                        </>
                      ) : (
                        <>
                          <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Holding Qty</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Qty to Sell</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {targetClients.map(c => {
                      const h = holdingsData?.find(x => x.client_id === c.id);
                      const freeCash = getClientFreeCash(c);
                      const isSelected = selectedClients.has(c.id);

                      let defaultQty = 1;
                      if (mode === 'buy') {
                        if (buyAllocType === 'fixed_qty') defaultQty = parseInt(fixedQtyValue, 10) || 1;
                        else if (buyAllocType === 'fixed_amount') defaultQty = Math.max(1, Math.floor((parseFloat(fixedAmountValue) || 1000) / (effectivePrice || 100)));
                        else {
                          const budget = freeCash * ((parseFloat(allocationPct) || 10) / 100);
                          defaultQty = effectivePrice > 0 ? Math.max(1, Math.floor(budget / effectivePrice)) : 1;
                        }
                      } else {
                        defaultQty = Math.max(1, Math.round(((h?.quantity || 0) * sellPercentage) / 100));
                      }

                      const clientQty = customClientQty[c.id] !== undefined ? customClientQty[c.id] : defaultQty;

                      return (
                        <tr
                          key={c.id}
                          style={{
                            borderBottom: '1px solid rgba(229, 231, 235, 0.5)',
                            background: isSelected ? 'rgba(201,168,76,0.06)' : 'transparent',
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
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: freeCash > 0 ? '#16a34a' : 'var(--text-muted)' }}>
                                ₹{freeCash.toLocaleString('en-IN')}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                <input
                                  type="number"
                                  min="1"
                                  value={clientQty}
                                  onChange={e => {
                                    const val = parseInt(e.target.value, 10) || 0;
                                    setCustomClientQty(prev => ({ ...prev, [c.id]: val }));
                                  }}
                                  className="glass-input"
                                  style={{ width: 70, padding: '3px 6px', textAlign: 'right', fontSize: 12 }}
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>
                                {h?.quantity?.toLocaleString('en-IN') || 0}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                <input
                                  type="number"
                                  min="1"
                                  max={h?.quantity || 1}
                                  value={clientQty}
                                  onChange={e => {
                                    const val = parseInt(e.target.value, 10) || 0;
                                    setCustomClientQty(prev => ({ ...prev, [c.id]: val }));
                                  }}
                                  className="glass-input"
                                  style={{ width: 70, padding: '3px 6px', textAlign: 'right', color: '#ef4444', fontWeight: 600, fontSize: 12 }}
                                />
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
                type="button"
                disabled={selectedClients.size === 0}
                onClick={() => setStep('price')}
                className="btn-glass-gold"
                style={{
                  width: '100%', marginTop: 20, padding: 13, fontSize: 14,
                  cursor: selectedClients.size > 0 ? 'pointer' : 'not-allowed', opacity: selectedClients.size > 0 ? 1 : 0.5,
                }}
              >
                Next: Pricing Strategy ({selectedClients.size} clients selected) →
              </button>
            </div>
          )}

          {/* STEP 3: Pricing Strategy & Execution Details */}
          {step === 'price' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  3. Pricing & Strategy Layer
                </h3>
                <button
                  type="button"
                  onClick={() => setStep('clients')}
                  className="btn-glass-light"
                  style={{ padding: '4px 12px', fontSize: 12 }}
                >
                  ← Back to Clients
                </button>
              </div>

              {/* Execution Date & Strategy Bucket Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6 }}>
                    Execution Date
                  </label>
                  <input
                    type="date"
                    value={executionDate}
                    onChange={e => setExecutionDate(e.target.value)}
                    className="glass-input"
                    style={{ width: '100%', padding: '10px 14px', boxSizing: 'border-box', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6 }}>
                    Strategy Bucket
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setStrategyBucket('Long-Term')}
                      style={{
                        flex: 1, padding: '9px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        border: strategyBucket === 'Long-Term' ? '2px solid var(--gold)' : '1px solid rgba(229, 231, 235, 0.8)',
                        background: strategyBucket === 'Long-Term' ? 'rgba(201,168,76,0.15)' : 'rgba(255, 255, 255, 0.5)',
                        color: strategyBucket === 'Long-Term' ? '#8c6314' : 'var(--text-secondary)',
                        cursor: 'pointer', transition: 'all 0.15s'
                      }}
                    >
                      Long-Term Core
                    </button>
                    <button
                      type="button"
                      onClick={() => setStrategyBucket('Momentum')}
                      style={{
                        flex: 1, padding: '9px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        border: strategyBucket === 'Momentum' ? '2px solid #8b5cf6' : '1px solid rgba(229, 231, 235, 0.8)',
                        background: strategyBucket === 'Momentum' ? 'rgba(139,92,246,0.15)' : 'rgba(255, 255, 255, 0.5)',
                        color: strategyBucket === 'Momentum' ? '#6d28d9' : 'var(--text-secondary)',
                        cursor: 'pointer', transition: 'all 0.15s'
                      }}
                    >
                      Momentum Strategy
                    </button>
                  </div>
                </div>
              </div>

              {/* Pricing Mode Toggle */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6 }}>
                  Order Pricing Mode
                </label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setPriceMode('exact')}
                    style={{
                      flex: 1, padding: 12, borderRadius: 12,
                      border: priceMode === 'exact' ? '2px solid var(--gold)' : '1px solid rgba(229, 231, 235, 0.8)',
                      background: priceMode === 'exact' ? 'rgba(201,168,76,0.12)' : 'rgba(255, 255, 255, 0.5)',
                      backdropFilter: 'blur(8px)',
                      fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer',
                      boxShadow: priceMode === 'exact' ? '0 4px 15px rgba(201,168,76,0.18)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    Exact Execution Price
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriceMode('band')}
                    style={{
                      flex: 1, padding: 12, borderRadius: 12,
                      border: priceMode === 'band' ? '2px solid var(--gold)' : '1px solid rgba(229, 231, 235, 0.8)',
                      background: priceMode === 'band' ? 'rgba(201,168,76,0.12)' : 'rgba(255, 255, 255, 0.5)',
                      backdropFilter: 'blur(8px)',
                      fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer',
                      boxShadow: priceMode === 'band' ? '0 4px 15px rgba(201,168,76,0.18)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    Target Buying Range (Min - Max)
                  </button>
                </div>
              </div>

              {priceMode === 'exact' ? (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 6 }}>Execution Price (₹)</label>
                  <input
                    type="number"
                    value={exactPrice}
                    onChange={e => setExactPrice(e.target.value)}
                    placeholder="Enter execution price per share (e.g. 2500.00)"
                    autoFocus
                    className="glass-input"
                    style={{ width: '100%', padding: '12px 16px', boxSizing: 'border-box', fontSize: 14 }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 6 }}>Min Price (₹)</label>
                    <input
                      type="number"
                      value={minPrice}
                      onChange={e => setMinPrice(e.target.value)}
                      placeholder="e.g. 2480.00"
                      className="glass-input"
                      style={{ width: '100%', padding: '12px 16px', boxSizing: 'border-box', fontSize: 14 }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 6 }}>Max Price (₹)</label>
                    <input
                      type="number"
                      value={maxPrice}
                      onChange={e => setMaxPrice(e.target.value)}
                      placeholder="e.g. 2520.00"
                      className="glass-input"
                      style={{ width: '100%', padding: '12px 16px', boxSizing: 'border-box', fontSize: 14 }}
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={priceMode === 'exact' ? (!exactPrice || parseFloat(exactPrice) <= 0) : (!minPrice || !maxPrice)}
                onClick={() => setStep('confirm')}
                className="btn-glass-gold"
                style={{
                  width: '100%', padding: 13, fontSize: 14,
                  cursor: (priceMode === 'exact' ? (exactPrice && parseFloat(exactPrice) > 0) : (minPrice && maxPrice)) ? 'pointer' : 'not-allowed',
                  opacity: (priceMode === 'exact' ? (exactPrice && parseFloat(exactPrice) > 0) : (minPrice && maxPrice)) ? 1 : 0.5,
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
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  4. Confirm Bulk Order Execution
                </h3>
                <button
                  type="button"
                  onClick={() => setStep('price')}
                  className="btn-glass-light"
                  style={{ padding: '4px 12px', fontSize: 12 }}
                >
                  ← Edit Price & Strategy
                </button>
              </div>

              <div className="glass-card" style={{ padding: 16, marginBottom: 16, background: 'rgba(255, 255, 255, 0.65)', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Action:</span>
                  <strong style={{ color: mode === 'buy' ? '#16a34a' : '#ef4444' }}>BULK {mode.toUpperCase()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Stock Symbol:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{cleanSym} {meta.companyName ? `(${meta.companyName})` : ''}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Execution Date:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{executionDate}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Strategy Bucket:</span>
                  <span className={strategyBucket === 'Long-Term' ? 'glass-pill-gold' : 'glass-pill-blue'} style={{ fontSize: 11 }}>
                    {strategyBucket}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Target Clients:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{calculatedOrders.length} client(s)</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Execution Price:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    ₹{effectivePrice.toFixed(2)} {priceMode === 'band' ? `(Range: ₹${minPrice} - ₹${maxPrice})` : ''}
                  </strong>
                </div>
              </div>

              <div className="glass-card" style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 20, padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'rgba(255, 255, 255, 0.92)', backdropFilter: 'blur(8px)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid rgba(229, 231, 235, 0.8)' }}>
                      <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Client</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Qty</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Est. Total Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculatedOrders.map((o, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(229, 231, 235, 0.5)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{o.client.name}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{o.qty.toLocaleString('en-IN')} shares</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: 'var(--text-primary)' }}>
                          ₹{(o.qty * effectivePrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                disabled={isProcessing || calculatedOrders.length === 0 || effectivePrice <= 0}
                onClick={handleExecute}
                className={mode === 'buy' ? 'btn-glass-green' : 'btn-glass-red'}
                style={{
                  width: '100%', padding: 14, fontSize: 14,
                  cursor: isProcessing ? 'wait' : 'pointer',
                  opacity: (isProcessing || calculatedOrders.length === 0 || effectivePrice <= 0) ? 0.5 : 1,
                }}
              >
                {isProcessing ? 'Executing in Firestore...' : `Execute ${mode.toUpperCase()} for ${calculatedOrders.length} Client(s)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
