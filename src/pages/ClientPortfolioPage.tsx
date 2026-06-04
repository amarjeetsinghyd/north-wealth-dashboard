import { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, IndianRupee, TrendingUp, TrendingDown, ChartBar as BarChart3, CircleAlert as AlertCircle, Pencil, Check, X as XIcon, PlusCircle, Wallet, Landmark, Download, RefreshCw } from 'lucide-react';
import { fetchClient, fetchHoldings, fetchTransactions } from '../lib/queries';
import { doc, updateDoc, addDoc, collection, deleteDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Client, Holding, Transaction, PortfolioSummary } from '../types';
import { SummaryCard } from '../components/SummaryCard';
import { PnLBadge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { getStockMeta, cleanSymbol } from '../lib/sectorMap';

function fmtCurrency(v: number) {
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type SortColumn = 'scrip' | 'sector' | 'marketCap' | 'qty' | 'buy_price' | 'current_price' | 'invested_amount' | 'current_value' | 'unrealised_pnl' | 'unrealised_pnl_pct' | 'alloc' | null;
type SortOrder = 'asc' | 'desc';

export function ClientPortfolioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Rebalance & Inline Actions
  const [isRebalanceMode, setIsRebalanceMode] = useState(false);
  const [sellModalData, setSellModalData] = useState<{ holding: Holding, sellPrice: string, quantity: string } | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [nseSymbol, setNseSymbol] = useState('');
  const [buyQuantity, setBuyQuantity] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [savingTransaction, setSavingTransaction] = useState(false);

  // Total Capital & Cash Balance
  const [totalCapital, setTotalCapital] = useState<number>(0);
  const [totalCapitalInput, setTotalCapitalInput] = useState<string>('');
  const [editingCapital, setEditingCapital] = useState(false);
  const [savingCapital, setSavingCapital] = useState(false);
  
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [editingBuyPrice, setEditingBuyPrice] = useState<string | null>(null);
  const [editBuyPriceVal, setEditBuyPriceVal] = useState('');

  const [sectorFilter, setSectorFilter] = useState<string>('');
  const [mcapFilter, setMcapFilter] = useState<string>('');

  const uniqueSectors = Array.from(new Set(holdings.map(h => getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '').sector))).filter(Boolean).sort();
  const uniqueMCaps = Array.from(new Set(holdings.map(h => getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '').marketCap))).filter(Boolean).sort();
  const [savingBuyPrice, setSavingBuyPrice] = useState(false);

  const autoRefreshedRef = useRef(false);

  // ── Refresh prices from NSE Bhavcopy (written nightly by GitHub Actions) ────
  // GitHub Actions runs sync_bhavcopy.py every weekday at 7:30 PM IST and
  // populates price_cache in Firestore. This function simply reads from there.
  const refreshPrices = async (customHoldings?: Holding[]) => {
    const activeHoldings = customHoldings || holdings;
    if (!id || activeHoldings.length === 0) return;

    setRefreshing(true);
    try {
      // 1. Read all holding symbols from price_cache in parallel
      const syms = activeHoldings
        .map(h => (h.nse_symbol || h.stock_symbol || '').trim().toUpperCase())
        .filter(Boolean);

      console.log(`Fetching ${syms.length} prices from NSE price_cache...`);
      const snapshots = await Promise.all(
        syms.map(sym => getDoc(doc(db, 'price_cache', sym)))
      );

      const priceMap = new Map<string, number>();
      snapshots.forEach((snap, i) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.close > 0) priceMap.set(syms[i], data.close);
        }
      });
      console.log(`price_cache: ${priceMap.size}/${syms.length} symbols matched`);

      // 2. Update each holding with the latest EOD close price
      let updatedCount = 0;
      for (const holding of activeHoldings) {
        try {
          const sym = (holding.nse_symbol || holding.stock_symbol || '').trim().toUpperCase();
          const price = priceMap.get(sym) || 0;

          if (price > 0) {
            const current_value      = holding.quantity * price;
            const invested_amount    = holding.quantity * holding.buy_price;
            const unrealised_pnl     = current_value - invested_amount;
            const unrealised_pnl_pct = invested_amount > 0 ? (unrealised_pnl / invested_amount) * 100 : 0;

            await updateDoc(doc(db, 'holdings', holding.id), {
              current_price:     price,
              current_value,
              invested_amount,
              unrealised_pnl,
              unrealised_pnl_pct,
              last_price_update: new Date().toISOString(),
            });
            updatedCount++;
            console.log(`✓ ${sym}: ₹${price}`);
          } else {
            console.warn(`✗ ${sym}: no price in cache (keeping existing)`);
          }
        } catch (e) {
          console.warn(`Error updating ${holding.stock_symbol}:`, e);
        }
      }

      console.log(`Updated ${updatedCount}/${activeHoldings.length} holdings`);

      // 3. Reload holdings into UI
      const fresh = await fetchHoldings(id);
      setHoldings(fresh);

    } catch (err: any) {
      console.error('Refresh error:', err);
      alert('Price refresh failed: ' + (err.message || 'Try again later.'));
    } finally {
      setRefreshing(false);
    }
  };


  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, h, tx] = await Promise.all([
        fetchClient(id),
        fetchHoldings(id),
        fetchTransactions(id),
      ]);
      setClient(c);
      setHoldings(h);
      setTransactions(tx);
    } catch (err) {
      console.error('Error loading portfolio data:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh prices once after initial load
  useEffect(() => {
    if (holdings.length > 0 && !autoRefreshedRef.current) {
      autoRefreshedRef.current = true;
      refreshPrices(holdings);
    }
  }, [holdings]);

  const handleDownloadExcel = () => {
    import('xlsx').then((XLSX) => {
      const dataToExport = getSortedHoldings().map((h, idx) => {
        const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
        const summaryCurrentValue = holdings.reduce((sum, hold) => sum + (hold.current_value || hold.buy_price * hold.quantity), 0);
        return {
          'S.No.': idx + 1,
          'Asset': cleanSymbol(h),
          'Company Name': meta.companyName || h.company_name || '',
          'Sector': meta.sector,
          'M Cap Category': meta.marketCap,
          'Quantity': h.quantity,
          'Avg. Buy': h.buy_price,
          'Curr. Price': h.current_price,
          'Invested': h.invested_amount || (h.buy_price * h.quantity),
          'Current Val': h.current_value || (h.buy_price * h.quantity),
          'Net P&L': h.unrealised_pnl,
          'Net P&L %': h.unrealised_pnl_pct,
          'Alloc %': summaryCurrentValue > 0 ? (((h.current_value || h.buy_price * h.quantity) / summaryCurrentValue) * 100) : 0
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Holdings");
      XLSX.writeFile(workbook, `${client?.name || 'Client'}_Holdings.xlsx`);
    });
  };

  const getSortedHoldings = () => {
    let filtered = holdings;
    if (sectorFilter) {
      filtered = filtered.filter(h => {
        const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
        return meta.sector === sectorFilter;
      });
    }
    if (mcapFilter) {
      filtered = filtered.filter(h => {
        const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
        return meta.marketCap === mcapFilter;
      });
    }

    if (!sortColumn) return filtered;
    
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const aMeta = getStockMeta(a.nse_symbol || a.stock_symbol || '', a.company_name || '');
      const bMeta = getStockMeta(b.nse_symbol || b.stock_symbol || '', b.company_name || '');

      if (sortColumn === 'scrip') {
        const aSym = cleanSymbol(a);
        const bSym = cleanSymbol(b);
        return sortOrder === 'asc' ? aSym.localeCompare(bSym) : bSym.localeCompare(aSym);
      }
      if (sortColumn === 'sector') {
        return sortOrder === 'asc' ? (aMeta.sector || '').localeCompare(bMeta.sector || '') : (bMeta.sector || '').localeCompare(aMeta.sector || '');
      }
      if (sortColumn === 'marketCap') {
        return sortOrder === 'asc' ? (aMeta.marketCap || '').localeCompare(bMeta.marketCap || '') : (bMeta.marketCap || '').localeCompare(aMeta.marketCap || '');
      }
      
      let aVal: number = 0;
      let bVal: number = 0;
      switch (sortColumn) {
        case 'qty':
          aVal = a.quantity;
          bVal = b.quantity;
          break;
        case 'buy_price':
          aVal = a.buy_price;
          bVal = b.buy_price;
          break;
        case 'current_price':
          aVal = a.current_price;
          bVal = b.current_price;
          break;
        case 'invested_amount':
          aVal = a.invested_amount || a.buy_price * a.quantity;
          bVal = b.invested_amount || b.buy_price * b.quantity;
          break;
        case 'current_value':
        case 'alloc':
          aVal = a.current_value || a.buy_price * a.quantity;
          bVal = b.current_value || b.buy_price * b.quantity;
          break;
        case 'unrealised_pnl':
          aVal = a.unrealised_pnl;
          bVal = b.unrealised_pnl;
          break;
        case 'unrealised_pnl_pct':
          aVal = a.unrealised_pnl_pct;
          bVal = b.unrealised_pnl_pct;
          break;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  };

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortOrder('asc');
    }
  };

  const saveBuyPrice = async (holdingId: string) => {
    const newPrice = parseFloat(editBuyPriceVal);
    if (!newPrice || newPrice <= 0) {
      alert('Please enter a valid price greater than 0');
      return;
    }
    setSavingBuyPrice(true);
    try {
      const holding = holdings.find(h => h.id === holdingId);
      if (!holding) { setSavingBuyPrice(false); return; }

      const invested = newPrice * holding.quantity;
      const currVal = holding.current_price > 0 ? holding.current_price * holding.quantity : 0;
      const unrealisedPnl = currVal > 0 ? currVal - invested : 0;
      const unrealisedPnlPct = invested > 0 && unrealisedPnl !== 0 ? (unrealisedPnl / invested) * 100 : 0;

      await updateDoc(doc(db, 'holdings', holdingId), {
        buy_price: newPrice,
        invested_amount: invested,
        unrealised_pnl: unrealisedPnl,
        unrealised_pnl_pct: unrealisedPnlPct,
      });

      setEditingBuyPrice(null);
      setEditBuyPriceVal('');
      await load();
    } catch (err) {
      console.error('Error saving buy price:', err);
      alert('Unexpected error. Please try again.');
    } finally {
      setSavingBuyPrice(false);
    }
  };

  const saveCapital = async () => {
    if (!id) return;
    const val = parseFloat(totalCapitalInput);
    if (isNaN(val) || val < 0) {
      alert('Please enter a valid total capital amount');
      return;
    }
    setSavingCapital(true);
    try {
      await updateDoc(doc(db, 'clients', id), { total_capital: val });
      setTotalCapital(val);
      setEditingCapital(false);
    } catch (err) {
      console.error('Error saving total capital:', err);
      alert('Failed to save total capital');
    } finally {
      setSavingCapital(false);
    }
  };

  const handleConfirmSell = async () => {
    if (!sellModalData || !id) return;
    const sellQty = parseFloat(sellModalData.quantity);
    const sellPrc = parseFloat(sellModalData.sellPrice);

    if (!sellQty || !sellPrc || sellQty > sellModalData.holding.quantity) {
      alert('Invalid quantity or price');
      return;
    }
    setSavingTransaction(true);

    try {
      const holding = sellModalData.holding;
      const remainingQty = holding.quantity - sellQty;
      const totalValue = sellQty * sellPrc;
      const investedPerUnit = holding.invested_amount / holding.quantity;
      const investedSold = investedPerUnit * sellQty;
      const profitLoss = totalValue - investedSold;

      if (remainingQty > 0) {
        await updateDoc(doc(db, 'holdings', holding.id), {
          quantity: remainingQty,
          current_value: (remainingQty * holding.current_price),
          invested_amount: investedPerUnit * remainingQty,
          unrealised_pnl: (remainingQty * holding.current_price) - (investedPerUnit * remainingQty),
          unrealised_pnl_pct: investedPerUnit > 0 ? (((remainingQty * holding.current_price) - (investedPerUnit * remainingQty)) / (investedPerUnit * remainingQty)) * 100 : 0,
          realised_pnl: holding.realised_pnl + profitLoss,
        });
      } else {
        await deleteDoc(doc(db, 'holdings', holding.id));
      }

      await addDoc(collection(db, 'transactions'), {
        client_id: id,
        date: new Date().toISOString().split('T')[0],
        action: 'SELL',
        stock_symbol: holding.stock_symbol,
        company_name: holding.company_name,
        quantity: sellQty,
        price: sellPrc,
        total_value: totalValue,
        created_at: new Date().toISOString(),
      });

      setSellModalData(null);
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to sell holding');
    } finally {
      setSavingTransaction(false);
    }
  };

  const handleBuy = async () => {
    if (!nseSymbol.trim() || !buyQuantity || !buyPrice || !id) {
      alert('Please fill all fields');
      return;
    }
    setSavingTransaction(true);

    try {
      const qty = parseFloat(buyQuantity);
      const price = parseFloat(buyPrice);
      const cleanSymbol = nseSymbol.trim().toUpperCase();
      const meta = getStockMeta(cleanSymbol);
      const company_name = meta.companyName || '';

      await addDoc(collection(db, 'holdings'), {
        client_id: id,
        stock_symbol: cleanSymbol,
        nse_symbol: cleanSymbol,
        company_name,
        buy_price: price,
        quantity: qty,
        invested_amount: qty * price,
        current_price: 0,
        current_value: 0,
        unrealised_pnl: 0,
        unrealised_pnl_pct: 0,
        realised_pnl: 0,
        created_at: new Date().toISOString(),
      });

      await addDoc(collection(db, 'transactions'), {
        client_id: id,
        date: new Date().toISOString().split('T')[0],
        action: 'BUY',
        stock_symbol: cleanSymbol,
        company_name,
        quantity: qty,
        price,
        total_value: qty * price,
        created_at: new Date().toISOString(),
      });

      setShowBuyModal(false);
      setNseSymbol(''); setBuyQuantity(''); setBuyPrice('');
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to add holding');
    } finally {
      setSavingTransaction(false);
    }
  };

  const summary: PortfolioSummary = holdings.reduce(
    (acc, h) => {
      const hasPrice = h.current_price > 0;
      return {
        totalInvested: acc.totalInvested + (hasPrice ? (h.invested_amount || h.buy_price * h.quantity) : 0),
        currentValue: acc.currentValue + (hasPrice ? (h.current_value || h.buy_price * h.quantity) : 0),
        unrealisedPnL: acc.unrealisedPnL + h.unrealised_pnl,
        realisedPnL: acc.realisedPnL + h.realised_pnl,
        unrealisedPnLPct: 0,
      };
    },
    { totalInvested: 0, currentValue: 0, unrealisedPnL: 0, realisedPnL: 0, unrealisedPnLPct: 0 }
  );
  if (summary.totalInvested > 0) {
    summary.unrealisedPnLPct = (summary.unrealisedPnL / summary.totalInvested) * 100;
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-16)' }}>
        <Spinner size={32} />
      </div>
    );
  }

  if (!client) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-16)' }}>
        <AlertCircle size={40} style={{ color: 'var(--color-error-500)', margin: '0 auto var(--space-4)', display: 'block' }} />
        <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Client not found</p>
        <button onClick={() => navigate('/')} style={{ marginTop: 16, color: 'var(--color-primary-400)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const cashBalance = totalCapital - summary.totalInvested;
  const gridCols = isRebalanceMode ? '0.4fr 1.2fr 0.9fr 0.7fr 0.8fr 1fr 1fr 1fr 1fr 1.2fr 0.8fr 0.8fr 80px' : '0.4fr 1.2fr 0.9fr 0.7fr 0.8fr 1fr 1fr 1fr 1fr 1.2fr 0.8fr 0.8fr';

  return (
    <div className="animate-fade-in">

      {/* Back + Header */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <button
          onClick={() => navigate('/')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: '#555555', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer',
            marginBottom: 20, padding: '6px 0', transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#C9A84C'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#555555'}
        >
          <ArrowLeft size={16} /> Back to Clients
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <div style={{
              width: 52, height: 52, borderRadius: 'var(--radius-full)',
              background: `hsl(${(client.name.charCodeAt(0) * 37) % 360}, 60%, 25%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 'var(--text-xl)',
              color: `hsl(${(client.name.charCodeAt(0) * 37) % 360}, 80%, 70%)`,
            }}>
              {client.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px', margin: 0 }}>
                {client.name}
              </h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
                Onboarded {new Date(client.onboarding_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
                &nbsp;&bull;&nbsp;Portfolio Rebalancing Service
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
              <button
                onClick={() => navigate(`/client/${id}/dashboard`)}
                style={{
                  position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '9px 20px', background: 'linear-gradient(135deg, #D4AF37 0%, #F5D078 40%, #C9A84C 70%, #D4AF37 100%)',
                  backgroundSize: '200% auto', border: 'none', borderRadius: 999, cursor: 'pointer',
                  fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 11, color: '#0a0804',
                  letterSpacing: '1.2px', textTransform: 'uppercase',
                  boxShadow: '0 0 16px rgba(212,175,55,0.3), 0 4px 16px rgba(0,0,0,0.3)',
                  animation: 'goldGlow 2.5s ease-in-out infinite', transition: 'transform 0.2s ease, box-shadow 0.2s ease, background-position 0.4s ease',
                  overflow: 'hidden',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.transform = 'scale(1.05) translateY(-1px)';
                  el.style.backgroundPosition = 'right center';
                  el.style.boxShadow = '0 0 24px rgba(212,175,55,0.6), 0 6px 24px rgba(0,0,0,0.4)';
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.transform = 'scale(1) translateY(0)';
                  el.style.backgroundPosition = 'left center';
                  el.style.boxShadow = '0 0 16px rgba(212,175,55,0.3), 0 4px 16px rgba(0,0,0,0.3)';
                }}
              >
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.35) 50%, transparent 60%)',
                  backgroundSize: '200% auto', animation: 'shimmer 2s linear infinite', borderRadius: 999, pointerEvents: 'none',
                }} />
                <span style={{ fontSize: 14 }}>✦</span>
                <span>Portfolio Intelligence</span>
                <span style={{ fontSize: 14 }}>✦</span>
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#16a34a', marginRight: 2, boxShadow: '0 0 8px #16a34a' }}></span>
              Prices automatically updated daily after 4:00 PM IST
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
        <SummaryCard title="Total Invested" value={fmtCurrency(summary.totalInvested)} icon={<IndianRupee size={16} />} accentColor="var(--color-primary-500)" />
        <SummaryCard title="Current Value" value={fmtCurrency(summary.currentValue)} icon={<BarChart3 size={16} />} accentColor="var(--color-accent-500)" trend={summary.currentValue >= summary.totalInvested ? 'up' : 'down'} />
        <SummaryCard title="Unrealised P&L" value={fmtCurrency(summary.unrealisedPnL)} subtitle={`${summary.unrealisedPnLPct >= 0 ? '+' : ''}${summary.unrealisedPnLPct.toFixed(2)}%`} icon={summary.unrealisedPnL >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />} trend={summary.unrealisedPnL >= 0 ? 'up' : 'down'} accentColor={summary.unrealisedPnL >= 0 ? 'var(--color-success-500)' : 'var(--color-error-500)'} />
        <SummaryCard title="Realised P&L" value={fmtCurrency(summary.realisedPnL)} icon={summary.realisedPnL >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />} trend={summary.realisedPnL >= 0 ? 'up' : summary.realisedPnL < 0 ? 'down' : 'neutral'} accentColor={summary.realisedPnL >= 0 ? 'var(--color-success-500)' : 'var(--color-error-500)'} />
      </div>

      {/* ── Rebalancing Capital Panel ───────────────────────────────────── */}
      {isRebalanceMode && (
        <div className="animate-fade-in" style={{
          marginBottom: 'var(--space-6)',
          background: 'linear-gradient(135deg, rgba(17,17,17,0.95) 0%, rgba(26,22,12,0.95) 100%)',
          border: '1px solid var(--gold-border)',
          borderRadius: 'var(--radius-xl)',
          padding: '24px 28px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Gold accent top bar */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 3,
            background: 'linear-gradient(90deg, transparent, var(--gold), var(--gold-light), var(--gold), transparent)',
            opacity: 0.7,
          }} />
          {/* Subtle glow */}
          <div style={{
            position: 'absolute', top: -40, right: -40, width: 160, height: 160,
            background: 'radial-gradient(circle, rgba(201,168,76,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--gold)',
              }}>
                <Landmark size={16} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0, letterSpacing: '0.3px' }}>
                Rebalancing Capital Overview
              </h3>
            </div>

            <button
              onClick={() => refreshPrices()}
              disabled={refreshing}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: 'rgba(201,168,76,0.1)', border: '1px solid var(--gold-border)',
                color: 'var(--gold)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.2s', opacity: refreshing ? 0.6 : 1
              }}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing...' : 'Refresh Prices'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {/* Total Capital Input */}
            <div style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              padding: '16px 20px',
              transition: 'border-color 0.2s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Total Capital</span>
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--gold)',
                }}>
                  <Wallet size={14} />
                </div>
              </div>
              {editingCapital ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--gold)', fontSize: 22, fontWeight: 800 }}>₹</span>
                  <input
                    type="number"
                    value={totalCapitalInput}
                    onChange={e => setTotalCapitalInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveCapital(); if (e.key === 'Escape') { setEditingCapital(false); setTotalCapitalInput(String(totalCapital)); } }}
                    autoFocus
                    style={{
                      flex: 1, padding: '6px 10px', fontSize: 18, fontWeight: 800,
                      background: 'rgba(201,168,76,0.06)', color: '#ffffff',
                      border: '1px solid var(--gold-border)', borderRadius: 6, outline: 'none',
                      fontFamily: 'var(--font-sans)',
                    }}
                  />
                  <button onClick={saveCapital} disabled={savingCapital} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success-500)', padding: 4 }}><Check size={16} /></button>
                  <button onClick={() => { setEditingCapital(false); setTotalCapitalInput(String(totalCapital)); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error-500)', padding: 4 }}><XIcon size={16} /></button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--gold-light)', letterSpacing: '-0.5px' }}>
                    {totalCapital > 0 ? fmtCurrency(totalCapital) : '₹0.00'}
                  </span>
                  <button
                    onClick={() => { setEditingCapital(true); setTotalCapitalInput(String(totalCapital)); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, opacity: 0.6, display: 'flex', alignItems: 'center' }}
                    title="Edit total capital"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )}
              <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>Click to set the total capital deployed</div>
            </div>

            {/* Total Investment (read-only) */}
            <div style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              padding: '16px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Total Investment</span>
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#3b82f6',
                }}>
                  <IndianRupee size={14} />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.5px' }}>
                {fmtCurrency(summary.totalInvested)}
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>Sum of all invested amounts</div>
            </div>

            {/* Cash Balance (dynamic) */}
            <div style={{
              background: cashBalance >= 0
                ? 'linear-gradient(135deg, rgba(0,0,0,0.4) 0%, rgba(34,197,94,0.04) 100%)'
                : 'linear-gradient(135deg, rgba(0,0,0,0.4) 0%, rgba(239,68,68,0.04) 100%)',
              border: `1px solid ${cashBalance >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}`,
              borderRadius: 12,
              padding: '16px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Cash Balance</span>
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: cashBalance >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${cashBalance >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: cashBalance >= 0 ? 'var(--color-success-500)' : 'var(--color-error-500)',
                }}>
                  {cashBalance >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                </div>
              </div>
              <div style={{
                fontSize: 24, fontWeight: 800,
                color: totalCapital <= 0 ? '#555' : cashBalance >= 0 ? 'var(--color-success-500)' : 'var(--color-error-500)',
                letterSpacing: '-0.5px',
              }}>
                {totalCapital > 0 ? fmtCurrency(cashBalance) : '—'}
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>
                {totalCapital > 0
                  ? `${cashBalance >= 0 ? 'Available' : 'Over-invested by'} ${totalCapital > 0 ? ((Math.abs(cashBalance) / totalCapital) * 100).toFixed(1) + '% of capital' : ''}`
                  : 'Set total capital to calculate'
                }
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Holdings Table */}
      <section style={{ marginBottom: 'var(--space-10)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', margin: 0 }}>
              Holdings &nbsp;
              <span style={{ fontSize: 15, fontWeight: 400, color: '#555555' }}>
                ({holdings.length} positions)
              </span>
            </h2>
            {holdings.some(h => h.last_price_update) && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                Prices last updated: {new Date(Math.max(...holdings.filter(h => h.last_price_update).map(h => new Date(h.last_price_update!).getTime()))).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          
          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              style={{
                padding: '8px 12px', borderRadius: 8, background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
                fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer'
              }}
            >
              <option value="">All Sectors</option>
              {uniqueSectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={mcapFilter}
              onChange={(e) => setMcapFilter(e.target.value)}
              style={{
                padding: '8px 12px', borderRadius: 8, background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
                fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer'
              }}
            >
              <option value="">All M Cap</option>
              {uniqueMCaps.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button
              onClick={() => refreshPrices()}
              disabled={refreshing}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px solid var(--gold-border)',
                color: 'var(--gold)', fontSize: 13, fontWeight: 600,
                cursor: refreshing ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
                opacity: refreshing ? 0.7 : 1,
              }}
              onMouseEnter={e => { if (!refreshing) (e.currentTarget as HTMLElement).style.background = 'rgba(201,168,76,0.1)'; }}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'}
            >
              <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
              {refreshing ? 'Refreshing...' : 'Refresh Prices'}
            </button>
            <button
              onClick={handleDownloadExcel}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'}
            >
              <Download size={15} /> Export
            </button>
            <button
              onClick={() => setShowBuyModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
                background: 'var(--color-primary-600)', border: 'none', color: '#ffffff', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--color-primary-500)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--color-primary-600)'}
            >
              <PlusCircle size={15} /> Add Holding
            </button>
            <button
              onClick={() => setIsRebalanceMode(!isRebalanceMode)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
                background: isRebalanceMode ? '#ffffff' : '#C9A84C', border: 'none', color: '#000000', fontSize: 13, fontWeight: 800,
                cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.2px',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = isRebalanceMode ? '#f0f0f0' : '#DFC06A'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = isRebalanceMode ? '#ffffff' : '#C9A84C'}
            >
              {isRebalanceMode ? 'Done Rebalancing' : 'Rebalance Portfolio'}
            </button>
          </div>
        </div>

        {holdings.length === 0 ? (
          <div style={{ background: 'var(--bg-elevated)', border: '2px dashed var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-12)', textAlign: 'center' }}>
            <BarChart3 size={40} style={{ color: 'var(--text-muted)', margin: '0 auto var(--space-4)', display: 'block', opacity: 0.4 }} />
            <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>No holdings yet</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 8 }}>Upload a broker statement or add holdings manually</p>
          </div>
        ) : (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
            {/* Table Header */}
            <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>#</div>
              <button onClick={() => handleSort('scrip')}
                style={{
                  fontSize: 'var(--text-xs)', color: sortColumn === 'scrip' ? 'var(--color-primary-400)' : 'var(--text-muted)',
                  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none',
                  cursor: 'pointer', padding: 0, textAlign: 'left', transition: 'color 0.15s',
                }}
              >
                Scrip {sortColumn === 'scrip' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
              <button onClick={() => handleSort('sector')}
                style={{
                  fontSize: 'var(--text-xs)', color: sortColumn === 'sector' ? 'var(--color-primary-400)' : 'var(--text-muted)',
                  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none',
                  cursor: 'pointer', padding: 0, textAlign: 'left', transition: 'color 0.15s',
                }}
              >
                Sector {sortColumn === 'sector' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
              <button onClick={() => handleSort('marketCap')}
                style={{
                  fontSize: 'var(--text-xs)', color: sortColumn === 'marketCap' ? 'var(--color-primary-400)' : 'var(--text-muted)',
                  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none',
                  cursor: 'pointer', padding: 0, textAlign: 'left', transition: 'color 0.15s',
                }}
              >
                M Cap {sortColumn === 'marketCap' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
              {['qty:Qty', 'buy_price:Buy Price', 'invested_amount:Invested', 'current_price:Curr Price', 'current_value:Curr Value', 'unrealised_pnl:Unreal P&L', 'unrealised_pnl_pct:P&L %', 'alloc:Alloc %'].map(colStr => {
                const [colKey, colName] = colStr.split(':');
                return (
                  <button key={colKey} onClick={() => handleSort(colKey as SortColumn)}
                    style={{
                      fontSize: 'var(--text-xs)', color: sortColumn === colKey ? 'var(--color-primary-400)' : 'var(--text-muted)',
                      fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none',
                      cursor: 'pointer', padding: 0, textAlign: 'left', transition: 'color 0.15s',
                    }}
                  >
                    {colName} {sortColumn === colKey && (sortOrder === 'asc' ? '↑' : '↓')}
                  </button>
                );
              })}
              {isRebalanceMode && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>Action</span>}
            </div>

            {/* Table Rows */}
            {getSortedHoldings().map((h, i) => {
              const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
              const displayCompanyName = meta.companyName || h.company_name;
              return (
              <div key={h.id} style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-4) var(--space-5)', borderBottom: i < getSortedHoldings().length - 1 ? '1px solid var(--border-subtle)' : 'none', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{i + 1}</div>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--color-primary-400)', fontSize: 'var(--text-sm)', letterSpacing: '0.3px' }}>{cleanSymbol(h)}</div>
                  {displayCompanyName && (
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                      {displayCompanyName}
                    </div>
                  )}
                </div>
                <div style={{ color: 'var(--text-primary)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>{meta.sector}</div>
                <div style={{ color: 'var(--text-primary)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>{meta.marketCap}</div>
                <div style={{ color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>{h.quantity.toLocaleString('en-IN')}</div>
                
                {/* Buy Price with Edit options */}
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {editingBuyPrice === h.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="number" value={editBuyPriceVal} onChange={e => setEditBuyPriceVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveBuyPrice(h.id); if (e.key === 'Escape') { setEditingBuyPrice(null); setEditBuyPriceVal(''); } }} autoFocus style={{ width: 80, padding: '2px 6px', fontSize: 12, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--color-primary-500)', borderRadius: 4, outline: 'none' }} />
                      <button onClick={() => saveBuyPrice(h.id)} disabled={savingBuyPrice} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success-500)', padding: 2 }}><Check size={13} /></button>
                      <button onClick={() => { setEditingBuyPrice(null); setEditBuyPriceVal(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error-500)', padding: 2 }}><XIcon size={13} /></button>
                    </div>
                  ) : (
                    <>
                      {h.buy_price > 0 ? `₹${h.buy_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : <span style={{ color: 'var(--color-accent-400)', fontSize: 11, fontStyle: 'italic' }}>Not set</span>}
                      <button onClick={() => { setEditingBuyPrice(h.id); setEditBuyPriceVal(h.buy_price > 0 ? String(h.buy_price) : ''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, opacity: 0.6, display: 'flex', alignItems: 'center' }} title="Edit buy price"><Pencil size={11} /></button>
                    </>
                  )}
                </div>

                <div style={{ color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{h.buy_price > 0 ? fmtCurrency(h.invested_amount || h.buy_price * h.quantity) : '0'}</div>
                <div style={{ color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>{h.current_price > 0 ? `₹${h.current_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '0'}</div>
                <div style={{ color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{h.current_price > 0 ? fmtCurrency(h.current_value || h.buy_price * h.quantity) : '0'}</div>
                <div style={{ color: h.unrealised_pnl >= 0 ? 'var(--color-success-500)' : 'var(--color-error-500)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{h.current_price > 0 ? `${h.unrealised_pnl >= 0 ? '+' : ''}${fmtCurrency(h.unrealised_pnl)}` : '0'}</div>
                <div>{h.current_price > 0 ? <PnLBadge value={h.unrealised_pnl_pct} suffix="%" /> : <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>0%</span>}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{summary.currentValue > 0 ? (((h.current_value || h.buy_price * h.quantity) / summary.currentValue) * 100).toFixed(1) + '%' : '0%'}</div>
                
                {/* Inline Rebalance Sell Action */}
                {isRebalanceMode && (
                  <div style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => setSellModalData({ holding: h, sellPrice: h.current_price.toString(), quantity: h.quantity.toString() })}
                      style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.1)', color: 'var(--color-error-500)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.2)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)'}
                    >
                      Sell
                    </button>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Transaction Log */}
      <section>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 var(--space-4)' }}>
          Transaction Log &nbsp;
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 400, color: 'var(--text-muted)' }}>({transactions.length} transactions)</span>
        </h2>
        {transactions.length === 0 ? (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            No transactions recorded yet
          </div>
        ) : (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.8fr 1fr 1fr', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
              {['Date', 'Symbol', 'Action', 'Quantity', 'Price', 'Total'].map(col => (
                <span key={col} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{col}</span>
              ))}
            </div>
            {transactions.map((tx, i) => (
              <div key={tx.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.8fr 1fr 1fr', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3) var(--space-5)', borderBottom: i < transactions.length - 1 ? '1px solid var(--border-subtle)' : 'none', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                <div style={{ fontWeight: 600, color: 'var(--color-primary-400)', fontSize: 'var(--text-sm)' }}>{cleanSymbol(tx)}</div>
                <div>
                  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 700, background: tx.action === 'BUY' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: tx.action === 'BUY' ? 'var(--color-success-500)' : 'var(--color-error-500)' }}>
                    {tx.action}
                  </span>
                </div>
                <div style={{ color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}>{tx.quantity.toLocaleString('en-IN')}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>₹{tx.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--text-sm)' }}>{fmtCurrency(tx.total_value)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Modals — rendered via portal to escape CSS transform stacking context ── */}

      {/* Buy Modal */}
      {showBuyModal && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }} onClick={e => { if (e.target === e.currentTarget) setShowBuyModal(false); }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 450, boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.2s ease forwards' }}>
            <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Add New Holding</h2>
              <button onClick={() => setShowBuyModal(false)} style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}><XIcon size={18} /></button>
            </div>
            <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>NSE Symbol *</label>
                <input value={nseSymbol} onChange={e => setNseSymbol(e.target.value.toUpperCase())} placeholder="e.g. RELIANCE" style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 'var(--text-base)', outline: 'none', transition: 'border-color 0.15s' }} onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'} onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>Quantity *</label>
                  <input type="number" value={buyQuantity} onChange={e => setBuyQuantity(e.target.value)} placeholder="0" style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 'var(--text-base)', outline: 'none' }} onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'} onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>Buy Price (₹) *</label>
                  <input type="number" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 'var(--text-base)', outline: 'none' }} onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'} onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'} />
                </div>
              </div>
              {buyPrice && buyQuantity && (
                <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-primary-400)' }}>
                  Invested Amount: ₹{(parseFloat(buyPrice || '0') * parseFloat(buyQuantity || '0')).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              )}
            </div>
            <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowBuyModal(false)} style={{ padding: '9px 20px', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', fontWeight: 500, border: '1px solid var(--border-default)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleBuy} disabled={savingTransaction || !nseSymbol.trim() || !buyPrice || !buyQuantity} style={{ padding: '9px 24px', borderRadius: 'var(--radius-md)', background: 'var(--color-primary-600)', color: 'white', fontSize: 'var(--text-sm)', fontWeight: 600, border: 'none', cursor: savingTransaction || !nseSymbol.trim() || !buyPrice || !buyQuantity ? 'not-allowed' : 'pointer', opacity: (savingTransaction || !nseSymbol.trim() || !buyPrice || !buyQuantity) ? 0.6 : 1 }}>
                {savingTransaction ? 'Adding...' : 'Confirm Buy'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Sell Modal */}
      {sellModalData && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }} onClick={e => { if (e.target === e.currentTarget) setSellModalData(null); }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 400, boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.2s ease forwards' }}>
            <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Sell {cleanSymbol(sellModalData.holding)}</h2>
              <button onClick={() => setSellModalData(null)} style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}><XIcon size={18} /></button>
            </div>
            <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>Selling Price (₹) *</label>
                <input type="number" value={sellModalData.sellPrice} onChange={e => setSellModalData({ ...sellModalData, sellPrice: e.target.value })} placeholder="0.00" style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 'var(--text-base)', outline: 'none' }} onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'} onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>Quantity to Sell *</label>
                <input type="number" value={sellModalData.quantity} onChange={e => setSellModalData({ ...sellModalData, quantity: e.target.value })} placeholder="0" style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 'var(--text-base)', outline: 'none' }} onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--color-primary-500)'} onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'} />
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 6 }}>Available: {sellModalData.holding.quantity.toLocaleString('en-IN')} units</div>
              </div>
              {sellModalData.sellPrice && sellModalData.quantity && (
                <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-primary-400)' }}>
                  Total Value: ₹{(parseFloat(sellModalData.sellPrice || '0') * parseFloat(sellModalData.quantity || '0')).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              )}
            </div>
            <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button onClick={() => setSellModalData(null)} style={{ padding: '9px 20px', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', fontWeight: 500, border: '1px solid var(--border-default)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleConfirmSell} disabled={savingTransaction} style={{ padding: '9px 24px', borderRadius: 'var(--radius-md)', background: 'var(--color-error-600)', color: 'white', fontSize: 'var(--text-sm)', fontWeight: 600, border: 'none', cursor: savingTransaction ? 'not-allowed' : 'pointer', opacity: savingTransaction ? 0.6 : 1 }}>
                {savingTransaction ? 'Selling...' : 'Confirm Sell'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}