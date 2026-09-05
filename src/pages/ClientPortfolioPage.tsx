import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM, { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CircleAlert as AlertCircle, Pencil, Check, X as XIcon,
  Landmark, Download, Upload, PlusCircle, Trash2, Sparkles, Wallet, TrendingUp, FileText
} from 'lucide-react';
import { fetchClient, fetchHoldings, fetchTransactions } from '../lib/queries';
import { doc, getDoc, updateDoc, addDoc, collection, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Client, Holding, Transaction, PortfolioSummary } from '../types';
import { AddClientModal } from '../components/AddClientModal';
import { PnLBadge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { getStockMeta, cleanSymbol } from '../lib/sectorMap';

function fmtCurrency(v: number) {
  return '₹' + Math.round(v || 0).toLocaleString('en-IN');
}

function fmtCurrencyKPI(v: number) {
  return '₹' + Math.round(v || 0).toLocaleString('en-IN');
}

type SortColumn = 'scrip' | 'sector' | 'marketCap' | 'qty' | 'buy_price' | 'current_price' | 'invested_amount' | 'current_value' | 'unrealised_pnl' | 'unrealised_pnl_pct' | 'alloc' | 'source' | null;
type SortOrder = 'asc' | 'desc';
type TxSortColumn = 'date' | 'stock_symbol' | 'action' | 'quantity' | 'price' | 'total_value' | 'status' | null;

// Robust day-level compare: handles YYYY-MM-DD, DD/MM/YYYY, ISO with time
function toDayTs(s: any): number {
  if (!s) return 0;
  const str = String(s);
  const iso = str.split('T')[0] as string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(iso).setHours(0, 0, 0, 0);
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m && m[1] && m[2] && m[3]) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`).setHours(0, 0, 0, 0);
  const d = new Date(str);
  return isNaN(d.getTime()) ? 0 : d.setHours(0, 0, 0, 0);
}

export function ClientPortfolioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 4 Main Tabs ────────────────────────────────────────────────────────────
  // 'client'       -> Layer 1: Client Portfolio (Base / Initial Declared Statement)
  // 'working'      -> Layer 2: Working Portfolio (Live Active Model = Base + Post-Declaration Trades)
  // 'transactions' -> Layer 3: Transactions During Period (Recos & Realised P&L)
  // 'cash'         -> Layer 4: Cash Position & Ledger (Ledger Reconciliation)
  const [portfolioTab, setPortfolioTab] = useState<'client' | 'working' | 'transactions' | 'cash'>('client');

  // Add Stock Modal
  const [showAddStockModal, setShowAddStockModal] = useState(false);
  const [stockSymbolInput, setStockSymbolInput] = useState('');
  const [stockQtyInput, setStockQtyInput] = useState('');
  const [stockPriceInput, setStockPriceInput] = useState('');
  const [savingStock, setSavingStock] = useState(false);

  // Edit Existing Holding Modal (Client Portfolio)
  const [editingHoldingModal, setEditingHoldingModal] = useState<Holding | null>(null);
  const [editModalSymbol, setEditModalSymbol] = useState('');
  const [editModalQty, setEditModalQty] = useState('');
  const [editModalPrice, setEditModalPrice] = useState('');
  const [editModalSource, setEditModalSource] = useState('Existing');
  const [savingEditHolding, setSavingEditHolding] = useState(false);

  // Unified Update Client Portfolio Wizard (Tab 2)
  const [showUpdateWizardModal, setShowUpdateWizardModal] = useState(false);
  const [wizardDate, setWizardDate] = useState(new Date().toISOString().split('T')[0]);
  const [wizardMode, setWizardMode] = useState<'full_upload' | 'add_stock' | 'edit_holding'>('add_stock');
  const [wizardStockSymbol, setWizardStockSymbol] = useState('');
  const [wizardStockQty, setWizardStockQty] = useState('');
  const [wizardStockPrice, setWizardStockPrice] = useState('');
  const [wizardSelectedHoldingId, setWizardSelectedHoldingId] = useState('');
  const [wizardEditQty, setWizardEditQty] = useState('');
  const [wizardEditPrice, setWizardEditPrice] = useState('');
  const [wizardEditSource, setWizardEditSource] = useState('Existing');
  const [savingWizard, setSavingWizard] = useState(false);

  // Delete Holding Confirmation Centered Modal
  const [deleteConfirmHolding, setDeleteConfirmHolding] = useState<{ id: string; symbol: string } | null>(null);
  const [isDeletingHolding, setIsDeletingHolding] = useState(false);

  // Pending Transaction Status Map & Save / Delete Confirmation State
  const [pendingTxStatus, setPendingTxStatus] = useState<Record<string, 'Executed' | 'Avoid'>>({});
  const [savingTxStatusId, setSavingTxStatusId] = useState<string | null>(null);
  const [deleteConfirmTx, setDeleteConfirmTx] = useState<{ id: string; symbol: string } | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);

  // Dedicated Sell Stock Modal (for Working Portfolio & Recos)
  const [sellModalData, setSellModalData] = useState<{
    holdingId?: string | undefined;
    stockSymbol: string;
    companyName: string;
    avgBuyPrice: number;
    currentPrice: number;
    maxQty: number;
  } | null>(null);
  const [sellDateInput, setSellDateInput] = useState(new Date().toISOString().split('T')[0]);
  const [sellPriceInput, setSellPriceInput] = useState('');
  const [sellQtyInput, setSellQtyInput] = useState('');
  const [savingSell, setSavingSell] = useState(false);

  // New Recommendation / Trade Entry Modal (Tab 3)
  const [showNewRecoModal, setShowNewRecoModal] = useState(false);
  const [recoDate, setRecoDate] = useState(new Date().toISOString().split('T')[0]);
  const [recoType, setRecoType] = useState<'BUY' | 'SELL'>('BUY');
  const [recoSymbol, setRecoSymbol] = useState('');
  const [recoPrice, setRecoPrice] = useState('');
  const [recoRangeMin, setRecoRangeMin] = useState('');
  const [recoRangeMax, setRecoRangeMax] = useState('');
  const [recoQty, setRecoQty] = useState('');
  const [recoStatus, setRecoStatus] = useState<'Executed' | 'Avoid'>('Executed');
  const [savingReco, setSavingReco] = useState(false);

  // Upload Statement Modal (Statement Parser)
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Cash Position Modal & Inputs (Tab 4)
  const [showCashUpdateModal, setShowCashUpdateModal] = useState(false);
  const [cashBaseDateInput, setCashBaseDateInput] = useState('');
  const [cashBaseAmountInput, setCashBaseAmountInput] = useState('');
  const [cashParkedLiquidInput, setCashParkedLiquidInput] = useState('');
  const [savingCashBase, setSavingCashBase] = useState(false);

  // Cash Discrepancy Reconciliation Inputs
  const [reportedCashDate, setReportedCashDate] = useState('');
  const [reportedCashAmount, setReportedCashAmount] = useState('');
  const [reconReason, setReconReason] = useState('');
  const [savingReconReason, setSavingReconReason] = useState(false);

  // Strategy Cash Allocation Modal (Cash Position Tab)
  const [showStrategyModal, setShowStrategyModal] = useState(false);
  const [strategyMomentumInput, setStrategyMomentumInput] = useState('');
  const [strategyLongInput, setStrategyLongInput] = useState('');
  const [savingStrategy, setSavingStrategy] = useState(false);


  // ── Total AUA, Billed AUA & Complementary AUA ────────────────────────────
  const [billedAua, setBilledAua] = useState<number>(0);
  const [billedAuaInput, setBilledAuaInput] = useState<string>('');
  const [editingBilledAua, setEditingBilledAua] = useState(false);
  const [savingBilledAua, setSavingBilledAua] = useState(false);

  const [complementaryAua, setComplementaryAua] = useState<number>(0);
  const [compAuaInput, setCompAuaInput] = useState<string>('');
  const [editingCompAua, setEditingCompAua] = useState(false);
  const [savingCompAua, setSavingCompAua] = useState(false);

  const [totalAua, setTotalAua] = useState<number>(0);

  const [mutualFunds, setMutualFunds] = useState<number>(0);
  const [mutualFundsInput, setMutualFundsInput] = useState<string>('');
  const [editingMutualFunds, setEditingMutualFunds] = useState(false);
  const [savingMutualFunds, setSavingMutualFunds] = useState(false);

  // Table Sorting & Filters
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [stockSearch, setStockSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('');
  const [mcapFilter, setMcapFilter] = useState<string>('');

  // Transactions Tab Search and Sort + Sub-tab state (Buy / Sell)
  const [txStockSearch, setTxStockSearch] = useState('');
  const [txSortColumn, setTxSortColumn] = useState<TxSortColumn>('date');
  const [txSortOrder, setTxSortOrder] = useState<SortOrder>('desc');
  const [txSubTab, setTxSubTab] = useState<'buy' | 'sell'>('buy');
  const [txPriceMap, setTxPriceMap] = useState<Record<string, number>>({});

  // Inline table edits
  const [editingBuyPriceId, setEditingBuyPriceId] = useState<string | null>(null);
  const [editBuyPriceVal, setEditBuyPriceVal] = useState('');
  const [savingBuyPrice, setSavingBuyPrice] = useState(false);

  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editQtyVal, setEditQtyVal] = useState('');
  const [savingQty, setSavingQty] = useState(false);

  // ── Load Data ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, h, tx] = await Promise.all([
        fetchClient(id),
        fetchHoldings(id),
        fetchTransactions(id),
      ]);
      setClient(c);
      const bAua = c?.billed_aua !== undefined ? c.billed_aua : (c?.total_aua || c?.total_capital || 0);
      const cAua = c?.complementary_aua !== undefined ? c.complementary_aua : 0;
      const tAua = bAua + cAua;
      setBilledAua(bAua);
      setBilledAuaInput(String(bAua || ''));
      setComplementaryAua(cAua);
      setCompAuaInput(String(cAua || ''));
      setTotalAua(tAua);
      setMutualFunds(c?.asset_mutual_funds || c?.mutual_funds || 0);
      setMutualFundsInput(String(c?.asset_mutual_funds || c?.mutual_funds || ''));

      // Real-time CMP Fallback from price_cache
      const resolvedHoldings = await Promise.all(h.map(async (holding) => {
        if (holding.current_price > 0) return holding;
        const sym = cleanSymbol(holding);
        if (!sym) return holding;
        try {
          const priceSnap = await getDoc(doc(db, 'price_cache', sym));
          if (priceSnap.exists()) {
            const cmp = Number(priceSnap.data()?.close);
            if (cmp > 0) {
              const qty = Number(holding.quantity) || 0;
              const invested = Number(holding.invested_amount) > 0
                ? Number(holding.invested_amount)
                : qty * (Number(holding.buy_price) || 0);
              const currVal = qty * cmp;
              const unrealPnl = currVal - invested;
              const unrealPnlPct = invested > 0 ? (unrealPnl / invested) * 100 : 0;
              return {
                ...holding,
                current_price: cmp,
                current_value: currVal,
                unrealised_pnl: unrealPnl,
                unrealised_pnl_pct: unrealPnlPct,
              };
            }
          }
        } catch { /* non-fatal */ }
        return holding;
      }));

      setHoldings(resolvedHoldings);
      setTransactions(tx);

      // Real-time CMP lookup for transactions
      const txPriceCache: Record<string, number> = {};
      const uniqueTxSymbols = Array.from(new Set(tx.map(t => cleanSymbol(t)).filter(Boolean)));
      await Promise.all(uniqueTxSymbols.map(async (sym) => {
        try {
          const priceSnap = await getDoc(doc(db, 'price_cache', sym));
          if (priceSnap.exists()) {
            const p = Number(priceSnap.data()?.close);
            if (p > 0) txPriceCache[sym] = p;
          }
        } catch { /* non-fatal */ }
      }));
      setTxPriceMap(txPriceCache);

      if (c) {
        setCashBaseDateInput(c.client_cash_base_date || c.onboarding_date || '');
        setCashBaseAmountInput(String(c.client_cash_base_amount !== undefined ? c.client_cash_base_amount : (c.asset_free_cash || 0)));
        setCashParkedLiquidInput(String(c.cash_parked_liquid || 0));
        setReportedCashDate(c.cash_reported_date || '');
        setReportedCashAmount(String(c.cash_reported_amount || ''));
        setReconReason(c.cash_differ_reason || c.cash_difference_reason || '');
      }
    } catch (err) {
      console.warn('Error loading portfolio data:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const onGlobalRefresh = async () => {
      try {
        const fresh = await fetchHoldings(id);
        setHoldings(fresh);
      } catch { /* non-fatal */ }
    };
    window.addEventListener('nw:prices-refreshed', onGlobalRefresh);
    return () => window.removeEventListener('nw:prices-refreshed', onGlobalRefresh);
  }, [id]);

  // ── Separation of Holdings: Client Portfolio (Base) vs Working Portfolio (Dynamic) ──
  const clientHoldings = useMemo(() => {
    return holdings.filter((h: Holding) => h.source === 'Existing' || h.holding_tier === 'client' || (!h.source && !h.holding_tier));
  }, [holdings]);

  const workingHoldings = useMemo(() => {
    // 1. Cutoff: Declaration Date (fallback to Onboarding Date)
    const declarationDate = client?.client_portfolio_date || client?.onboarding_date || '';
    const declarationDayTs = declarationDate ? toDayTs(declarationDate) : 0;

    // 2. Baseline: Seed map from Client Portfolio (Base holdings)
    const map = new Map<string, Holding>();
    clientHoldings.forEach(h => {
      const symKey = cleanSymbol(h).toUpperCase();
      if (!symKey) return;
      const qty = Number(h.quantity) || 0;
      const buyPrice = Number(h.buy_price) || 0;
      const invested = Number(h.invested_amount) > 0 ? Number(h.invested_amount) : qty * buyPrice;
      if (map.has(symKey)) {
        const existing = map.get(symKey)!;
        const combQty = existing.quantity + qty;
        const combInvested = existing.invested_amount + invested;
        const combAvg = combQty > 0 ? combInvested / combQty : existing.buy_price;
        map.set(symKey, {
          ...existing,
          quantity: combQty,
          buy_price: Number(combAvg.toFixed(2)),
          invested_amount: combInvested,
        });
      } else {
        map.set(symKey, {
          ...h,
          quantity: qty,
          buy_price: buyPrice,
          invested_amount: invested,
          holding_tier: 'working',
        });
      }
    });

    // 3. Post-declaration executed transactions sorted chronologically
    const postDeclTx = [...transactions]
      .filter(t => (t.status === 'Executed' || (!t.status && (t as any).status !== 'Avoid')) && toDayTs(t.date) > declarationDayTs)
      .sort((a, b) => toDayTs(a.date) - toDayTs(b.date));

    // 4. Apply transactions sequentially
    postDeclTx.forEach(t => {
      const symKey = cleanSymbol(t).toUpperCase();
      if (!symKey) return;
      const tQty = Number(t.quantity) || 0;
      const tPrice = Number(t.reco_price || t.price) || 0;
      const tVal = Number(t.total_value) || (tQty * tPrice);

      if (t.action === 'BUY' || !t.action) {
        if (map.has(symKey)) {
          const existing = map.get(symKey)!;
          const newQty = existing.quantity + tQty;
          const newInvested = existing.invested_amount + tVal;
          const newAvgBuyPrice = newQty > 0 ? newInvested / newQty : existing.buy_price;
          map.set(symKey, {
            ...existing,
            quantity: newQty,
            invested_amount: Math.round(newInvested),
            buy_price: Number(newAvgBuyPrice.toFixed(2)),
          });
        } else {
          const meta = getStockMeta(symKey, t.company_name || '');
          const newHolding: Holding = {
            id: `dyn-${t.id}`,
            client_id: client?.id || id || '',
            stock_symbol: t.stock_symbol,
            nse_symbol: t.stock_symbol,
            company_name: t.company_name || meta.companyName || symKey,
            quantity: tQty,
            buy_price: tPrice,
            invested_amount: Math.round(tVal),
            current_price: 0,
            current_value: 0,
            unrealised_pnl: 0,
            unrealised_pnl_pct: 0,
            realised_pnl: 0,
            rebalancing_date: null,
            last_price_update: null,
            purchase_date: t.date,
            source: 'Fresh',
            holding_tier: 'working',
            created_at: t.created_at || t.date,
          };
          map.set(symKey, newHolding);
        }
      } else if (t.action === 'SELL') {
        if (map.has(symKey)) {
          const existing = map.get(symKey)!;
          const newQty = Math.max(0, existing.quantity - tQty);
          if (newQty <= 0) {
            map.delete(symKey); // Fully sold position
          } else {
            const newInvested = existing.buy_price * newQty;
            map.set(symKey, {
              ...existing,
              quantity: newQty,
              invested_amount: Math.round(newInvested),
            });
          }
        }
      }
    });

    // 5. Valuation with live CMP
    return Array.from(map.values()).map(h => {
      const sym = cleanSymbol(h);
      const cmp = (txPriceMap[sym] && txPriceMap[sym] > 0) ? txPriceMap[sym] : (h.current_price > 0 ? h.current_price : h.buy_price);
      const qty = h.quantity;
      const invested = h.invested_amount || (h.buy_price * qty);
      const currVal = Math.round(qty * cmp);
      const unrealPnl = Math.round(currVal - invested);
      const unrealPnlPct = invested > 0 ? (unrealPnl / invested) * 100 : 0;
      return {
        ...h,
        current_price: cmp,
        current_value: currVal,
        unrealised_pnl: unrealPnl,
        unrealised_pnl_pct: unrealPnlPct,
        invested_amount: Math.round(invested),
      };
    });
  }, [client, clientHoldings, transactions, txPriceMap, id]);

  const activeTableHoldings = portfolioTab === 'client' ? clientHoldings : workingHoldings;

  // ── Portfolio Summary Metrics ──────────────────────────────────────────────
  const summary: PortfolioSummary = useMemo(() => {
    const res = activeTableHoldings.reduce(
      (acc: PortfolioSummary, h: Holding) => {
        const hasPrice = h.current_price > 0;
        const inv = h.invested_amount || (h.buy_price * h.quantity);
        const val = hasPrice ? (h.current_value || h.buy_price * h.quantity) : inv;
        return {
          totalInvested: acc.totalInvested + inv,
          currentValue: acc.currentValue + val,
          unrealisedPnL: acc.unrealisedPnL + (h.unrealised_pnl || 0),
          realisedPnL: acc.realisedPnL + (h.realised_pnl || 0),
          unrealisedPnLPct: 0,
        };
      },
      { totalInvested: 0, currentValue: 0, unrealisedPnL: 0, realisedPnL: 0, unrealisedPnLPct: 0 }
    );
    if (res.totalInvested > 0) {
      res.unrealisedPnLPct = (res.unrealisedPnL / res.totalInvested) * 100;
    }
    return res;
  }, [activeTableHoldings]);

  // ── Dedicated Working Portfolio Summary (for live overview strip) ───────────
  const workingSummary: PortfolioSummary = useMemo(() => {
    const res = workingHoldings.reduce(
      (acc: PortfolioSummary, h: Holding) => {
        const hasPrice = h.current_price > 0;
        const inv = h.invested_amount || (h.buy_price * h.quantity);
        const val = hasPrice ? (h.current_value || h.buy_price * h.quantity) : inv;
        return {
          totalInvested: acc.totalInvested + inv,
          currentValue: acc.currentValue + val,
          unrealisedPnL: acc.unrealisedPnL + (h.unrealised_pnl || 0),
          realisedPnL: acc.realisedPnL + (h.realised_pnl || 0),
          unrealisedPnLPct: 0,
        };
      },
      { totalInvested: 0, currentValue: 0, unrealisedPnL: 0, realisedPnL: 0, unrealisedPnLPct: 0 }
    );
    if (res.totalInvested > 0) {
      res.unrealisedPnLPct = (res.unrealisedPnL / res.totalInvested) * 100;
    }
    return res;
  }, [workingHoldings]);

  // ── Dedicated Client Portfolio Summary (for tab-dynamic Master Strip) ──────
  const clientSummary: PortfolioSummary = useMemo(() => {
    const res = clientHoldings.reduce(
      (acc: PortfolioSummary, h: Holding) => {
        const hasPrice = h.current_price > 0;
        const inv = h.invested_amount || (h.buy_price * h.quantity);
        const val = hasPrice ? (h.current_value || h.buy_price * h.quantity) : inv;
        return {
          totalInvested: acc.totalInvested + inv,
          currentValue: acc.currentValue + val,
          unrealisedPnL: acc.unrealisedPnL + (h.unrealised_pnl || 0),
          realisedPnL: acc.realisedPnL + (h.realised_pnl || 0),
          unrealisedPnLPct: 0,
        };
      },
      { totalInvested: 0, currentValue: 0, unrealisedPnL: 0, realisedPnL: 0, unrealisedPnLPct: 0 }
    );
    if (res.totalInvested > 0) {
      res.unrealisedPnLPct = (res.unrealisedPnL / res.totalInvested) * 100;
    }
    return res;
  }, [clientHoldings]);

  // Tab-dynamic strip summary: Working vs Client
  const stripSummary = portfolioTab === 'client' ? clientSummary : workingSummary;

  // ── Transactions Metrics & Classification (ALL transactions — display & realised P&L के लिए) ──
  const executedBuys = useMemo(() => {
    return transactions.filter(t => t.action === 'BUY' && (t.status === 'Executed' || !t.status));
  }, [transactions]);

  const freshBuysTotal = useMemo(() => {
    return executedBuys.reduce((sum, t) => sum + (t.total_value || (t.price * t.quantity)), 0);
  }, [executedBuys]);
  void freshBuysTotal;

  const executedSells = useMemo(() => {
    return transactions.filter(t => t.action === 'SELL' && (t.status === 'Executed' || !t.status));
  }, [transactions]);

  const freshSellsTotal = useMemo(() => {
    return executedSells.reduce((sum, t) => sum + (t.total_value || (t.price * t.quantity)), 0);
  }, [executedSells]);

  const totalRealisedPnL = useMemo(() => {
    return executedSells.reduce((sum, t) => sum + (t.realised_pnl || 0), 0);
  }, [executedSells]);

  // ── Transactions Buy Orders Summary (cost basis, live current value & unrealised P&L) ──
  const txBuySummary = useMemo(() => {
    // FIFO allocation of sold qty per buy recommendation (per symbol, by buy date)
    const sellsBySymbol = new Map<string, number>();
    executedSells.forEach(s => {
      const k = cleanSymbol(s).toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
      sellsBySymbol.set(k, (sellsBySymbol.get(k) || 0) + (Number(s.quantity) || 0));
    });
    const buysOrdered = [...executedBuys].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const remainingSells = new Map(sellsBySymbol);

    let invested = 0;
    let currentVal = 0;

    buysOrdered.forEach(t => {
      const k = cleanSymbol(t).toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
      const remSold = remainingSells.get(k) || 0;
      const totalQty = Number(t.quantity) || 0;
      const soldQty = Math.min(totalQty, Math.max(0, remSold));
      remainingSells.set(k, Math.max(0, remSold - soldQty));

      const openQty = Math.max(0, totalQty - soldQty);
      if (openQty <= 0) return; // Fully exited

      const buyPrice = Number(t.reco_price || t.price) || 0;
      const openInvested = buyPrice * openQty;
      const sym = cleanSymbol(t);
      const cmp = txPriceMap[sym] || buyPrice;
      const openVal = (cmp > 0 ? cmp : buyPrice) * openQty;

      invested += openInvested;
      currentVal += openVal;
    });

    const unrealisedPnL = currentVal - invested;
    const unrealisedPnLPct = invested > 0 ? (unrealisedPnL / invested) * 100 : 0;
    return {
      invested,
      currentValue: currentVal,
      unrealisedPnL,
      unrealisedPnLPct,
    };
  }, [executedBuys, executedSells, txPriceMap]);

  // ── Liquid Fund / Liquid BeES Holdings ─────────────────────────────────────
  const liquidHoldings = useMemo(() => {
    return holdings.filter((h: Holding) => {
      const sym = cleanSymbol(h).toUpperCase();
      const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
      return sym.includes('LIQUID') || sym.includes('LIQ') || meta.sector === 'Liquid Funds / Debt' || meta.sector === 'Debt';
    });
  }, [holdings]);

  const liquidEtfTotalValue = useMemo(() => {
    return liquidHoldings.reduce((sum: number, h: Holding) => sum + (h.current_value || h.buy_price * h.quantity), 0);
  }, [liquidHoldings]);

  // ── Dynamic Cash Position Ledger ──────────────────────────────────────────

  // Base Cash Date — यह dynamic cutoff है।
  // कोई backdated date सेट करे तो नीचे के सभी useMemo auto-recompute करेंगे।
  const cashBaseDate = client?.client_cash_base_date || '';
  const baseDayTs = useMemo(() => (cashBaseDate ? toDayTs(cashBaseDate) : 0), [cashBaseDate]);

  // ── STEP 2 Inputs: Post-Base-Date Transactions (Dynamic Flow) ─────────────
  // सिर्फ वो transactions जो client_cash_base_date के STRICTLY बाद की हैं।
  // अगर base date बदली (backdated/future), तो ये automatically उस date के बाद की transactions pick करेंगे।
  const postBaseDateBuys = useMemo(() => {
    return transactions.filter(t =>
      t.action === 'BUY' &&
      (t.status === 'Executed' || !t.status) &&
      (!cashBaseDate || toDayTs(t.date) > baseDayTs)
    );
  }, [transactions, cashBaseDate, baseDayTs]);

  const postBaseDateSells = useMemo(() => {
    return transactions.filter(t =>
      t.action === 'SELL' &&
      (t.status === 'Executed' || !t.status) &&
      (!cashBaseDate || toDayTs(t.date) > baseDayTs)
    );
  }, [transactions, cashBaseDate, baseDayTs]);

  const newBuysTotal = useMemo(() => {
    return postBaseDateBuys.reduce((sum, t) => sum + (t.total_value || (t.price * t.quantity)), 0);
  }, [postBaseDateBuys]);

  const newSellsTotal = useMemo(() => {
    return postBaseDateSells.reduce((sum, t) => sum + (t.total_value || (t.price * t.quantity)), 0);
  }, [postBaseDateSells]);

  // ── STEP 1: Opening Liquidity (As on Base Date) ────────────────────────────
  // Base Cash = क्लाइंट का शुद्ध नकद (fresh cash brought in)
  // Parked Liquid = Liquid ETF / Liquid Funds में रखा हुआ amount
  const baseCash = client?.client_cash_base_amount !== undefined && client.client_cash_base_amount !== null
    ? client.client_cash_base_amount
    : (client?.asset_free_cash || 0);

  const parkedLiquid = client?.cash_parked_liquid !== undefined && client.cash_parked_liquid !== null
    ? client.cash_parked_liquid
    : liquidEtfTotalValue;

  const totalOpening = baseCash + parkedLiquid;

  // ── STEP 2: Free Cash / Live Liquidity ─────────────────────────────────────
  // Formula: Total Opening − New Buys (post-date only) + New Sells (post-date only)
  const projectedCash = Math.round(totalOpening - newBuysTotal + newSellsTotal);

  // ── Momentum Cash & Long-Term Cash (Rule 3: Isolated from Base Cash) ───────
  const momentumCash = client?.client_momentum_cash !== undefined ? client.client_momentum_cash : 0;
  const longTermCash = client?.client_long_cash !== undefined ? client.client_long_cash : projectedCash;

  const totalEquityValue = workingSummary.currentValue > 0 ? workingSummary.currentValue : workingSummary.totalInvested;
  const totalPortfolioValue = totalEquityValue + mutualFunds + projectedCash;
  const freeCashRatio = totalPortfolioValue > 0 ? (projectedCash / totalPortfolioValue) * 100 : 0;

  // ── Buffer Capital (Rule 2: Buffer Capital = Total AUA − (Working Portfolio Current Value + Free Cash)) ──
  const bufferCapital = Math.round(totalAua - (workingSummary.currentValue + projectedCash));
  const isAuaBreached = totalAua > 0 && bufferCapital < 0;
  const auaBreachAmount = Math.max(0, -bufferCapital);
  void isAuaBreached; void auaBreachAmount;

  const reportedCashNum = parseFloat(reportedCashAmount) || 0;
  const differEstimate = reportedCashAmount.trim() !== '' ? projectedCash - reportedCashNum : 0;

  const uniqueSectors = Array.from(new Set(activeTableHoldings.map(h => getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '').sector))).filter(Boolean).sort();
  const uniqueMCaps = Array.from(new Set(activeTableHoldings.map(h => getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '').marketCap))).filter(Boolean).sort();

  // ── Sorting Logic ──────────────────────────────────────────────────────────
  const getSortedHoldings = () => {
    let list = [...activeTableHoldings];
    if (stockSearch.trim()) {
      const q = stockSearch.toLowerCase();
      list = list.filter(h =>
        (h.stock_symbol && h.stock_symbol.toLowerCase().includes(q)) ||
        (h.nse_symbol && h.nse_symbol.toLowerCase().includes(q)) ||
        (h.company_name && h.company_name.toLowerCase().includes(q))
      );
    }
    if (sectorFilter) {
      list = list.filter(h => getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '').sector === sectorFilter);
    }
    if (mcapFilter) {
      list = list.filter(h => getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '').marketCap === mcapFilter);
    }
    if (!sortColumn) return list;

    return list.sort((a, b) => {
      let aVal: any = 0;
      let bVal: any = 0;
      if (sortColumn === 'scrip') {
        aVal = cleanSymbol(a);
        bVal = cleanSymbol(b);
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (sortColumn === 'sector') {
        aVal = getStockMeta(a.nse_symbol || a.stock_symbol || '', a.company_name || '').sector;
        bVal = getStockMeta(b.nse_symbol || b.stock_symbol || '', b.company_name || '').sector;
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (sortColumn === 'qty') { aVal = a.quantity; bVal = b.quantity; }
      if (sortColumn === 'buy_price') { aVal = a.buy_price; bVal = b.buy_price; }
      if (sortColumn === 'current_price') { aVal = a.current_price; bVal = b.current_price; }
      if (sortColumn === 'invested_amount') { aVal = a.invested_amount || (a.buy_price * a.quantity); bVal = b.invested_amount || (b.buy_price * b.quantity); }
      if (sortColumn === 'current_value') { aVal = a.current_value || (a.buy_price * a.quantity); bVal = b.current_value || (b.buy_price * b.quantity); }
      if (sortColumn === 'unrealised_pnl') { aVal = a.unrealised_pnl; bVal = b.unrealised_pnl; }
      if (sortColumn === 'unrealised_pnl_pct') { aVal = a.unrealised_pnl_pct; bVal = b.unrealised_pnl_pct; }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
  };

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortOrder('asc');
    }
  };

  const getSortedBuyTransactions = () => {
    let list = transactions.filter(t => t.action === 'BUY' || !t.action);
    if (txStockSearch.trim()) {
      const q = txStockSearch.toLowerCase();
      list = list.filter(t =>
        (t.stock_symbol && t.stock_symbol.toLowerCase().includes(q)) ||
        (t.company_name && t.company_name.toLowerCase().includes(q))
      );
    }
    if (!txSortColumn) return list;

    return list.sort((a, b) => {
      const aVal = a[txSortColumn];
      const bVal = b[txSortColumn];
      if (txSortColumn === 'date' || txSortColumn === 'stock_symbol' || txSortColumn === 'action' || txSortColumn === 'status') {
        return txSortOrder === 'asc' ? String(aVal ?? '').localeCompare(String(bVal ?? '')) : String(bVal ?? '').localeCompare(String(aVal ?? ''));
      }
      return txSortOrder === 'asc' ? (Number(aVal) || 0) - (Number(bVal) || 0) : (Number(bVal) || 0) - (Number(aVal) || 0);
    });
  };

  const getSortedSellTransactions = () => {
    let list = transactions.filter(t => t.action === 'SELL');
    if (txStockSearch.trim()) {
      const q = txStockSearch.toLowerCase();
      list = list.filter(t =>
        (t.stock_symbol && t.stock_symbol.toLowerCase().includes(q)) ||
        (t.company_name && t.company_name.toLowerCase().includes(q))
      );
    }
    if (!txSortColumn) return list;

    return list.sort((a, b) => {
      const aVal = a[txSortColumn];
      const bVal = b[txSortColumn];
      if (txSortColumn === 'date' || txSortColumn === 'stock_symbol' || txSortColumn === 'action' || txSortColumn === 'status') {
        return txSortOrder === 'asc' ? String(aVal ?? '').localeCompare(String(bVal ?? '')) : String(bVal ?? '').localeCompare(String(aVal ?? ''));
      }
      return txSortOrder === 'asc' ? (Number(aVal) || 0) - (Number(bVal) || 0) : (Number(bVal) || 0) - (Number(aVal) || 0);
    });
  };

  const handleTxSort = (col: TxSortColumn) => {
    if (txSortColumn === col) {
      setTxSortOrder(txSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setTxSortColumn(col);
      setTxSortOrder('asc');
    }
  };

  // ── Master Strip Save: Billed & Complementary AUA ─────────────────────────
  const saveBilledAua = async () => {
    if (!id) return;
    const val = Math.max(0, parseFloat(billedAuaInput) || 0);
    setSavingBilledAua(true);
    try {
      const newTotal = val + complementaryAua;
      await updateDoc(doc(db, 'clients', id), {
        billed_aua: val,
        total_aua: newTotal,
        total_capital: newTotal,
      });
      setBilledAua(val);
      setTotalAua(newTotal);
      setEditingBilledAua(false);
      setClient(prev => prev ? { ...prev, billed_aua: val, total_aua: newTotal, total_capital: newTotal } : null);
    } catch (err) {
      console.error('Error saving Billed AUA:', err);
      alert('Failed to save Billed AUA');
    } finally {
      setSavingBilledAua(false);
    }
  };

  const saveCompAua = async () => {
    if (!id) return;
    const val = Math.max(0, parseFloat(compAuaInput) || 0);
    setSavingCompAua(true);
    try {
      const newTotal = billedAua + val;
      await updateDoc(doc(db, 'clients', id), {
        complementary_aua: val,
        total_aua: newTotal,
        total_capital: newTotal,
      });
      setComplementaryAua(val);
      setTotalAua(newTotal);
      setEditingCompAua(false);
      setClient(prev => prev ? { ...prev, complementary_aua: val, total_aua: newTotal, total_capital: newTotal } : null);
    } catch (err) {
      console.error('Error saving Complementary AUA:', err);
      alert('Failed to save Complementary AUA');
    } finally {
      setSavingCompAua(false);
    }
  };

  const saveMutualFunds = async () => {
    if (!id) return;
    const val = parseFloat(mutualFundsInput);
    if (isNaN(val) || val < 0) {
      alert('Please enter a valid Mutual Funds amount');
      return;
    }
    setSavingMutualFunds(true);
    try {
      await updateDoc(doc(db, 'clients', id), {
        asset_mutual_funds: val,
        mutual_funds: val,
      });
      setMutualFunds(val);
      setEditingMutualFunds(false);
    } catch (err) {
      console.error('Error saving mutual funds:', err);
      alert('Failed to save mutual funds');
    } finally {
      setSavingMutualFunds(false);
    }
  };

  // ── Cash Position Save & Audit ────────────────────────────────────────────
  const saveCashBaseSettings = async () => {
    if (!id) return;
    const amt = parseFloat(cashBaseAmountInput) || 0;
    const liquidAmt = parseFloat(cashParkedLiquidInput) || 0;
    const baseDateVal = cashBaseDateInput || new Date().toISOString().split('T')[0];
    setSavingCashBase(true);
    try {
      const newBaseTs = toDayTs(baseDateVal);
      const buyAmt = transactions
        .filter(t => t.action === 'BUY' && (t.status === 'Executed' || !t.status) && toDayTs(t.date) > newBaseTs)
        .reduce((s, t) => s + (t.total_value || (t.price * t.quantity)), 0);
      const sellAmt = transactions
        .filter(t => t.action === 'SELL' && (t.status === 'Executed' || !t.status) && toDayTs(t.date) > newBaseTs)
        .reduce((s, t) => s + (t.total_value || (t.price * t.quantity)), 0);
      const projectedAtEntry = Math.round((amt + liquidAmt) - buyAmt + sellAmt);
      const newEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        base_date: baseDateVal,
        cash: amt,
        liquid: liquidAmt,
        total: amt + liquidAmt,
        buy_amount: Math.round(buyAmt),
        sell_amount: Math.round(sellAmt),
        projected: projectedAtEntry,
        created_at: new Date().toISOString(),
      };
      const prevHistory = (client as any)?.cash_history || [];
      await updateDoc(doc(db, 'clients', id), {
        client_cash_base_date: baseDateVal,
        client_cash_base_amount: amt,
        cash_parked_liquid: liquidAmt,
        asset_free_cash: amt,
        cash_history: [...prevHistory, newEntry],
      });
      setShowCashUpdateModal(false);
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to update cash position');
    } finally {
      setSavingCashBase(false);
    }
  };

  const openStrategyModal = () => {
    setStrategyMomentumInput(String(momentumCash));
    setStrategyLongInput(String(longTermCash));
    setShowStrategyModal(true);
  };

  const handleSaveStrategyAllocation = async () => {
    if (!id) return;
    const momNum = Math.max(0, parseFloat(strategyMomentumInput) || 0);
    const longNum = Math.max(0, parseFloat(strategyLongInput) || 0);
    setSavingStrategy(true);
    try {
      await updateDoc(doc(db, 'clients', id), {
        client_momentum_cash: momNum,
        client_long_cash: longNum,
        updated_at: new Date().toISOString(),
      });
      setShowStrategyModal(false);
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to save strategy allocation');
    } finally {
      setSavingStrategy(false);
    }
  };

    const saveAuditReconciliation = async () => {
    if (!id) return;
    setSavingReconReason(true);
    try {
      await updateDoc(doc(db, 'clients', id), {
        cash_reported_date: reportedCashDate,
        cash_reported_amount: parseFloat(reportedCashAmount) || 0,
        cash_differ_reason: reconReason,
        cash_difference_reason: reconReason,
      });
      alert('Cash discrepancy reconciliation audit log saved successfully.');
    } catch (err) {
      console.error(err);
      alert('Failed to save reconciliation audit');
    } finally {
      setSavingReconReason(false);
    }
  };

  // ── Add Stock (Client or Working) ─────────────────────────────────────────
  const handleAddStock = async () => {
    if (!stockSymbolInput.trim() || !stockQtyInput || !stockPriceInput || !id) {
      alert('Please fill symbol, quantity, and price');
      return;
    }
    setSavingStock(true);
    try {
      const qty = parseFloat(stockQtyInput);
      const price = parseFloat(stockPriceInput);
      const cleanSym = stockSymbolInput.trim().toUpperCase();
      const meta = getStockMeta(cleanSym);
      const company_name = meta.companyName || cleanSym;
      const nowIso = new Date().toISOString();

      let currPrice = price;
      try {
        const priceSnap = await getDoc(doc(db, 'price_cache', cleanSym));
        if (priceSnap.exists()) {
          const p = Number(priceSnap.data()?.close);
          if (p > 0) currPrice = p;
        }
      } catch { /* non-fatal */ }

      const invested = qty * price;
      const currVal = currPrice > 0 ? qty * currPrice : invested;
      const unrealPnl = currVal - invested;
      const unrealPnlPct = invested > 0 ? (unrealPnl / invested) * 100 : 0;

      await addDoc(collection(db, 'holdings'), {
        client_id: id,
        stock_symbol: cleanSym,
        nse_symbol: cleanSym,
        company_name,
        buy_price: price,
        quantity: qty,
        invested_amount: invested,
        current_price: currPrice,
        current_value: currVal,
        unrealised_pnl: unrealPnl,
        unrealised_pnl_pct: unrealPnlPct,
        realised_pnl: 0,
        source: 'Existing',
        holding_tier: 'client',
        created_at: nowIso,
      });

      setShowAddStockModal(false);
      setStockSymbolInput('');
      setStockQtyInput('');
      setStockPriceInput('');
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to add stock holding');
    } finally {
      setSavingStock(false);
    }
  };

  // ── Unified Update Client Portfolio Wizard Handlers ───────────────────────
  const openUpdateWizard = () => {
    const defaultDate = client?.client_portfolio_date || client?.onboarding_date || new Date().toISOString().split('T')[0];
    setWizardDate(defaultDate);
    setWizardMode('add_stock');
    setWizardStockSymbol('');
    setWizardStockQty('');
    setWizardStockPrice('');
    if (clientHoldings.length > 0 && clientHoldings[0]) {
      const first = clientHoldings[0];
      setWizardSelectedHoldingId(first.id);
      setWizardEditQty(String(first.quantity));
      setWizardEditPrice(String(first.buy_price));
      setWizardEditSource(first.source || 'Existing');
    } else {
      setWizardSelectedHoldingId('');
      setWizardEditQty('');
      setWizardEditPrice('');
    }
    setShowUpdateWizardModal(true);
  };

  const handleWizardSelectHolding = (holdingId: string) => {
    setWizardSelectedHoldingId(holdingId);
    const h = clientHoldings.find(item => item.id === holdingId);
    if (h) {
      setWizardEditQty(String(h.quantity));
      setWizardEditPrice(String(h.buy_price));
      setWizardEditSource(h.source || 'Existing');
    }
  };

  const handleSaveWizardAddStock = async () => {
    if (!id || !wizardStockSymbol.trim() || !wizardStockQty || !wizardStockPrice) {
      alert('Please fill Stock Symbol, Quantity, and Buy Price');
      return;
    }
    const qty = parseFloat(wizardStockQty);
    const price = parseFloat(wizardStockPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
      alert('Please enter valid quantity and price');
      return;
    }
    setSavingWizard(true);
    try {
      const cleanSym = wizardStockSymbol.trim().toUpperCase();
      const meta = getStockMeta(cleanSym);
      const invested = qty * price;
      let currPrice = price;
      try {
        const priceSnap = await getDoc(doc(db, 'price_cache', cleanSym));
        if (priceSnap.exists()) {
          const p = Number(priceSnap.data()?.close);
          if (p > 0) currPrice = p;
        }
      } catch { /* non-fatal */ }

      const currVal = qty * currPrice;
      const unrealPnl = currVal - invested;
      const unrealPnlPct = invested > 0 ? (unrealPnl / invested) * 100 : 0;
      const nowIso = new Date().toISOString();

      await addDoc(collection(db, 'holdings'), {
        client_id: id,
        stock_symbol: cleanSym,
        nse_symbol: cleanSym,
        company_name: meta.companyName || cleanSym,
        sector: meta.sector || 'Diversified',
        market_cap_category: meta.marketCap ? `${meta.marketCap} Cap` : 'Mid Cap',
        buy_price: price,
        quantity: qty,
        invested_amount: invested,
        current_price: currPrice,
        current_value: currVal,
        unrealised_pnl: unrealPnl,
        unrealised_pnl_pct: unrealPnlPct,
        realised_pnl: 0,
        source: 'Existing',
        holding_tier: 'client',
        purchase_date: wizardDate,
        created_at: nowIso,
      });

      // Update client statement date
      await updateDoc(doc(db, 'clients', id), {
        client_portfolio_date: wizardDate,
        updated_at: nowIso,
      });

      setShowUpdateWizardModal(false);
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to add stock');
    } finally {
      setSavingWizard(false);
    }
  };

  const handleSaveWizardEditHolding = async () => {
    if (!id || !wizardSelectedHoldingId) {
      alert('Please select a holding to edit');
      return;
    }
    const qty = parseFloat(wizardEditQty);
    const price = parseFloat(wizardEditPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
      alert('Please enter valid quantity and price');
      return;
    }
    setSavingWizard(true);
    try {
      const holding = clientHoldings.find(h => h.id === wizardSelectedHoldingId);
      if (!holding) throw new Error('Holding not found');

      const inv = qty * price;
      const currPrice = holding.current_price > 0 ? holding.current_price : price;
      const currVal = qty * currPrice;
      const unrealPnl = currVal - inv;
      const unrealPnlPct = inv > 0 ? (unrealPnl / inv) * 100 : 0;
      const nowIso = new Date().toISOString();

      await updateDoc(doc(db, 'holdings', holding.id), {
        quantity: qty,
        buy_price: price,
        invested_amount: inv,
        current_value: currVal,
        unrealised_pnl: unrealPnl,
        unrealised_pnl_pct: unrealPnlPct,
        source: wizardEditSource || 'Existing',
        purchase_date: wizardDate,
        updated_at: nowIso,
      });

      await updateDoc(doc(db, 'clients', id), {
        client_portfolio_date: wizardDate,
        updated_at: nowIso,
      });

      setShowUpdateWizardModal(false);
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to update holding');
    } finally {
      setSavingWizard(false);
    }
  };

  const handleSaveWizardDeleteHolding = async () => {
    if (!id || !wizardSelectedHoldingId) return;
    const holding = clientHoldings.find(h => h.id === wizardSelectedHoldingId);
    if (!holding) return;
    
    setShowUpdateWizardModal(false);
    setDeleteConfirmHolding({
      id: holding.id,
      symbol: cleanSymbol(holding) || 'this holding',
    });
  };

    const handleSaveEditHolding = async () => {
    if (!editingHoldingModal || !id) return;
    const qty = parseFloat(editModalQty);
    const price = parseFloat(editModalPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
      alert('Please enter valid quantity and buy price');
      return;
    }
    setSavingEditHolding(true);
    try {
      const inv = qty * price;
      const currPrice = editingHoldingModal.current_price > 0 ? editingHoldingModal.current_price : price;
      const currVal = qty * currPrice;
      const unrealPnl = currVal - inv;
      const unrealPnlPct = inv > 0 ? (unrealPnl / inv) * 100 : 0;
      const cleanSym = (editModalSymbol || editingHoldingModal.stock_symbol).trim().toUpperCase();
      const meta = getStockMeta(cleanSym);

      await updateDoc(doc(db, 'holdings', editingHoldingModal.id), {
        stock_symbol: cleanSym,
        nse_symbol: cleanSym,
        company_name: meta.companyName || cleanSym,
        quantity: qty,
        buy_price: price,
        invested_amount: inv,
        current_value: currVal,
        unrealised_pnl: unrealPnl,
        unrealised_pnl_pct: unrealPnlPct,
        source: editModalSource || 'Existing',
        updated_at: new Date().toISOString(),
      });

      setEditingHoldingModal(null);
      await load();
    } catch (err) {
      console.error('Error updating holding:', err);
      alert('Failed to update holding');
    } finally {
      setSavingEditHolding(false);
    }
  };

  // ── Open Sell Modal Helpers ───────────────────────────────────────────────
  const openSellModalForTx = (tx: Transaction) => {
    const cleanSym = cleanSymbol(tx);
    const meta = getStockMeta(cleanSym, tx.company_name || '');
    const normClean = cleanSym.replace(/\.NS$/, '').replace(/\.BO$/, '');
    const holding = holdings.find(h => {
      const hSym = (h.nse_symbol || h.stock_symbol || '').trim().toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
      return hSym === normClean;
    });

    const avgBuyPrice = holding ? holding.buy_price : (tx.reco_price || tx.price || 0);
    const currPrice = holding && holding.current_price > 0 ? holding.current_price : avgBuyPrice;
    const maxQty = holding ? holding.quantity : tx.quantity;

    setSellModalData({
      holdingId: holding?.id,
      stockSymbol: cleanSym,
      companyName: meta.companyName || tx.company_name || cleanSym,
      avgBuyPrice,
      currentPrice: currPrice,
      maxQty,
    });
    setSellDateInput(new Date().toISOString().split('T')[0]);
    setSellPriceInput(String(currPrice));
    setSellQtyInput(String(maxQty));
  };

  const handleConfirmSell = async () => {
    if (!sellModalData || !sellPriceInput || !sellQtyInput || !id) {
      alert('Please fill Sell Price and Quantity');
      return;
    }
    const sellPrice = parseFloat(sellPriceInput);
    const sellQty = parseFloat(sellQtyInput);
    if (isNaN(sellPrice) || sellPrice <= 0 || isNaN(sellQty) || sellQty <= 0) {
      alert('Please enter valid sell price and quantity');
      return;
    }
    if (sellQty > sellModalData.maxQty) {
      alert(`Quantity to sell (${sellQty}) cannot exceed current holding quantity (${sellModalData.maxQty})`);
      return;
    }

    setSavingSell(true);
    try {
      const buyPrice = sellModalData.avgBuyPrice;
      const investedSold = buyPrice * sellQty;
      const totalVal = sellPrice * sellQty;
      const pnl = totalVal - investedSold;
      const nowIso = new Date().toISOString();
      const cleanSym = sellModalData.stockSymbol;

      // 1. Add Executed SELL record to transactions
      await addDoc(collection(db, 'transactions'), {
        client_id: id,
        date: sellDateInput || nowIso.split('T')[0],
        action: 'SELL',
        stock_symbol: cleanSym,
        company_name: sellModalData.companyName,
        quantity: sellQty,
        price: sellPrice,
        buy_price: buyPrice,
        sell_price: sellPrice,
        total_value: totalVal,
        realised_pnl: pnl,
        status: 'Executed',
        call_status: 'Closed',
        created_at: nowIso,
      });

      // 2. Reduce or Delete holding
      if (sellModalData.holdingId) {
        const existing = holdings.find(h => h.id === sellModalData.holdingId);
        if (existing) {
          const remQty = Math.max(0, existing.quantity - sellQty);
          if (remQty > 0) {
            const newInv = buyPrice * remQty;
            const currPrice = existing.current_price > 0 ? existing.current_price : buyPrice;
            const currVal = remQty * currPrice;
            const unrealPnl = currVal - newInv;
            const unrealPnlPct = newInv > 0 ? (unrealPnl / newInv) * 100 : 0;
            await updateDoc(doc(db, 'holdings', existing.id), {
              quantity: remQty,
              invested_amount: newInv,
              current_value: currVal,
              unrealised_pnl: unrealPnl,
              unrealised_pnl_pct: unrealPnlPct,
              realised_pnl: (existing.realised_pnl || 0) + pnl,
              updated_at: nowIso,
            });
          } else {
            await deleteDoc(doc(db, 'holdings', existing.id));
          }
        }
      } else {
        const normClean = cleanSym.replace(/\.NS$/, '').replace(/\.BO$/, '');
        const existing = holdings.find(h => {
          const hSym = (h.nse_symbol || h.stock_symbol || '').trim().toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
          return hSym === normClean;
        });
        if (existing) {
          const remQty = Math.max(0, existing.quantity - sellQty);
          if (remQty > 0) {
            const newInv = buyPrice * remQty;
            const currPrice = existing.current_price > 0 ? existing.current_price : buyPrice;
            const currVal = remQty * currPrice;
            const unrealPnl = currVal - newInv;
            const unrealPnlPct = newInv > 0 ? (unrealPnl / newInv) * 100 : 0;
            await updateDoc(doc(db, 'holdings', existing.id), {
              quantity: remQty,
              invested_amount: newInv,
              current_value: currVal,
              unrealised_pnl: unrealPnl,
              unrealised_pnl_pct: unrealPnlPct,
              realised_pnl: (existing.realised_pnl || 0) + pnl,
              updated_at: nowIso,
            });
          } else {
            await deleteDoc(doc(db, 'holdings', existing.id));
          }
        }
      }

      setSellModalData(null);
      setSellPriceInput('');
      setSellQtyInput('');
      await load();
    } catch (err) {
      console.error('Error confirming sell:', err);
      alert('Failed to execute sell order');
    } finally {
      setSavingSell(false);
    }
  };

  // ── New Recommendation & Status Toggle (Tab 3) ────────────────────────────
  const handleSaveRecommendation = async () => {
    if (!recoSymbol.trim() || !recoPrice || !recoQty || !id) {
      alert('Please fill Symbol, Reco Price, and Quantity');
      return;
    }
    setSavingReco(true);
    try {
      const qty = parseFloat(recoQty);
      const price = parseFloat(recoPrice);
      const cleanSym = recoSymbol.trim().toUpperCase();
      const meta = getStockMeta(cleanSym);
      const company_name = meta.companyName || cleanSym;
      const totalVal = qty * price;
      const nowIso = new Date().toISOString();

      const priceRangeStr = recoRangeMin && recoRangeMax
        ? '₹' + parseFloat(recoRangeMin).toLocaleString('en-IN') + ' - ₹' + parseFloat(recoRangeMax).toLocaleString('en-IN')
        : null;

      const txRef = await addDoc(collection(db, 'transactions'), {
        client_id: id,
        date: recoDate || nowIso.split('T')[0],
        action: recoType,
        stock_symbol: cleanSym,
        company_name,
        quantity: qty,
        price,
        reco_price: price,
        price_range: priceRangeStr,
        price_range_min: parseFloat(recoRangeMin) || 0,
        price_range_max: parseFloat(recoRangeMax) || 0,
        total_value: totalVal,
        status: recoStatus,
        call_status: 'Open',
        created_at: nowIso,
      });

      if (recoStatus === 'Executed') {
        if (recoType === 'BUY') {
          const normClean = cleanSym.replace(/\.NS$/, '').replace(/\.BO$/, '');
          const existing = holdings.find(h => {
            const hSym = (h.nse_symbol || h.stock_symbol || '').trim().toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
            return hSym === normClean;
          });

          if (existing) {
            const exQty = existing.quantity || 0;
            const newQty = exQty + qty;
            const exInv = existing.invested_amount || (existing.buy_price * exQty);
            const newInv = exInv + totalVal;
            const newAvg = newQty > 0 ? newInv / newQty : price;
            const currPrice = existing.current_price > 0 ? existing.current_price : price;
            const currVal = newQty * currPrice;
            const unrealPnl = currVal - newInv;
            const unrealPnlPct = newInv > 0 ? (unrealPnl / newInv) * 100 : 0;

            await updateDoc(doc(db, 'holdings', existing.id), {
              quantity: newQty,
              buy_price: newAvg,
              invested_amount: newInv,
              current_value: currVal,
              unrealised_pnl: unrealPnl,
              unrealised_pnl_pct: unrealPnlPct,
              updated_at: nowIso,
            });
          } else {
            let currPrice = price;
            try {
              const priceSnap = await getDoc(doc(db, 'price_cache', cleanSym));
              if (priceSnap.exists()) {
                const p = Number(priceSnap.data()?.close);
                if (p > 0) currPrice = p;
              }
            } catch { /* non-fatal */ }

            const currVal = currPrice > 0 ? qty * currPrice : totalVal;
            const unrealPnl = currVal - totalVal;
            const unrealPnlPct = totalVal > 0 ? (unrealPnl / totalVal) * 100 : 0;

            await addDoc(collection(db, 'holdings'), {
              client_id: id,
              stock_symbol: cleanSym,
              nse_symbol: cleanSym,
              company_name,
              buy_price: price,
              quantity: qty,
              invested_amount: totalVal,
              current_price: currPrice,
              current_value: currVal,
              unrealised_pnl: unrealPnl,
              unrealised_pnl_pct: unrealPnlPct,
              realised_pnl: 0,
              source: 'Fresh',
              holding_tier: 'working',
              sector: meta.sector || 'Unclassified',
              market_cap_category: meta.marketCap || 'Small',
              purchase_date: recoDate || nowIso.split('T')[0],
              created_at: nowIso,
            });
          }
        } else if (recoType === 'SELL') {
          const normClean = cleanSym.replace(/\.NS$/, '').replace(/\.BO$/, '');
          const existing = holdings.find(h => {
            const hSym = (h.nse_symbol || h.stock_symbol || '').trim().toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
            return hSym === normClean;
          });

          if (existing) {
            const remainingQty = Math.max(0, existing.quantity - qty);
            const investedPerUnit = existing.quantity > 0 ? (existing.invested_amount / existing.quantity) : existing.buy_price;
            const investedSold = investedPerUnit * qty;
            const profitLoss = totalVal - investedSold;

            await updateDoc(doc(db, 'transactions', txRef.id), {
              buy_price: investedPerUnit,
              sell_price: price,
              realised_pnl: profitLoss,
              call_status: 'Closed',
            });

            if (remainingQty > 0) {
              const newInv = investedPerUnit * remainingQty;
              const currVal = remainingQty * (existing.current_price || price);
              const unrealPnl = currVal - newInv;
              const unrealPnlPct = newInv > 0 ? (unrealPnl / newInv) * 100 : 0;

              await updateDoc(doc(db, 'holdings', existing.id), {
                quantity: remainingQty,
                invested_amount: newInv,
                current_value: currVal,
                unrealised_pnl: unrealPnl,
                unrealised_pnl_pct: unrealPnlPct,
                realised_pnl: (existing.realised_pnl || 0) + profitLoss,
                updated_at: nowIso,
              });
            } else {
              await deleteDoc(doc(db, 'holdings', existing.id));
            }
          }
        }
      }

      setShowNewRecoModal(false);
      setRecoSymbol('');
      setRecoPrice('');
      setRecoQty('');
      setRecoRangeMin('');
      setRecoRangeMax('');
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to save recommendation');
    } finally {
      setSavingReco(false);
    }
  };

  const handleSaveTxStatus = async (tx: Transaction, newStatus: 'Executed' | 'Avoid') => {
    if (!id) return;
    setSavingTxStatusId(tx.id);
    try {      
      // 1. Update status on the transaction document in Firestore
      await updateDoc(doc(db, 'transactions', tx.id), { status: newStatus });

      // 2. Verification Mode: Transactions are strictly isolated from Holdings during review/verification
      // Once verification is complete, this flag can be re-enabled.
      const SYNC_TX_TO_HOLDINGS = false;
      if (SYNC_TX_TO_HOLDINGS && newStatus === 'Executed' && (tx.action === 'BUY' || !tx.action)) {
        const cleanSym = (tx.stock_symbol || '').trim().toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
        const existing = holdings.find(h => {
          const hSym = (h.nse_symbol || h.stock_symbol || '').trim().toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
          return hSym === cleanSym;
        });

        const meta = getStockMeta(cleanSym, tx.company_name || '');
        const price = tx.reco_price || tx.price || 0;
        const qty = tx.quantity || 0;
        const totalVal = tx.total_value || (price * qty);
        let currPrice = price;
        try {
          const priceSnap = await getDoc(doc(db, 'price_cache', cleanSym));
          if (priceSnap.exists()) {
            const p = Number(priceSnap.data()?.close);
            if (p > 0) currPrice = p;
          }
        } catch { /* non-fatal */ }

        const currVal = currPrice * qty;
        const unrealPnl = currVal - totalVal;
        const unrealPnlPct = totalVal > 0 ? (unrealPnl / totalVal) * 100 : 0;
        const nowIso = new Date().toISOString();

        if (existing) {
          const newQty = existing.quantity + qty;
          const newInvested = (existing.invested_amount || (existing.buy_price * existing.quantity)) + totalVal;
          const newAvgPrice = newQty > 0 ? newInvested / newQty : existing.buy_price;
          const updatedCurrVal = newQty * (existing.current_price || currPrice);
          const updatedUnrealPnl = updatedCurrVal - newInvested;
          const updatedUnrealPnlPct = newInvested > 0 ? (updatedUnrealPnl / newInvested) * 100 : 0;

          await updateDoc(doc(db, 'holdings', existing.id), {
            quantity: newQty,
            buy_price: newAvgPrice,
            invested_amount: newInvested,
            current_value: updatedCurrVal,
            unrealised_pnl: updatedUnrealPnl,
            unrealised_pnl_pct: updatedUnrealPnlPct,
            updated_at: nowIso,
          });
        } else {
          await addDoc(collection(db, 'holdings'), {
            client_id: id,
            stock_symbol: cleanSym,
            nse_symbol: cleanSym,
            company_name: tx.company_name || meta.companyName || cleanSym,
            buy_price: price,
            quantity: qty,
            invested_amount: totalVal,
            current_price: currPrice,
            current_value: currVal,
            unrealised_pnl: unrealPnl,
            unrealised_pnl_pct: unrealPnlPct,
            realised_pnl: 0,
            source: 'Fresh',
            holding_tier: 'working',
            sector: meta.sector || 'Unclassified',
            market_cap_category: meta.marketCap || 'Small',
            purchase_date: tx.date || nowIso.split('T')[0],
            created_at: nowIso,
          });
        }
      }

      // Clear pending status for this tx
      setPendingTxStatus(prev => {
        const next = { ...prev };
        delete next[tx.id];
        return next;
      });

      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to save status & push to portfolio');
    } finally {
      setSavingTxStatusId(null);
    }
  };

  const handleConfirmDeleteTransaction = async () => {
    if (!deleteConfirmTx) return;
    setIsDeletingTx(true);
    try {
      await deleteDoc(doc(db, 'transactions', deleteConfirmTx.id));
      setDeleteConfirmTx(null);
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to delete transaction');
    } finally {
      setIsDeletingTx(false);
    }
  };



  const saveBuyPrice = async (holdingId: string) => {
    const newPrice = parseFloat(editBuyPriceVal);
    if (!newPrice || newPrice <= 0) return;
    setSavingBuyPrice(true);
    try {
      const holding = holdings.find(h => h.id === holdingId);
      if (!holding) return;
      const invested = newPrice * holding.quantity;
      const currVal = holding.current_price > 0 ? holding.current_price * holding.quantity : invested;
      const unrealPnl = currVal - invested;
      const unrealPnlPct = invested > 0 ? (unrealPnl / invested) * 100 : 0;

      await updateDoc(doc(db, 'holdings', holdingId), {
        buy_price: newPrice,
        invested_amount: invested,
        unrealised_pnl: unrealPnl,
        unrealised_pnl_pct: unrealPnlPct,
      });
      setEditingBuyPriceId(null);
      await load();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingBuyPrice(false);
    }
  };

  const saveQty = async (holdingId: string) => {
    const newQty = parseFloat(editQtyVal);
    if (!newQty || newQty <= 0) return;
    setSavingQty(true);
    try {
      const holding = holdings.find(h => h.id === holdingId);
      if (!holding) return;
      const invested = holding.buy_price * newQty;
      const currVal = holding.current_price > 0 ? holding.current_price * newQty : invested;
      const unrealPnl = currVal - invested;
      const unrealPnlPct = invested > 0 ? (unrealPnl / invested) * 100 : 0;

      await updateDoc(doc(db, 'holdings', holdingId), {
        quantity: newQty,
        invested_amount: invested,
        current_value: currVal,
        unrealised_pnl: unrealPnl,
        unrealised_pnl_pct: unrealPnlPct,
      });
      setEditingQtyId(null);
      await load();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingQty(false);
    }
  };

  const handleDownloadExcel = () => {
    import('xlsx').then((XLSX) => {
      const dataToExport = getSortedHoldings().map((h: Holding, idx: number) => {
        const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
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
          'P&L (₹)': h.unrealised_pnl,
          'P&L (%)': (h.unrealised_pnl_pct || 0).toFixed(2) + '%',
          'Source': h.source || 'Existing',
        };
      });
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, portfolioTab === 'client' ? 'Client_Portfolio' : 'Working_Portfolio');
      XLSX.writeFile(wb, (client?.name || 'Client') + '_' + portfolioTab.toUpperCase() + '_Holdings.xlsx');
    });
  };
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

  const gridCols = portfolioTab === 'working'
    ? '36px 170px 155px 80px 80px 115px 125px 115px 125px 130px 90px 75px 85px'
    : '36px 170px 155px 80px 80px 115px 125px 115px 125px 130px 90px 75px 85px 75px';

  return (
    <div className="container animate-fade-in" style={{ paddingBottom: 'var(--space-12)' }}>
      {/* ── Top Header Navigation ───────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 14 }}>
        <button
          onClick={() => navigate('/')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            color: 'var(--text-secondary)', background: 'none', border: 'none',
            fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0,
          }}
        >
          <ArrowLeft size={16} />
          Back to Clients
        </button>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/client/' + id + '/dashboard')}
            className="btn-glass-gold"
            style={{ padding: '10px 22px', fontSize: 13.5, fontWeight: 800, borderRadius: 12 }}
          >
            ✦ Portfolio Intelligence Report
          </button>
        </div>
      </div>

      {/* ── Client Master Header Card ────────────────────────────────────── */}
      <div className="glass-card" style={{
        padding: '22px 28px',
        marginBottom: 20,
        borderRadius: 18,
        border: 'none',
        background: 'rgba(255, 255, 255, 0.88)',
        backdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.035), inset 0 1px 1px rgba(255, 255, 255, 0.95)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          {/* ── LHS: Avatar + Name + Meta ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(201,168,76,0.25) 0%, rgba(185,145,45,0.12) 100%)',
              border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 19, color: '#624206',
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), 0 2px 8px rgba(201,168,76,0.12)',
            }}>
              {client.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ fontSize: 23, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.3px' }}>
                  {client.name}
                </h1>
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700,
                  background: 'rgba(201,168,76,0.16)', color: '#78530b', border: 'none',
                  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.85)',
                }}>
                  {client.risk_profile || 'Moderate'}
                </span>
                {client.rm_name && (
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    RM: <strong style={{ color: 'var(--text-secondary)' }}>{client.rm_name}</strong>
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <span>Client ID: <strong style={{ color: 'var(--text-secondary)' }}>{client.id}</strong></span>
                <span>Onboarded: <strong style={{ color: 'var(--text-secondary)' }}>{client.onboarding_date || '—'}</strong></span>
                <span>Last Statement: <strong style={{ color: '#8c6314' }}>{client.client_portfolio_date || client.onboarding_date || 'Initial'}</strong></span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Total AUA Pill */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(255,251,235,0.92) 100%)',
              border: '1.2px solid rgba(201,168,76,0.32)',
              boxShadow: '0 4px 14px rgba(201,168,76,0.12), inset 0 1px 1px rgba(255,255,255,0.95)',
            }}>
              <Landmark size={14} style={{ color: '#8c6314' }} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: '#8c6314', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total AUA</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#5c3e04' }} className="tabular-nums">{fmtCurrency(totalAua)}</span>
              </div>
            </div>

            {/* Billed AUA Pill (Inline Editable) */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 12,
              background: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(201,168,76,0.22)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03), inset 0 1px 1px rgba(255,255,255,0.9)',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Billed AUA</span>
                {editingBilledAua ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <input
                      type="number"
                      value={billedAuaInput}
                      onChange={e => setBilledAuaInput(e.target.value)}
                      autoFocus
                      style={{ width: 100, padding: '2px 6px', fontSize: 12.5, fontWeight: 700, borderRadius: 6, border: '1px solid rgba(201,168,76,0.4)', background: '#fff', color: 'var(--text-primary)', outline: 'none' }}
                    />
                    <button onClick={saveBilledAua} disabled={savingBilledAua} style={{ background: '#16a34a', border: 'none', color: '#fff', cursor: 'pointer', padding: '3px 5px', borderRadius: 5 }}><Check size={11} /></button>
                    <button onClick={() => setEditingBilledAua(false)} style={{ background: 'rgba(0,0,0,0.06)', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '3px 5px', borderRadius: 5 }}><XIcon size={11} /></button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }} className="tabular-nums">{fmtCurrency(billedAua)}</span>
                    <button onClick={() => { setBilledAuaInput(String(billedAua)); setEditingBilledAua(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8c6314', padding: 2, display: 'flex' }} title="Edit Billed AUA"><Pencil size={10} /></button>
                  </div>
                )}
              </div>
            </div>

            {/* Complementary AUA Pill (Inline Editable) */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 12,
              background: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(201,168,76,0.22)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03), inset 0 1px 1px rgba(255,255,255,0.9)',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Complementary</span>
                {editingCompAua ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <input
                      type="number"
                      value={compAuaInput}
                      onChange={e => setCompAuaInput(e.target.value)}
                      autoFocus
                      style={{ width: 90, padding: '2px 6px', fontSize: 12.5, fontWeight: 700, borderRadius: 6, border: '1px solid rgba(201,168,76,0.4)', background: '#fff', color: 'var(--text-primary)', outline: 'none' }}
                    />
                    <button onClick={saveCompAua} disabled={savingCompAua} style={{ background: '#16a34a', border: 'none', color: '#fff', cursor: 'pointer', padding: '3px 5px', borderRadius: 5 }}><Check size={11} /></button>
                    <button onClick={() => setEditingCompAua(false)} style={{ background: 'rgba(0,0,0,0.06)', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '3px 5px', borderRadius: 5 }}><XIcon size={11} /></button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-secondary)' }} className="tabular-nums">{fmtCurrency(complementaryAua)}</span>
                    <button onClick={() => { setCompAuaInput(String(complementaryAua)); setEditingCompAua(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8c6314', padding: 2, display: 'flex' }} title="Edit Complementary AUA"><Pencil size={10} /></button>
                  </div>
                )}
              </div>
            </div>

            {/* Buffer Capital Pill (Live Auto-Computed) */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 12,
              background: bufferCapital >= 0
                ? 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(240,253,244,0.92) 100%)'
                : 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(254,242,242,0.92) 100%)',
              border: bufferCapital >= 0 ? '1.2px solid rgba(16,185,129,0.28)' : '1.2px solid rgba(239,68,68,0.28)',
              boxShadow: bufferCapital >= 0 ? '0 4px 14px rgba(16,185,129,0.10), inset 0 1px 1px rgba(255,255,255,0.95)' : '0 4px 14px rgba(239,68,68,0.10), inset 0 1px 1px rgba(255,255,255,0.95)',
            }}>
              <Wallet size={14} style={{ color: bufferCapital >= 0 ? '#059669' : '#dc2626' }} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: bufferCapital >= 0 ? '#065f46' : '#991b1b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Buffer Capital
                </span>
                <span style={{ fontSize: 16, fontWeight: 800, color: bufferCapital >= 0 ? '#065f46' : '#dc2626' }} className="tabular-nums">
                  {bufferCapital >= 0 ? '' : '-'}{fmtCurrency(Math.abs(bufferCapital))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Top Master Asset Allocation Strip & AUA Buffer ────────────────── */}
      <div className="glass-card" style={{
        padding: '22px 28px',
        marginBottom: 24,
        border: 'none',
        background: 'rgba(255, 255, 255, 0.88)',
        backdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.035), inset 0 1px 1px rgba(255,255,255,0.95)',
        borderRadius: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Landmark size={18} style={{ color: 'var(--gold)' }} />
            <h3 style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              Master Asset Allocation & Live Performance Strip
            </h3>
          </div>

          {/* Slim Companion Strip: Mutual Funds & Buffer Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Mutual Funds Compact Pill */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 14px', borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(147, 51, 234, 0.06) 100%)',
              boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.95), 0 2px 8px rgba(168, 85, 247, 0.08)',
              border: 'none',
            }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#7e22ce', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Mutual Funds:
              </span>
              {editingMutualFunds ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number"
                    value={mutualFundsInput}
                    onChange={e => setMutualFundsInput(e.target.value)}
                    autoFocus
                    style={{ width: 110, padding: '3px 6px', fontSize: 12.5, fontWeight: 700, borderRadius: 6, border: 'none', background: '#fff', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)' }}
                  />
                  <button onClick={saveMutualFunds} disabled={savingMutualFunds} style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer', padding: 2 }}><Check size={14} /></button>
                  <button onClick={() => setEditingMutualFunds(false)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 2 }}><XIcon size={14} /></button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <strong style={{ fontSize: 13.5, fontWeight: 800, color: '#7e22ce' }}>{fmtCurrency(mutualFunds)}</strong>
                  <button onClick={() => setEditingMutualFunds(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7e22ce', display: 'flex', padding: 0 }} title="Edit Mutual Funds"><Pencil size={11} /></button>
                </div>
              )}
            </div>


          </div>
        </div>

        {/* ── 5 Key Master Metric Cards ───────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
          {/* Card 1: Current Value — tab-dynamic, non-editable */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.72) 100%)',
            border: 'none', borderRadius: 16,
            padding: '18px 20px', backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.04), inset 0 1px 1px rgba(255,255,255,0.95)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Current Value {portfolioTab === 'client' ? '· Client' : '· Working'}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }} className="tabular-nums">{fmtCurrency(stripSummary.currentValue)}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>{portfolioTab === 'client' ? 'Client baseline live' : 'Working portfolio live'}</div>
          </div>

          {/* Card 2: Invested Value — tab-dynamic, non-editable */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.72) 100%)',
            border: 'none', borderRadius: 16,
            padding: '18px 20px', backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.04), inset 0 1px 1px rgba(255,255,255,0.95)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Invested Value {portfolioTab === 'client' ? '· Client' : '· Working'}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }} className="tabular-nums">{fmtCurrency(stripSummary.totalInvested)}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>Equity portfolio cost basis</div>
          </div>

          {/* Card 3: Unrealised P&L (Working Live) */}
          <div style={{
            background: workingSummary.unrealisedPnL >= 0 
              ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.16) 0%, rgba(22, 163, 74, 0.08) 100%)' 
              : 'linear-gradient(135deg, rgba(239, 68, 68, 0.16) 0%, rgba(220, 38, 38, 0.08) 100%)',
            border: 'none', borderRadius: 16,
            padding: '18px 20px', backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            boxShadow: workingSummary.unrealisedPnL >= 0 
              ? '0 4px 20px rgba(34, 197, 94, 0.08), inset 0 1px 1px rgba(255,255,255,0.95)' 
              : '0 4px 20px rgba(239, 68, 68, 0.08), inset 0 1px 1px rgba(255,255,255,0.95)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: workingSummary.unrealisedPnL >= 0 ? '#15803d' : '#dc2626', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Unrealised P&L (Live)
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: workingSummary.unrealisedPnL >= 0 ? '#15803d' : '#dc2626', marginTop: 6 }}>
              {workingSummary.unrealisedPnL >= 0 ? '+' : ''}{fmtCurrency(workingSummary.unrealisedPnL)}
            </div>
            <div style={{ fontSize: 10.5, color: workingSummary.unrealisedPnL >= 0 ? '#16a34a' : '#dc2626', marginTop: 4, fontWeight: 600 }}>
              {workingSummary.unrealisedPnLPct >= 0 ? '+' : ''}{workingSummary.unrealisedPnLPct.toFixed(2)}% · Working Portfolio
            </div>
          </div>

          {/* Card 4: Realised P&L (Sell Ledger) */}
          <div style={{
            background: totalRealisedPnL >= 0 
              ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.16) 0%, rgba(22, 163, 74, 0.08) 100%)' 
              : 'linear-gradient(135deg, rgba(239, 68, 68, 0.16) 0%, rgba(220, 38, 38, 0.08) 100%)',
            border: 'none', borderRadius: 16,
            padding: '18px 20px', backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            boxShadow: totalRealisedPnL >= 0 
              ? '0 4px 20px rgba(34, 197, 94, 0.08), inset 0 1px 1px rgba(255,255,255,0.95)' 
              : '0 4px 20px rgba(239, 68, 68, 0.08), inset 0 1px 1px rgba(255,255,255,0.95)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: totalRealisedPnL >= 0 ? '#15803d' : '#dc2626', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Realised P&L (Locked)
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: totalRealisedPnL >= 0 ? '#15803d' : '#dc2626', marginTop: 6 }}>
              {totalRealisedPnL >= 0 ? '+' : ''}{fmtCurrency(totalRealisedPnL)}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
              {executedSells.length} sell orders executed
            </div>
          </div>

          {/* Card 5: Free Cash (Live) */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.20) 0%, rgba(185, 145, 45, 0.10) 100%)',
            border: 'none', borderRadius: 16,
            padding: '18px 20px', backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            boxShadow: '0 4px 20px rgba(201, 168, 76, 0.08), inset 0 1px 1px rgba(255,255,255,0.95)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8c6314', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Free Cash (Live)</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: projectedCash >= 0 ? '#5c3e04' : '#dc2626', marginTop: 6 }}>{fmtCurrency(projectedCash)}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>Opening − New Buys + New Sells</div>
          </div>
        </div>
      </div>

      {/* ── 4 Main Tabs Navigation Bar ───────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, borderBottom: '1px solid rgba(229, 231, 235, 0.65)',
        paddingBottom: 12, flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { key: 'client', label: 'Client Portfolio', badge: `${clientHoldings.length} Base` },
            { key: 'working', label: 'Working Portfolio', badge: `${workingHoldings.length} Active` },
            { key: 'transactions', label: 'Transactions During Period', badge: `${transactions.length} Orders` },
            { key: 'cash', label: 'Cash Position', badge: fmtCurrencyKPI(projectedCash) },
          ].map((t) => {
            const isActive = portfolioTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setPortfolioTab(t.key as any)}
                style={{
                  padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 700,
                  border: 'none',
                  background: isActive ? 'linear-gradient(135deg, rgba(201, 168, 76, 0.28) 0%, rgba(185, 145, 45, 0.16) 100%)' : 'rgba(255, 255, 255, 0.65)',
                  color: isActive ? '#5c3e04' : 'var(--text-secondary)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'all 0.18s ease',
                  boxShadow: isActive ? 'inset 0 1px 1px rgba(255,255,255,0.95), 0 3px 10px rgba(160,124,45,0.14)' : 'none',
                }}
              >
                <span>{t.label}</span>
                <span style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                  background: isActive ? '#624206' : 'rgba(0,0,0,0.06)',
                  color: isActive ? '#ffffff' : 'var(--text-muted)',
                }}>
                  {t.badge}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingRight: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
          <span>
            {portfolioTab === 'client'
              ? 'Original Client Statement (Base)'
              : portfolioTab === 'cash'
              ? 'Dynamic Ledger & Reconciliation'
              : portfolioTab === 'transactions'
              ? 'Trade Recos & Realised P&L'
              : 'Live Active Tracking Model (CMP Sync)'}
          </span>
        </div>
      </div>
      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1 & TAB 2: HOLDINGS TABLES (Client Portfolio & Working Portfolio)
          ══════════════════════════════════════════════════════════════════════ */}
      {(portfolioTab === 'client' || portfolioTab === 'working') && (
        <section style={{ marginBottom: 'var(--space-10)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  {portfolioTab === 'client' ? 'Client Portfolio (Baseline)' : 'Working Portfolio (Live Tracking)'}
                </h2>
                <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>
                  ({getSortedHoldings().length} positions)
                </span>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'block', marginTop: 3 }}>
                {portfolioTab === 'client'
                  ? 'Last Client Statement Received: ' + (client.client_portfolio_date || client.onboarding_date || 'Initial Onboarding')
                  : 'Live positions tracking active North Wealth recommendations with real-time CMP'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search scrip / company..."
                value={stockSearch}
                onChange={e => setStockSearch(e.target.value)}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
              />

              <select
                value={sectorFilter}
                onChange={e => setSectorFilter(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
              >
                <option value="">All Sectors</option>
                {uniqueSectors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <select
                value={mcapFilter}
                onChange={e => setMcapFilter(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
              >
                <option value="">All M.Cap</option>
                {uniqueMCaps.map(m => <option key={m} value={m}>{m}</option>)}
              </select>

              <button
                onClick={handleDownloadExcel}
                className="btn-glass-light"
                style={{ padding: '6px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={13} /> Export
              </button>

              {portfolioTab === 'client' && (
                <button
                  onClick={openUpdateWizard}
                  className="btn-glass-gold"
                  style={{ padding: '7px 18px', fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 2px 10px rgba(201,168,76,0.25)' }}
                >
                  <Sparkles size={14} /> Update Client Portfolio
                </button>
              )}
            </div>
          </div>

          {/* Holdings Grid Table — sticky header (Client & Working Portfolio) */}
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflow: 'auto', maxHeight: '62vh', position: 'relative' }}>
              <div style={{ minWidth: 1250 }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: gridCols, gap: 8,
                  padding: '12px 16px', background: 'rgba(248,247,243,0.98)',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px',
                  position: 'sticky', top: 0, zIndex: 2, backdropFilter: 'blur(8px)',
                }}>
                  <div>#</div>
                  <div style={{ cursor: 'pointer' }} onClick={() => handleSort('scrip')}>
                    Scrip {sortColumn === 'scrip' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div style={{ cursor: 'pointer' }} onClick={() => handleSort('sector')}>
                    Sector {sortColumn === 'sector' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div>M.Cap</div>
                  <div style={{ cursor: 'pointer' }} onClick={() => handleSort('qty')}>
                    Qty {sortColumn === 'qty' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div style={{ cursor: 'pointer' }} onClick={() => handleSort('buy_price')}>
                    Avg Buy {sortColumn === 'buy_price' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div style={{ cursor: 'pointer' }} onClick={() => handleSort('invested_amount')}>
                    Invested {sortColumn === 'invested_amount' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div style={{ cursor: 'pointer' }} onClick={() => handleSort('current_price')}>
                    CMP {sortColumn === 'current_price' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div style={{ cursor: 'pointer' }} onClick={() => handleSort('current_value')}>
                    Curr Val {sortColumn === 'current_value' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div style={{ cursor: 'pointer' }} onClick={() => handleSort('unrealised_pnl')}>
                    Unreal P&L {sortColumn === 'unrealised_pnl' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </div>
                  <div>P&L %</div>
                  <div>Alloc %</div>
                  <div>Source</div>
                  {portfolioTab !== 'working' && <div>Act</div>}
                </div>

                {getSortedHoldings().length === 0 ? (
                  <div style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No holdings found in this portfolio view.
                  </div>
                ) : (
                  getSortedHoldings().map((h, idx) => {
                    const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
                    const isBseOnly = meta.listingStatus === 'BSE Only' || (meta.statusReason?.includes('BSE') ?? false);
                    const isBseOnlyNoPrice = isBseOnly && (!h.current_price || h.current_price <= 0);

                    const invested = h.invested_amount || (h.buy_price * h.quantity);
                    const currPrice = isBseOnlyNoPrice ? 0 : (h.current_price || 0);
                    const currVal = isBseOnlyNoPrice ? 0 : (h.current_value || (currPrice > 0 ? currPrice * h.quantity : invested));
                    const unrealPnl = isBseOnlyNoPrice ? 0 : (h.unrealised_pnl || (currVal - invested));
                    const unrealPnlPct = isBseOnlyNoPrice ? 0 : (h.unrealised_pnl_pct || (invested > 0 ? (unrealPnl / invested) * 100 : 0));
                    const allocPct = summary.currentValue > 0 ? (currVal / summary.currentValue) * 100 : 0;

                    return (
                      <div
                        key={h.id}
                        style={{
                          display: 'grid', gridTemplateColumns: gridCols, gap: 8,
                          alignItems: 'center', padding: '10px 16px',
                          borderBottom: '1px solid rgba(0,0,0,0.04)',
                          fontSize: 12.5,
                        }}
                      >
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{idx + 1}</div>

                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 700, color: '#8c6314' }}>{cleanSymbol(h)}</span>
                            {isBseOnly && (
                              <span style={{
                                fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                                background: 'rgba(234, 88, 12, 0.12)', color: '#c2410c',
                                letterSpacing: '0.3px', flexShrink: 0,
                              }}>
                                BSE Only
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {meta.companyName || h.company_name || '—'}
                          </div>
                        </div>

                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {meta.sector || 'Unclassified'}
                        </div>

                        <div>
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                            background: meta.marketCap === 'Large' ? 'rgba(59,130,246,0.08)' : meta.marketCap === 'Mid' ? 'rgba(168,85,247,0.08)' : 'rgba(234,179,8,0.08)',
                            color: meta.marketCap === 'Large' ? '#2563eb' : meta.marketCap === 'Mid' ? '#7e22ce' : '#ca8a04',
                          }}>
                            {meta.marketCap || '—'}
                          </span>
                        </div>

                        <div>
                          {portfolioTab === 'client' && editingQtyId === h.id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input
                                type="number"
                                value={editQtyVal}
                                onChange={e => setEditQtyVal(e.target.value)}
                                autoFocus
                                style={{ width: 60, padding: '2px 4px', fontSize: 12, borderRadius: 4, border: '1px solid var(--gold-border)' }}
                              />
                              <button onClick={() => saveQty(h.id)} disabled={savingQty} style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer' }}><Check size={12} /></button>
                              <button onClick={() => setEditingQtyId(null)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}><XIcon size={12} /></button>
                            </div>
                          ) : (
                            <div
                              onClick={() => {
                                if (portfolioTab === 'client') {
                                  setEditingQtyId(h.id);
                                  setEditQtyVal(String(h.quantity));
                                }
                              }}
                              style={{ cursor: portfolioTab === 'client' ? 'pointer' : 'default', fontWeight: 500 }}
                              className="tabular-nums"
                            >
                              {h.quantity.toLocaleString('en-IN')}
                            </div>
                          )}
                        </div>

                        <div>
                          {portfolioTab === 'client' && editingBuyPriceId === h.id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input
                                type="number"
                                value={editBuyPriceVal}
                                onChange={e => setEditBuyPriceVal(e.target.value)}
                                autoFocus
                                style={{ width: 65, padding: '2px 4px', fontSize: 12, borderRadius: 4, border: '1px solid var(--gold-border)' }}
                              />
                              <button onClick={() => saveBuyPrice(h.id)} disabled={savingBuyPrice} style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer' }}><Check size={12} /></button>
                              <button onClick={() => setEditingBuyPriceId(null)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}><XIcon size={12} /></button>
                            </div>
                          ) : (
                            <div
                              onClick={() => {
                                if (portfolioTab === 'client') {
                                  setEditingBuyPriceId(h.id);
                                  setEditBuyPriceVal(String(h.buy_price));
                                }
                              }}
                              style={{ cursor: portfolioTab === 'client' ? 'pointer' : 'default', fontWeight: 500 }}
                              className="tabular-nums"
                            >
                              ₹{h.buy_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>
                          )}
                        </div>

                        <div className="tabular-nums" style={{ fontWeight: 600 }}>
                          {fmtCurrency(invested)}
                        </div>

                        <div className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                          {currPrice > 0 ? ('₹' + currPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })) : '—'}
                        </div>

                        <div className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {currVal > 0 ? fmtCurrency(currVal) : '₹0'}
                        </div>

                        <div className="tabular-nums" style={{ fontWeight: 700, color: unrealPnl > 0 ? '#16a34a' : unrealPnl < 0 ? '#dc2626' : 'var(--text-muted)' }}>
                          {unrealPnl > 0 ? '+' : ''}{fmtCurrency(unrealPnl)}
                        </div>

                        <div>
                          <PnLBadge value={unrealPnlPct || 0} suffix="%" />
                        </div>

                        <div className="tabular-nums" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {allocPct.toFixed(1)}%
                        </div>

                        <div>
                          <span style={{
                            fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                            background: h.source === 'Fresh' ? 'rgba(34,197,94,0.1)' : 'rgba(0,0,0,0.05)',
                            color: h.source === 'Fresh' ? '#16a34a' : 'var(--text-muted)',
                          }}>
                            {h.source || 'Existing'}
                          </span>
                        </div>

                        {portfolioTab !== 'working' && (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                onClick={() => {
                                  setEditingHoldingModal(h);
                                  setEditModalSymbol(cleanSymbol(h));
                                  setEditModalQty(String(h.quantity));
                                  setEditModalPrice(String(h.buy_price));
                                  setEditModalSource(h.source || 'Existing');
                                }}
                                style={{ background: 'rgba(201,168,76,0.14)', border: 'none', color: '#8c6314', borderRadius: 6, cursor: 'pointer', padding: '4px 7px', display: 'flex', alignItems: 'center', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.85)' }}
                                title="Edit holding details"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmHolding({ id: h.id, symbol: cleanSymbol(h) || 'this holding' })}
                                style={{ background: 'rgba(239,68,68,0.12)', border: 'none', color: '#dc2626', borderRadius: 6, cursor: 'pointer', padding: '4px 7px', display: 'flex', alignItems: 'center', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.85)' }}
                                title="Delete position"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                         </div>
                        )}
                       </div>
                     );
                   })
                 )}
               </div>
             </div>
           </div>
         </section>
       )}
      {/* ══════════════════════════════════════════════════════════════════════
          TAB 3: TRANSACTIONS DURING PERIOD (Recos, Status Dropdown & Realised P&L)
          ══════════════════════════════════════════════════════════════════════ */}
      {portfolioTab === 'transactions' && (
        <section style={{ marginBottom: 'var(--space-10)' }}>
          {/* Header Strip */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                Transactions During Service Period
              </h2>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'block', marginTop: 3 }}>
                Two-tier segregated view: Buy recommendations (top) & Executed sell ledger (bottom).
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search stock symbol..."
                value={txStockSearch}
                onChange={e => setTxStockSearch(e.target.value)}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
              />

              <button
                onClick={() => {
                  setRecoType('BUY');
                  setShowNewRecoModal(true);
                }}
                className="btn-glass-gold"
                style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <PlusCircle size={13} /> Add New Transaction
              </button>
            </div>
          </div>

          {/* 3 KPI — Transactions During Service Period: Total P&L | Unrealized | Realized */}
          {(() => {
            const unrealised = txBuySummary.unrealisedPnL;
            const realised = totalRealisedPnL;
            const totalPnL = unrealised + realised;
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
                {/* LHS: Total P&L */}
                <div style={{
                  background: totalPnL >= 0 ? 'linear-gradient(135deg, rgba(201,168,76,0.14) 0%, rgba(185,145,45,0.07) 100%)' : 'linear-gradient(135deg, rgba(239,68,68,0.10) 0%, rgba(220,38,38,0.05) 100%)',
                  border: 'none', borderRadius: 16, padding: '18px 20px',
                  backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.04), inset 0 1px 1px rgba(255,255,255,0.95)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: totalPnL >= 0 ? '#8c6314' : '#dc2626', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Total P&L</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: totalPnL >= 0 ? (totalPnL === 0 ? 'var(--text-primary)' : '#8c6314') : '#dc2626', marginTop: 6 }} className="tabular-nums">{totalPnL >= 0 ? '+' : ''}{fmtCurrency(totalPnL)}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>Unrealized + Realized</div>
                </div>
                {/* Middle: Unrealized P&L */}
                <div style={{
                  background: unrealised >= 0 ? 'linear-gradient(135deg, rgba(34,197,94,0.14) 0%, rgba(22,163,74,0.07) 100%)' : 'linear-gradient(135deg, rgba(239,68,68,0.14) 0%, rgba(220,38,38,0.07) 100%)',
                  border: 'none', borderRadius: 16, padding: '18px 20px',
                  backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.04), inset 0 1px 1px rgba(255,255,255,0.95)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: unrealised >= 0 ? '#15803d' : '#dc2626', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Unrealized P&L</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: unrealised >= 0 ? '#15803d' : '#dc2626', marginTop: 6 }} className="tabular-nums">{unrealised >= 0 ? '+' : ''}{fmtCurrency(unrealised)}</div>
                  <div style={{ fontSize: 10.5, color: unrealised >= 0 ? '#16a34a' : '#dc2626', marginTop: 4, fontWeight: 600 }}>{txBuySummary.unrealisedPnLPct >= 0 ? '+' : ''}{txBuySummary.unrealisedPnLPct.toFixed(2)}% · Transactions</div>
                </div>
                {/* RHS: Realized P&L */}
                <div style={{
                  background: realised >= 0 ? 'linear-gradient(135deg, rgba(34,197,94,0.14) 0%, rgba(22,163,74,0.07) 100%)' : 'linear-gradient(135deg, rgba(239,68,68,0.14) 0%, rgba(220,38,38,0.07) 100%)',
                  border: 'none', borderRadius: 16, padding: '18px 20px',
                  backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.04), inset 0 1px 1px rgba(255,255,255,0.95)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: realised >= 0 ? '#15803d' : '#dc2626', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Realized P&L</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: realised >= 0 ? '#15803d' : '#dc2626', marginTop: 6 }} className="tabular-nums">{realised >= 0 ? '+' : ''}{fmtCurrency(realised)}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>{executedSells.length} sells executed</div>
                </div>
              </div>
            );
          })()}

          {/* ── Sub-tabs: Buy Orders / Sell Orders (below fixed top 3 KPI) ── */}
          <div style={{
            display: 'flex', gap: 10, marginBottom: 20,
            borderBottom: '1px solid rgba(229,231,235,0.65)', paddingBottom: 12,
          }}>
            {[
              { key: 'buy' as const, label: 'Buy Orders', count: transactions.filter(t => t.action === 'BUY' || !t.action).length, activeColor: '#16a34a' },
              { key: 'sell' as const, label: 'Sell Orders', count: executedSells.length, activeColor: '#dc2626' },
            ].map(tab => {
              const isActive = txSubTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setTxSubTab(tab.key)}
                  style={{
                    padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    background: isActive ? (tab.key === 'buy' ? 'linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(22,163,74,0.10) 100%)' : 'linear-gradient(135deg, rgba(239,68,68,0.16) 0%, rgba(220,38,38,0.08) 100%)') : 'rgba(255,255,255,0.65)',
                    color: isActive ? tab.activeColor : 'var(--text-secondary)',
                    boxShadow: isActive ? 'inset 0 1px 1px rgba(255,255,255,0.95), 0 3px 10px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.18s ease',
                  }}
                >
                  <span>{tab.label}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                    background: isActive ? tab.activeColor : 'rgba(0,0,0,0.06)',
                    color: isActive ? '#fff' : 'var(--text-muted)',
                  }}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ════════════════════════════════════════════════════════════════════
              BUY ORDERS SUB-TAB
              ════════════════════════════════════════════════════════════════════ */}
          {txSubTab === 'buy' && (
            <>
              {/* Buy Orders KPI — PREMIUM Glassmorphism (contrasts with top standard KPI) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
                <div style={{
                  padding: '14px 18px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(255,251,235,0.88) 100%)',
                  backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)',
                  border: '1.5px solid rgba(201,168,76,0.32)',
                  boxShadow: '0 8px 24px rgba(201,168,76,0.14), inset 0 1px 1px rgba(255,255,255,0.95), inset 0 -1px 0 rgba(201,168,76,0.12)',
                }}>
                  <div style={{ position: 'absolute', top: -18, right: -18, width: 56, height: 56, borderRadius: '50%', background: 'radial-gradient(circle, rgba(201,168,76,0.14) 0%, transparent 70%)' }} />
                  <div style={{ fontSize: 9.5, fontWeight: 800, color: '#8c6314', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={12} style={{ color: '#8c6314' }} /> Invested Value</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: '#5c3e04', marginTop: 6, letterSpacing: '-0.3px' }} className="tabular-nums">{fmtCurrency(txBuySummary.invested)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>Buy Orders cost basis</div>
                </div>
                <div style={{
                  padding: '14px 18px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.88) 100%)',
                  backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)',
                  border: '1.5px solid rgba(148,163,184,0.22)',
                  boxShadow: '0 8px 24px rgba(148,163,184,0.10), inset 0 1px 1px rgba(255,255,255,0.95), inset 0 -1px 0 rgba(148,163,184,0.10)',
                }}>
                  <div style={{ position: 'absolute', top: -18, right: -18, width: 56, height: 56, borderRadius: '50%', background: 'radial-gradient(circle, rgba(148,163,184,0.12) 0%, transparent 70%)' }} />
                  <div style={{ fontSize: 9.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={12} style={{ color: '#475569' }} /> Current Value</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6, letterSpacing: '-0.3px' }} className="tabular-nums">{fmtCurrency(txBuySummary.currentValue)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>{txBuySummary.currentValue >= txBuySummary.invested ? '▲ Gain' : '▼ Loss'} live</div>
                </div>
                <div style={{
                  padding: '14px 18px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                  background: txBuySummary.unrealisedPnL >= 0 ? 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(240,253,244,0.90) 100%)' : 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(254,242,242,0.90) 100%)',
                  backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)',
                  border: txBuySummary.unrealisedPnL >= 0 ? '1.5px solid rgba(34,197,94,0.28)' : '1.5px solid rgba(239,68,68,0.28)',
                  boxShadow: txBuySummary.unrealisedPnL >= 0 ? '0 8px 24px rgba(34,197,94,0.12), inset 0 1px 1px rgba(255,255,255,0.95)' : '0 8px 24px rgba(239,68,68,0.12), inset 0 1px 1px rgba(255,255,255,0.95)',
                }}>
                  <div style={{ position: 'absolute', top: -18, right: -18, width: 56, height: 56, borderRadius: '50%', background: txBuySummary.unrealisedPnL >= 0 ? 'radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%)' : 'radial-gradient(circle, rgba(239,68,68,0.12) 0%, transparent 70%)' }} />
                  <div style={{ fontSize: 9.5, fontWeight: 800, color: txBuySummary.unrealisedPnL >= 0 ? '#065f46' : '#991b1b', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={12} style={{ color: txBuySummary.unrealisedPnL >= 0 ? '#059669' : '#dc2626' }} /> Unrealized P&L</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: txBuySummary.unrealisedPnL >= 0 ? '#065f46' : '#991b1b', marginTop: 6, letterSpacing: '-0.3px' }} className="tabular-nums">{txBuySummary.unrealisedPnL >= 0 ? '+' : ''}{fmtCurrency(txBuySummary.unrealisedPnL)}</div>
                  <div style={{ fontSize: 10, color: txBuySummary.unrealisedPnL >= 0 ? '#059669' : '#dc2626', marginTop: 3, fontWeight: 600 }}>{txBuySummary.unrealisedPnLPct >= 0 ? '+' : ''}{txBuySummary.unrealisedPnLPct.toFixed(2)}%</div>
                </div>
              </div>

              <div className="glass-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
                <div style={{
                  padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'rgba(34,197,94,0.03)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 4, background: '#16a34a', color: '#fff' }}>
                      BUY ORDERS
                    </span>
                    <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Buy Recommendations & Open Positions
                    </h3>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                    {transactions.filter(t => t.action === 'BUY' || !t.action).length} recommendations
                  </span>
                </div>

                <div style={{ overflow: 'auto', maxHeight: '62vh', position: 'relative' }}>
                  <div style={{ minWidth: 1180 }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '105px 150px 90px 105px 70px 75px 100px 135px 65px 55px 65px', gap: 10,
                      padding: '12px 16px', background: 'rgba(248,247,243,0.98)', borderBottom: '1px solid var(--border-subtle)',
                      fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px',
                      position: 'sticky', top: 0, zIndex: 2, backdropFilter: 'blur(8px)',
                    }}>
                      <div style={{ cursor: 'pointer' }} onClick={() => handleTxSort('date')}>Date</div>
                      <div>Stock Name</div>
                      <div>Reco Price</div>
                      <div>Buying Price Range</div>
                      <div>Quantity</div>
                      <div>Sold Qty</div>
                      <div>Amount (₹)</div>
                      <div>Status & Action</div>
                      <div>Call</div>
                      <div>Report</div>
                      <div>Act</div>
                    </div>

                    {(() => {
                      // FIFO allocation of sold qty per buy recommendation (per symbol, by buy date)
                      const sellsBySymbol = new Map<string, number>();
                      executedSells.forEach(s => {
                        const k = cleanSymbol(s).toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
                        sellsBySymbol.set(k, (sellsBySymbol.get(k) || 0) + (Number(s.quantity) || 0));
                      });
                      const buysOrdered = [...transactions].filter(t => t.action === 'BUY' || !t.action).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                      const remaining = new Map(sellsBySymbol);
                      const soldMap = new Map<string, number>();
                      buysOrdered.forEach(b => {
                        const k = cleanSymbol(b).toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
                        const rem = remaining.get(k) || 0;
                        const sold = Math.min(Number(b.quantity) || 0, Math.max(0, rem));
                        soldMap.set(b.id, sold);
                        remaining.set(k, Math.max(0, rem - sold));
                      });

                      const buyList = getSortedBuyTransactions();

                      if (buyList.length === 0) {
                        return (
                          <div style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                            No transactions yet. Click <strong>"Add New Transaction"</strong> to add a new transaction.
                          </div>
                        );
                      }

                      return buyList.map((tx) => {
                        const meta = getStockMeta(tx.stock_symbol, tx.company_name || '');
                        const currentSt = pendingTxStatus[tx.id] || tx.status || 'Executed';
                        const isExecuted = currentSt === 'Executed';
                        const isPendingSave = pendingTxStatus[tx.id] && pendingTxStatus[tx.id] !== (tx.status || 'Executed');
                        const amt = tx.total_value || (tx.price * tx.quantity);

                        const soldQty = soldMap.get(tx.id) ?? 0;
                        const hasSold = soldQty > 0;

                        return (
                          <div
                            key={tx.id}
                            style={{
                              display: 'grid', gridTemplateColumns: '105px 150px 90px 105px 70px 75px 100px 135px 65px 55px 65px', gap: 10,
                              alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)',
                              fontSize: 12.5,
                            }}
                          >
                            <div style={{ color: 'var(--text-secondary)' }}>
                              {new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </div>

                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <div style={{ fontWeight: 700, color: '#8c6314' }}>{cleanSymbol(tx)}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {meta.companyName || tx.company_name || '—'}
                              </div>
                            </div>

                            <div className="tabular-nums" style={{ fontWeight: 500 }}>
                              ₹{(tx.reco_price || tx.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>

                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                              {tx.price_range || '—'}
                            </div>

                            <div className="tabular-nums">
                              {tx.quantity.toLocaleString('en-IN')}
                            </div>

                            <div className="tabular-nums" style={{ fontWeight: 700, color: hasSold ? '#b45309' : 'var(--text-muted)', textAlign: 'center' }}>
                              {soldQty.toLocaleString('en-IN')}
                            </div>

                            <div className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                              {fmtCurrency(amt)}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <select
                                value={currentSt}
                                onChange={e => {
                                  const newSt = e.target.value as 'Executed' | 'Avoid';
                                  setPendingTxStatus(prev => ({ ...prev, [tx.id]: newSt }));
                                }}
                                style={{
                                  padding: '4px 8px', borderRadius: 8, fontSize: 11.5, fontWeight: 700,
                                  background: isExecuted ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.12)',
                                  color: isExecuted ? '#16a34a' : '#475569',
                                  border: 'none',
                                  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.85)',
                                  cursor: 'pointer', outline: 'none',
                                }}
                              >
                                <option value="Executed">Executed</option>
                                <option value="Avoid">Avoid</option>
                              </select>
                              {isPendingSave && (
                                <button
                                  onClick={() => handleSaveTxStatus(tx, pendingTxStatus[tx.id] || 'Executed')}
                                  disabled={savingTxStatusId === tx.id}
                                  className="btn-glass-green"
                                  style={{
                                    padding: '3px 8px', fontSize: 11, fontWeight: 800, borderRadius: 6,
                                    display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                                  }}
                                  title="Save status and push to Client & Working Portfolio"
                                >
                                  {savingTxStatusId === tx.id ? '…' : <><Check size={12} /> Save</>}
                                </button>
                              )}
                            </div>

                            <div>
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                                background: tx.call_status === 'Closed' ? 'rgba(0,0,0,0.06)' : 'rgba(59,130,246,0.08)',
                                color: tx.call_status === 'Closed' ? 'var(--text-muted)' : '#2563eb',
                              }}>
                                {tx.call_status || 'Open'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <span
                                title="Report (PDF) — static placeholder"
                                style={{
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  width: 28, height: 28, borderRadius: 7,
                                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.14)',
                                  color: '#dc2626',
                                }}
                              >
                                <FileText size={14} />
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {(tx.status === 'Executed' || !tx.status) && tx.call_status !== 'Closed' && (
                                <button
                                  onClick={() => openSellModalForTx(tx)}
                                  className="btn-glass-red"
                                  style={{ padding: '2px 7px', fontSize: 11, fontWeight: 700, borderRadius: 4 }}
                                  title="Sell shares of this recommendation"
                                >
                                  Sell
                                </button>
                              )}
                              <button
                                onClick={() => setDeleteConfirmTx({ id: tx.id, symbol: cleanSymbol(tx) })}
                                style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 2 }}
                                title="Delete transaction record"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════════════
              SELL ORDERS SUB-TAB
              ════════════════════════════════════════════════════════════════════ */}
          {txSubTab === 'sell' && (
            <>
              {/* Sell Orders KPI — PREMIUM Glassmorphism (contrasts with top standard KPI) */}
              {(() => {
                const sellInvestedAmount = executedSells.reduce((sum, t) => {
                  let buyPr = t.buy_price && t.buy_price > 0 ? t.buy_price : 0;
                  if (!buyPr && t.price > 0 && t.quantity > 0 && (t.realised_pnl || 0) !== 0) buyPr = t.price - ((t.realised_pnl || 0) / t.quantity);
                  const invested = buyPr > 0 ? buyPr * t.quantity : (t.total_value || 0) - (t.realised_pnl || 0);
                  return sum + (invested > 0 ? invested : 0);
                }, 0);
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
                    <div style={{
                      padding: '14px 18px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(255,251,235,0.88) 100%)',
                      backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)',
                      border: '1.5px solid rgba(201,168,76,0.32)',
                      boxShadow: '0 8px 24px rgba(201,168,76,0.14), inset 0 1px 1px rgba(255,255,255,0.95), inset 0 -1px 0 rgba(201,168,76,0.12)',
                    }}>
                      <div style={{ position: 'absolute', top: -18, right: -18, width: 56, height: 56, borderRadius: '50%', background: 'radial-gradient(circle, rgba(201,168,76,0.14) 0%, transparent 70%)' }} />
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: '#8c6314', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={12} style={{ color: '#8c6314' }} /> Invested Amount</div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: '#5c3e04', marginTop: 6, letterSpacing: '-0.3px' }} className="tabular-nums">{fmtCurrency(sellInvestedAmount)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>{executedSells.length} positions cost</div>
                    </div>
                    <div style={{
                      padding: '14px 18px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(239,246,255,0.90) 100%)',
                      backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)',
                      border: '1.5px solid rgba(59,130,246,0.22)',
                      boxShadow: '0 8px 24px rgba(59,130,246,0.10), inset 0 1px 1px rgba(255,255,255,0.95), inset 0 -1px 0 rgba(59,130,246,0.10)',
                    }}>
                      <div style={{ position: 'absolute', top: -18, right: -18, width: 56, height: 56, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.10) 0%, transparent 70%)' }} />
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: 6 }}><Landmark size={12} style={{ color: '#2563eb' }} /> Sale Proceeds</div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: '#1e3a5f', marginTop: 6, letterSpacing: '-0.3px' }} className="tabular-nums">{fmtCurrency(freshSellsTotal)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>Gross sales value</div>
                    </div>
                    <div style={{
                      padding: '14px 18px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                      background: totalRealisedPnL >= 0 ? 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(240,253,244,0.90) 100%)' : 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(254,242,242,0.90) 100%)',
                      backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)',
                      border: totalRealisedPnL >= 0 ? '1.5px solid rgba(34,197,94,0.28)' : '1.5px solid rgba(239,68,68,0.28)',
                      boxShadow: totalRealisedPnL >= 0 ? '0 8px 24px rgba(34,197,94,0.12), inset 0 1px 1px rgba(255,255,255,0.95)' : '0 8px 24px rgba(239,68,68,0.12), inset 0 1px 1px rgba(255,255,255,0.95)',
                    }}>
                      <div style={{ position: 'absolute', top: -18, right: -18, width: 56, height: 56, borderRadius: '50%', background: totalRealisedPnL >= 0 ? 'radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%)' : 'radial-gradient(circle, rgba(239,68,68,0.12) 0%, transparent 70%)' }} />
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: totalRealisedPnL >= 0 ? '#065f46' : '#991b1b', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={12} style={{ color: totalRealisedPnL >= 0 ? '#059669' : '#dc2626' }} /> Realized P&L</div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: totalRealisedPnL >= 0 ? '#065f46' : '#991b1b', marginTop: 6, letterSpacing: '-0.3px' }} className="tabular-nums">{totalRealisedPnL >= 0 ? '+' : ''}{fmtCurrency(totalRealisedPnL)}</div>
                      <div style={{ fontSize: 10, color: totalRealisedPnL >= 0 ? '#059669' : '#dc2626', marginTop: 3, fontWeight: 600 }}>Locked</div>
                    </div>
                  </div>
                );
              })()}

              <div className="glass-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
                <div style={{
                  padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'rgba(239,68,68,0.03)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 4, background: '#dc2626', color: '#fff' }}>
                      SELL ORDERS
                    </span>
                    <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Executed Sell Orders & Realised P&L Ledger
                    </h3>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                      Total Realised: <strong style={{ color: totalRealisedPnL >= 0 ? '#16a34a' : '#dc2626' }}>{totalRealisedPnL >= 0 ? '+' : ''}{fmtCurrency(totalRealisedPnL)}</strong>
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.1)', color: '#dc2626' }}>
                      {executedSells.length} positions closed
                    </span>
                  </div>
                </div>

                <div style={{ overflow: 'auto', maxHeight: '62vh', position: 'relative' }}>
                  <div style={{ minWidth: 900 }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '110px 170px 85px 110px 110px 130px 130px 90px 45px', gap: 10,
                      padding: '10px 16px', background: 'rgba(248,247,243,0.98)', borderBottom: '1px solid var(--border-subtle)',
                      fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
                      position: 'sticky', top: 0, zIndex: 2, backdropFilter: 'blur(8px)',
                    }}>
                      <div>Date</div>
                      <div>Stock Name</div>
                      <div>Qty Sold</div>
                      <div>Buy Price</div>
                      <div>Sales Price</div>
                      <div>Sales Value (₹)</div>
                      <div>Realised P&L (₹)</div>
                      <div>P&L %</div>
                      <div>Act</div>
                    </div>

                    {(() => {
                      const sellList = getSortedSellTransactions();

                      if (sellList.length === 0) {
                        return (
                          <div style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                            No Sell orders recorded yet. Click the <strong>"Sell"</strong> button on any active stock in the Working Portfolio or in the Buy table above to execute a sell order.
                          </div>
                        );
                      }

                      return sellList.map((tx) => {
                        const pnl = tx.realised_pnl || 0;
                        let buyPr = tx.buy_price && tx.buy_price > 0 ? tx.buy_price : 0;
                        if (!buyPr && tx.price > 0 && tx.quantity > 0 && pnl !== 0) {
                          buyPr = tx.price - (pnl / tx.quantity);
                        }
                        const pnlPct = buyPr > 0 ? ((tx.price - buyPr) / buyPr) * 100 : 0;
                        const salesVal = tx.total_value || (tx.price * tx.quantity);

                        return (
                          <div
                            key={tx.id}
                            style={{
                              display: 'grid', gridTemplateColumns: '110px 170px 85px 110px 110px 130px 130px 90px 45px', gap: 10,
                              alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)',
                              fontSize: 12.5,
                            }}
                          >
                            <div style={{ color: 'var(--text-secondary)' }}>
                              {new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </div>
                            <div style={{ fontWeight: 700, color: '#8c6314' }}>{cleanSymbol(tx)}</div>
                            <div className="tabular-nums">{tx.quantity.toLocaleString('en-IN')}</div>
                            <div className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                              {buyPr > 0 ? ('₹' + buyPr.toLocaleString('en-IN', { minimumFractionDigits: 2 })) : '—'}
                            </div>
                            <div className="tabular-nums" style={{ fontWeight: 600 }}>
                              ₹{tx.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>
                            <div className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                              {fmtCurrency(salesVal)}
                            </div>
                            <div className="tabular-nums" style={{ fontWeight: 700, color: pnl >= 0 ? '#16a34a' : '#dc2626' }}>
                              {pnl >= 0 ? '+' : ''}{fmtCurrency(pnl)}
                            </div>
                            <div>
                              <PnLBadge value={pnlPct} suffix="%" />
                            </div>
                            <div>
                              <button
                                onClick={() => setDeleteConfirmTx({ id: tx.id, symbol: cleanSymbol(tx) })}
                                style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 2 }}
                                title="Delete transaction record"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      )}
      {/* ══════════════════════════════════════════════════════════════════════
          TAB 4: CASH POSITION & DISCREPANCY RECONCILIATION
          ══════════════════════════════════════════════════════════════════════ */}
      {portfolioTab === 'cash' && (
        <section style={{ marginBottom: 'var(--space-10)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                Cash Position
              </h2>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'block', marginTop: 3 }}>
                Opening liquidity, trade cash flows, and free cash as on base date.
              </span>
            </div>

            <button
              onClick={() => setShowCashUpdateModal(true)}
              className="btn-glass-gold"
              style={{ padding: '7px 16px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Pencil size={13} /> Update Base Cash as on Date
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20, marginBottom: 24 }}>
            {/* ── Cash Position Master Card (2-Step Breakdown) ── */}
            <div className="glass-card" style={{ padding: '22px 26px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: '#8c6314', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Cash Position Master
                </h3>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: 'rgba(201,168,76,0.15)', color: '#8c6314' }}>
                  Base Date: {client.client_cash_base_date || client.onboarding_date || 'Not set'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

                {/* ── Opening Liquidity (Premium Glass) ── */}
                <div style={{
                  padding: '16px 18px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(255,251,235,0.88) 100%)',
                  backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)',
                  border: '1.5px solid rgba(201,168,76,0.28)',
                  boxShadow: '0 8px 24px rgba(201,168,76,0.12), inset 0 1px 1px rgba(255,255,255,0.95)',
                }}>
                  <div style={{ position: 'absolute', top: -18, right: -18, width: 56, height: 56, borderRadius: '50%', background: 'radial-gradient(circle, rgba(201,168,76,0.13) 0%, transparent 70%)' }} />
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#8c6314', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Wallet size={12} style={{ color: '#8c6314' }} /> Opening Liquidity
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>As on Base Date</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c9a84c' }} /> Base Cash (Brought In)</span>
                      <strong style={{ fontSize: 14, color: 'var(--text-primary)' }} className="tabular-nums">
                        {fmtCurrency(baseCash)}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} /> Liquid Cash (Parked in Funds)</span>
                      <strong style={{ fontSize: 14, color: 'var(--text-primary)' }} className="tabular-nums">
                        {fmtCurrency(parkedLiquid)}
                      </strong>
                    </div>
                    <div style={{ height: 1, background: 'rgba(201,168,76,0.22)', margin: '2px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, fontWeight: 800 }}>
                      <span style={{ color: '#8c6314' }}>Total Opening Liquidity</span>
                      <strong style={{ fontSize: 18, color: '#5c3e04' }} className="tabular-nums">
                        {fmtCurrency(totalOpening)}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* ── Trade Cash Flow + Free Cash (Premium Glass - Neutral) ── */}
                <div style={{
                  padding: '16px 18px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.90) 100%)',
                  backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)',
                  border: '1.5px solid rgba(148,163,184,0.22)',
                  boxShadow: '0 8px 24px rgba(148,163,184,0.10), inset 0 1px 1px rgba(255,255,255,0.95)',
                }}>
                  <div style={{ position: 'absolute', top: -18, right: -18, width: 56, height: 56, borderRadius: '50%', background: 'radial-gradient(circle, rgba(148,163,184,0.12) 0%, transparent 70%)' }} />
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <TrendingUp size={12} style={{ color: '#475569' }} /> Trade Cash Flow
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>After Base Date</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} /> New Buys ({postBaseDateBuys.length} trades)</span>
                      <strong style={{ fontSize: 14, color: '#dc2626' }} className="tabular-nums">
                        − {fmtCurrency(newBuysTotal)}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} /> New Sells ({postBaseDateSells.length} trades)</span>
                      <strong style={{ fontSize: 14, color: '#16a34a' }} className="tabular-nums">
                        + {fmtCurrency(newSellsTotal)}
                      </strong>
                    </div>
                    <div style={{ height: 1, background: 'rgba(148,163,184,0.18)', margin: '2px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, fontWeight: 800 }}>
                      <span style={{ color: '#475569' }}>Free Cash (Live)</span>
                      <strong style={{ fontSize: 18, color: projectedCash >= 0 ? '#065f46' : '#991b1b' }} className="tabular-nums">
                        {fmtCurrency(projectedCash)}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Ratios & Strategy Allocation — premium sync ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
                <div style={{
                  padding: '14px 16px', borderRadius: 14, position: 'relative', overflow: 'hidden',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(255,251,235,0.86) 100%)',
                  backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)',
                  border: '1.2px solid rgba(201,168,76,0.22)',
                  boxShadow: '0 6px 20px rgba(201,168,76,0.10), inset 0 1px 1px rgba(255,255,255,0.95)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                }}>
                  <div style={{ position: 'absolute', top: -14, right: -14, width: 44, height: 44, borderRadius: '50%', background: 'radial-gradient(circle, rgba(201,168,76,0.10) 0%, transparent 70%)' }} />
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#8c6314', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Free Cash to Portfolio Ratio</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }} className="tabular-nums">
                    {freeCashRatio.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Cash weight in overall portfolio</div>
                </div>

                <div style={{
                  padding: '14px 16px', borderRadius: 14, position: 'relative', overflow: 'hidden',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.90) 100%)',
                  backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)',
                  border: '1.2px solid rgba(148,163,184,0.20)',
                  boxShadow: '0 6px 20px rgba(148,163,184,0.08), inset 0 1px 1px rgba(255,255,255,0.95)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                }}>
                  <div style={{ position: 'absolute', top: -14, right: -14, width: 44, height: 44, borderRadius: '50%', background: 'radial-gradient(circle, rgba(148,163,184,0.08) 0%, transparent 70%)' }} />
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Strategy Allocation</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 4 }} className="tabular-nums">
                      Long-Term: <strong style={{ color: 'var(--text-primary)' }}>{fmtCurrencyKPI(longTermCash)}</strong> <span style={{ color: 'var(--text-muted)', fontWeight: 500, margin: '0 4px' }}>|</span> Momentum: <strong style={{ color: 'var(--text-primary)' }}>{fmtCurrencyKPI(momentumCash)}</strong>
                    </div>
                  </div>
                  <button
                    onClick={openStrategyModal}
                    className="btn-glass-light"
                    style={{ flexShrink: 0, padding: '6px 12px', fontSize: 11, fontWeight: 700, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 5, color: '#475569', border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(255,255,255,0.75)' }}
                    title="Edit Strategy Allocation"
                  >
                    <Pencil size={11} /> Edit
                  </button>
                </div>
              </div>
            </div>

            {/* ── Discrepancy Audit & Reconciliation — HIDDEN (Internal Use) ── */}
            {false && (
              <div className="glass-card" style={{ padding: '22px 26px' }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Discrepancy Audit & Reconciliation
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                      Client Reported Cash Date:
                    </label>
                    <input type="date" value={reportedCashDate} onChange={e => setReportedCashDate(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: 12.5, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                      Actual Cash Balance Reported by Client (₹):
                    </label>
                    <input type="number" value={reportedCashAmount} onChange={e => setReportedCashAmount(e.target.value)} placeholder="e.g. 26000" style={{ width: '100%', padding: '6px 10px', fontSize: 13, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
                  </div>
                  {reportedCashAmount.trim() !== '' && (
                    <div style={{ padding: '10px 14px', borderRadius: 8, background: differEstimate !== 0 ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)', border: '1px solid ' + (differEstimate !== 0 ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)') }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: differEstimate !== 0 ? '#dc2626' : '#16a34a' }}>Differ Estimate (Variance):</span>
                        <strong style={{ fontSize: 15, color: differEstimate !== 0 ? '#dc2626' : '#16a34a' }}>
                          {differEstimate !== 0 ? ('₹' + Math.abs(differEstimate).toLocaleString('en-IN') + ' discrepancy') : 'Fully Reconciled (₹0)'}
                        </strong>
                      </div>
                    </div>
                  )}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                      Reason for Discrepancy / Variance:
                    </label>
                    <textarea rows={2} value={reconReason} onChange={e => setReconReason(e.target.value)} placeholder="e.g. Client withdrew ₹46,000 for personal use" style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none' }} />
                  </div>
                  <button onClick={saveAuditReconciliation} disabled={savingReconReason} className="btn-glass-gold" style={{ width: '100%', padding: '8px', fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                    {savingReconReason ? 'Saving Audit Trail...' : 'Save Reconciliation Audit'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Parked Liquid Holdings Table */}
          {liquidHoldings.length > 0 && (
            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  Parked Liquid ETF Holdings ({liquidHoldings.length} scrips)
                </h3>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 600 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '160px 120px 120px 140px 120px', gap: 10, padding: '10px 16px', background: 'rgba(0,0,0,0.03)', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    <div>Scrip</div>
                    <div>Quantity</div>
                    <div>Avg Buy</div>
                    <div>Current Val</div>
                    <div>Unreal P&L</div>
                  </div>
                  {liquidHoldings.map((lh) => (
                    <div key={lh.id} style={{ display: 'grid', gridTemplateColumns: '160px 120px 120px 140px 120px', gap: 10, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)', fontSize: 12.5 }}>
                      <div style={{ fontWeight: 700, color: '#8c6314' }}>{cleanSymbol(lh)}</div>
                      <div className="tabular-nums">{lh.quantity.toLocaleString('en-IN')}</div>
                      <div className="tabular-nums">₹{lh.buy_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                      <div className="tabular-nums" style={{ fontWeight: 600 }}>{fmtCurrency(lh.current_value || lh.buy_price * lh.quantity)}</div>
                      <div className="tabular-nums" style={{ color: lh.unrealised_pnl >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                        {lh.unrealised_pnl >= 0 ? '+' : ''}{fmtCurrency(lh.unrealised_pnl)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
           )}

          {/* ── Cash Ledger — Base Cash Update History (premium sync) ── */}
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.55)' }}>
              <h3 style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c9a84c', display: 'inline-block' }} />
                Cash Ledger — Base Cash History
              </h3>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#8c6314', background: 'rgba(201,168,76,0.12)', padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(201,168,76,0.18)' }}>
                {(client as any)?.cash_history?.length || 0} updates
              </span>
            </div>
            {(client as any)?.cash_history && (client as any).cash_history.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 860 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 105px 105px 105px 110px 110px 110px 115px', gap: 10, padding: '10px 16px', background: 'rgba(0,0,0,0.03)', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    <div>Updated On</div>
                    <div>As on Date</div>
                    <div>Cash</div>
                    <div>Liquid</div>
                    <div>Total Opening</div>
                    <div>Buy Amount</div>
                    <div>Sell Amount</div>
                    <div>Total Free Cash</div>
                  </div>
                  {[...(client as any).cash_history].reverse().map((entry: any) => (
                    <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '140px 105px 105px 105px 110px 110px 110px 115px', gap: 10, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)', fontSize: 12.5 }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {new Date(entry.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div style={{ fontWeight: 600, color: '#8c6314' }}>{entry.base_date ? new Date(entry.base_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</div>
                      <div className="tabular-nums" style={{ fontWeight: 600 }}>{fmtCurrency(entry.cash || 0)}</div>
                      <div className="tabular-nums" style={{ fontWeight: 600 }}>{fmtCurrency(entry.liquid || 0)}</div>
                      <div className="tabular-nums" style={{ fontWeight: 700 }}>{fmtCurrency(entry.total || 0)}</div>
                      <div className="tabular-nums" style={{ fontWeight: 600, color: '#dc2626' }}>{fmtCurrency(entry.buy_amount || 0)}</div>
                      <div className="tabular-nums" style={{ fontWeight: 600, color: '#16a34a' }}>{fmtCurrency(entry.sell_amount || 0)}</div>
                      <div className="tabular-nums" style={{ fontWeight: 800, color: ((entry.projected ?? entry.total) >= 0) ? '#15803d' : '#dc2626' }}>{fmtCurrency((entry.projected ?? entry.total) || 0)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No base cash updates yet. Jab bhi base cash update karoge, yahan ledger mein entry aati rahegi — pura history yahan dikhega.
              </div>
            )}
          </div>
         </section>
       )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODALS (Portaled via createPortal)
          ══════════════════════════════════════════════════════════════════════ */}

      
      {/* 2. Edit Holding Modal (Client Portfolio) */}
      {editingHoldingModal && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setEditingHoldingModal(null); }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 14, width: '100%', maxWidth: 420, boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Pencil size={16} color="#8c6314" /> Edit Holding — {editModalSymbol}
              </h3>
              <button onClick={() => setEditingHoldingModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><XIcon size={18} /></button>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>NSE / BSE Symbol *</label>
                <input value={editModalSymbol} onChange={e => setEditModalSymbol(e.target.value.toUpperCase())} placeholder="e.g. RELIANCE" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Quantity *</label>
                  <input type="number" value={editModalQty} onChange={e => setEditModalQty(e.target.value)} placeholder="0" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Buy Price (₹) *</label>
                  <input type="number" value={editModalPrice} onChange={e => setEditModalPrice(e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Position Source</label>
                <select value={editModalSource} onChange={e => setEditModalSource(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }}>
                  <option value="Existing">Existing (Client Baseline)</option>
                  <option value="Fresh">Fresh (Added during service)</option>
                </select>
              </div>

              {editModalQty && editModalPrice && parseFloat(editModalQty) > 0 && parseFloat(editModalPrice) > 0 && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(201,168,76,0.1)', color: '#8c6314', fontSize: 12.5, fontWeight: 700 }}>
                  Total Invested: ₹{Math.round(parseFloat(editModalQty) * parseFloat(editModalPrice)).toLocaleString('en-IN')}
                </div>
              )}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setEditingHoldingModal(null)} style={{ padding: '7px 16px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSaveEditHolding} disabled={savingEditHolding || !editModalSymbol.trim() || !editModalQty || !editModalPrice} className="btn-glass-gold" style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700 }}>
                {savingEditHolding ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      
      {/* ── UNIFIED UPDATE CLIENT PORTFOLIO WIZARD MODAL ─────────────────── */}
      {showUpdateWizardModal && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowUpdateWizardModal(false); }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 16, width: '100%', maxWidth: 540, boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(201,168,76,0.06)' }}>
              <div>
                <h3 style={{ fontSize: 16.5, fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={17} color="#8c6314" /> Update Client Portfolio
                </h3>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {client.name} — Select an update method with statement receipt date.
                </span>
              </div>
              <button onClick={() => setShowUpdateWizardModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><XIcon size={18} /></button>
            </div>

            <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '80vh', overflowY: 'auto' }}>
              {/* Step 1: Mandatory Portfolio Date */}
              <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-subtle)' }}>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: '#8c6314', textTransform: 'uppercase', marginBottom: 4 }}>
                  1. Portfolio Statement Date (As on Date) *
                </label>
                <input
                  type="date"
                  value={wizardDate}
                  onChange={e => setWizardDate(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}
                />
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', display: 'block', marginTop: 3 }}>
                  Specify the date when this portfolio was received from the client.
                </span>
              </div>

              {/* Step 2: 3 Update Modes (Radio Cards) */}
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>
                  2. Choose Update Mode *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {[
                    { id: 'full_upload', icon: '📁', title: 'Full Excel Upload', desc: 'Replace full statement' },
                    { id: 'add_stock', icon: '➕', title: 'Add Stock', desc: 'Add 1 new stock' },
                    { id: 'edit_holding', icon: '✏️', title: 'Edit / Delete', desc: 'Modify existing scrip' },
                  ].map(mode => (
                    <div
                      key={mode.id}
                      onClick={() => setWizardMode(mode.id as any)}
                      style={{
                        padding: '12px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                        border: `1.5px solid ${wizardMode === mode.id ? '#8c6314' : 'var(--border-subtle)'}`,
                        background: wizardMode === mode.id ? 'rgba(201,168,76,0.12)' : 'rgba(0,0,0,0.02)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontSize: 18 }}>{mode.icon}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: wizardMode === mode.id ? '#8c6314' : 'var(--text-primary)', marginTop: 4 }}>
                        {mode.title}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{mode.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 3: Mode-Specific Form Body */}
              {wizardMode === 'full_upload' && (
                <div style={{ padding: '16px', borderRadius: 10, background: 'rgba(201,168,76,0.04)', border: '1px dashed var(--gold-border)', textAlign: 'center' }}>
                  <Upload size={28} color="#8c6314" style={{ margin: '0 auto 8px', display: 'block' }} />
                  <h4 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                    Upload New Broker / CAMS Statement
                  </h4>
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px' }}>
                    This will replace the client's current baseline portfolio with the parsed file for date <strong>{wizardDate}</strong>.
                  </p>
                  <button
                    onClick={async () => {
                      if (id) {
                        await updateDoc(doc(db, 'clients', id), { client_portfolio_date: wizardDate });
                      }
                      setShowUpdateWizardModal(false);
                      setShowUploadModal(true);
                    }}
                    className="btn-glass-gold"
                    style={{ padding: '8px 20px', fontSize: 12, fontWeight: 800 }}
                  >
                    Open Statement Parser & Upload File
                  </button>
                </div>
              )}

              {wizardMode === 'add_stock' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px', borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>NSE / BSE Stock Symbol *</label>
                    <input
                      value={wizardStockSymbol}
                      onChange={e => setWizardStockSymbol(e.target.value.toUpperCase())}
                      placeholder="e.g. RELIANCE / HDFCBANK"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>Quantity *</label>
                      <input
                        type="number"
                        value={wizardStockQty}
                        onChange={e => setWizardStockQty(e.target.value)}
                        placeholder="0"
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>Buy Price (₹) *</label>
                      <input
                        type="number"
                        value={wizardStockPrice}
                        onChange={e => setWizardStockPrice(e.target.value)}
                        placeholder="0.00"
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }}
                      />
                    </div>
                  </div>

                  {wizardStockQty && wizardStockPrice && parseFloat(wizardStockQty) > 0 && parseFloat(wizardStockPrice) > 0 && (
                    <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(201,168,76,0.1)', color: '#8c6314', fontSize: 12, fontWeight: 700 }}>
                      Invested Total: ₹{Math.round(parseFloat(wizardStockQty) * parseFloat(wizardStockPrice)).toLocaleString('en-IN')}
                    </div>
                  )}

                  <button
                    onClick={handleSaveWizardAddStock}
                    disabled={savingWizard || !wizardStockSymbol.trim() || !wizardStockQty || !wizardStockPrice}
                    className="btn-glass-gold"
                    style={{ width: '100%', padding: '9px', fontSize: 12.5, fontWeight: 800, marginTop: 4 }}
                  >
                    {savingWizard ? 'Saving...' : 'Add Stock to Client Baseline'}
                  </button>
                </div>
              )}

              {wizardMode === 'edit_holding' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px', borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>Select Holding to Modify *</label>
                    <select
                      value={wizardSelectedHoldingId}
                      onChange={e => handleWizardSelectHolding(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 600 }}
                    >
                      {clientHoldings.length === 0 ? (
                        <option value="">No holdings available</option>
                      ) : (
                        clientHoldings.map(h => (
                          <option key={h.id} value={h.id}>
                            {cleanSymbol(h)} ({h.quantity} shares @ ₹{h.buy_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  {wizardSelectedHoldingId && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>Quantity *</label>
                          <input
                            type="number"
                            value={wizardEditQty}
                            onChange={e => setWizardEditQty(e.target.value)}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>Buy Price (₹) *</label>
                          <input
                            type="number"
                            value={wizardEditPrice}
                            onChange={e => setWizardEditPrice(e.target.value)}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                        <button
                          onClick={handleSaveWizardEditHolding}
                          disabled={savingWizard || !wizardEditQty || !wizardEditPrice}
                          className="btn-glass-gold"
                          style={{ flex: 1, padding: '9px', fontSize: 12, fontWeight: 800 }}
                        >
                          {savingWizard ? 'Saving...' : 'Save Holding Changes'}
                        </button>
                        <button
                          onClick={handleSaveWizardDeleteHolding}
                          disabled={savingWizard}
                          className="btn-glass-red"
                          style={{ padding: '9px 14px', fontSize: 12, fontWeight: 700 }}
                          title="Delete this holding from baseline"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.01)' }}>
              <button
                onClick={() => setShowUpdateWizardModal(false)}
                style={{ padding: '7px 16px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}
              >
                Close Wizard
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 1. Add Stock Modal */}
      {showAddStockModal && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowAddStockModal(false); }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 14, width: '100%', maxWidth: 420, boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                Add Holding to Client Portfolio
              </h3>
              <button onClick={() => setShowAddStockModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><XIcon size={18} /></button>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>NSE / BSE Symbol *</label>
                <input value={stockSymbolInput} onChange={e => setStockSymbolInput(e.target.value.toUpperCase())} placeholder="e.g. RELIANCE" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Quantity *</label>
                  <input type="number" value={stockQtyInput} onChange={e => setStockQtyInput(e.target.value)} placeholder="0" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Buy Price (₹) *</label>
                  <input type="number" value={stockPriceInput} onChange={e => setStockPriceInput(e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setShowAddStockModal(false)} style={{ padding: '7px 16px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleAddStock} disabled={savingStock || !stockSymbolInput.trim() || !stockQtyInput || !stockPriceInput} className="btn-glass-gold" style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700 }}>
                {savingStock ? 'Saving...' : 'Add Holding'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 2. New Recommendation Modal (Tab 3) */}
      {showNewRecoModal && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowNewRecoModal(false); }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                Add New Transaction
              </h3>
              <button onClick={() => setShowNewRecoModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><XIcon size={18} /></button>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Date *</label>
                  <input type="date" value={recoDate} onChange={e => setRecoDate(e.target.value)} style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Action Type *</label>
                  <select value={recoType} onChange={e => setRecoType(e.target.value as any)} style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }}>
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Stock Symbol *</label>
                <input value={recoSymbol} onChange={e => setRecoSymbol(e.target.value.toUpperCase())} placeholder="e.g. PAYTM / RADICO" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Reco Price (₹) *</label>
                  <input type="number" value={recoPrice} onChange={e => setRecoPrice(e.target.value)} placeholder="e.g. 1695" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Quantity *</label>
                  <input type="number" value={recoQty} onChange={e => setRecoQty(e.target.value)} placeholder="10" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Range Min (₹)</label>
                  <input type="number" value={recoRangeMin} onChange={e => setRecoRangeMin(e.target.value)} placeholder="1650" style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Range Max (₹)</label>
                  <input type="number" value={recoRangeMax} onChange={e => setRecoRangeMax(e.target.value)} placeholder="1750" style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Status *</label>
                <select value={recoStatus} onChange={e => setRecoStatus(e.target.value as any)} style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }}>
                  <option value="Executed">Executed</option>
                  <option value="Avoid">Avoid</option>
                </select>
              </div>

              {recoPrice && recoQty && (
                <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(201,168,76,0.1)', color: '#8c6314', fontSize: 12.5, fontWeight: 700 }}>
                  Order Total: ₹{Math.round(parseFloat(recoPrice) * parseFloat(recoQty)).toLocaleString('en-IN')}
                </div>
              )}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setShowNewRecoModal(false)} style={{ padding: '7px 16px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSaveRecommendation} disabled={savingReco || !recoSymbol.trim() || !recoPrice || !recoQty} className="btn-glass-gold" style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700 }}>
                {savingReco ? 'Saving...' : 'Confirm Recommendation'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      
      {/* 6. Strategy Cash Allocation Modal */}
      {showStrategyModal && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowStrategyModal(false); }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 14, width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#2563eb', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Pencil size={16} /> Strategy Cash Allocation
                </h3>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Free Cash: ₹{projectedCash.toLocaleString('en-IN')}</span>
              </div>
              <button onClick={() => setShowStrategyModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><XIcon size={18} /></button>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Momentum Cash Allocation (₹) <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(Isolated Strategy Allocation)</span>
                </label>
                <input
                  type="number"
                  value={strategyMomentumInput}
                  onChange={e => setStrategyMomentumInput(e.target.value)}
                  placeholder="0"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}
                />
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  Momentum cash is isolated and tracked independently without subtracting from Base Free Cash.
                </div>
              </div>

              {/* Quick % Chips for Momentum */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Quick Split:</span>
                {[0, 10, 20, 30, 50].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      const mom = Math.round((projectedCash * pct) / 100);
                      setStrategyMomentumInput(String(mom));
                    }}
                    style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', color: '#2563eb', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {pct}%
                  </button>
                ))}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Long-Term Cash Allocation (₹)
                </label>
                <input
                  type="number"
                  value={strategyLongInput}
                  onChange={e => setStrategyLongInput(e.target.value)}
                  placeholder="0"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}
                />
              </div>

              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(59,130,246,0.06)', fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Long-Term Cash:</span>
                  <strong>₹{(parseFloat(strategyLongInput) || 0).toLocaleString('en-IN')}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span>Momentum Cash (Isolated):</span>
                  <strong>₹{(parseFloat(strategyMomentumInput) || 0).toLocaleString('en-IN')}</strong>
                </div>
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setShowStrategyModal(false)} style={{ padding: '7px 16px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleSaveStrategyAllocation}
                disabled={savingStrategy}
                className="btn-glass-gold"
                style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700 }}
              >
                {savingStrategy ? 'Saving...' : 'Save Strategy Allocation'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 3. Update Base Cash & Liquid Modal (Tab 4) */}
      {showCashUpdateModal && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowCashUpdateModal(false); }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 14, width: '100%', maxWidth: 420, boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                Update Starting Cash Position
              </h3>
              <button onClick={() => setShowCashUpdateModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><XIcon size={18} /></button>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Base Cash Date (DD/MM/YYYY) *</label>
                <input type="date" value={cashBaseDateInput} onChange={e => setCashBaseDateInput(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Client Cash Brought In (₹) *</label>
                <input type="number" value={cashBaseAmountInput} onChange={e => setCashBaseAmountInput(e.target.value)} placeholder="120000" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Cash Parked in Liquid Funds (₹)</label>
                <input type="number" value={cashParkedLiquidInput} onChange={e => setCashParkedLiquidInput(e.target.value)} placeholder="0" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setShowCashUpdateModal(false)} style={{ padding: '7px 16px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveCashBaseSettings} disabled={savingCashBase || !cashBaseAmountInput} className="btn-glass-gold" style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700 }}>
                {savingCashBase ? 'Saving...' : 'Save Cash Ledger'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 4. Sell Stock Modal */}
      {sellModalData && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setSellModalData(null); }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#dc2626', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Sell Holding — {sellModalData.stockSymbol}
                </h3>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sellModalData.companyName}</span>
              </div>
              <button onClick={() => setSellModalData(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><XIcon size={18} /></button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Position Info Banner */}
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-subtle)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Available Holding</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
                    {sellModalData.maxQty.toLocaleString('en-IN')} shares
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Avg Buy: ₹{sellModalData.avgBuyPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current CMP</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#2563eb', marginTop: 2 }}>
                    ₹{sellModalData.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Live market price</div>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Selling Date *</label>
                <input type="date" value={sellDateInput} onChange={e => setSellDateInput(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Quantity to Sell *</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[
                      { label: '25%', q: Math.max(1, Math.floor(sellModalData.maxQty * 0.25)) },
                      { label: '50%', q: Math.max(1, Math.floor(sellModalData.maxQty * 0.5)) },
                      { label: '100%', q: sellModalData.maxQty },
                    ].map(chip => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => setSellQtyInput(String(chip.q))}
                        style={{ padding: '2px 6px', fontSize: 10.5, fontWeight: 700, borderRadius: 4, border: '1px solid var(--border-default)', background: 'rgba(0,0,0,0.04)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="number"
                  value={sellQtyInput}
                  onChange={e => setSellQtyInput(e.target.value)}
                  placeholder={`Max ${sellModalData.maxQty}`}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Selling Price (₹) *</label>
                <input
                  type="number"
                  value={sellPriceInput}
                  onChange={e => setSellPriceInput(e.target.value)}
                  placeholder="e.g. 1540"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13 }}
                />
              </div>

              {/* Live Realised P&L Preview */}
              {sellPriceInput && sellQtyInput && parseFloat(sellQtyInput) > 0 && parseFloat(sellPriceInput) > 0 && (() => {
                const sPrice = parseFloat(sellPriceInput);
                const sQty = parseFloat(sellQtyInput);
                const salesVal = sPrice * sQty;
                const costVal = sellModalData.avgBuyPrice * sQty;
                const pnl = salesVal - costVal;
                const pnlPct = costVal > 0 ? (pnl / costVal) * 100 : 0;
                const isProfitable = pnl >= 0;

                return (
                  <div style={{
                    padding: '12px 14px', borderRadius: 8,
                    background: isProfitable ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                    border: `1px solid ${isProfitable ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Sales Proceeds:</span>
                      <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{fmtCurrency(salesVal)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: isProfitable ? '#16a34a' : '#dc2626' }}>Realised P&L:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong style={{ fontSize: 15, color: isProfitable ? '#16a34a' : '#dc2626' }}>
                          {isProfitable ? '+' : ''}{fmtCurrency(pnl)}
                        </strong>
                        <PnLBadge value={pnlPct} suffix="%" />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setSellModalData(null)} style={{ padding: '7px 16px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleConfirmSell}
                disabled={savingSell || !sellPriceInput || !sellQtyInput}
                className="btn-glass-red"
                style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700 }}
              >
                {savingSell ? 'Executing Sell...' : 'Execute SELL Order'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 5. Centered Delete Holding Confirmation Modal */}
      {deleteConfirmHolding && createPortal(
        <div className="glass-modal-backdrop animate-fade-in" style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div className="glass-modal animate-scale-up" style={{
            maxWidth: 420, width: '100%', padding: '30px 28px 26px',
            textAlign: 'center', borderRadius: 22,
            background: '#ffffff',
            border: 'none',
            boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
          }}>
            <div style={{
              width: 54, height: 54, borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#dc2626',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Trash2 size={26} />
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              Delete Holding?
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 24px' }}>
              Are you sure you want to remove <strong style={{ color: '#8c6314' }}>{deleteConfirmHolding.symbol}</strong> from this client's baseline portfolio?
            </p>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setDeleteConfirmHolding(null)}
                disabled={isDeletingHolding}
                className="btn-glass-light"
                style={{ flex: 1, padding: '10px 18px', fontSize: 13.5 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!deleteConfirmHolding) return;
                  setIsDeletingHolding(true);
                  try {
                    await deleteDoc(doc(db, 'holdings', deleteConfirmHolding.id));
                    setDeleteConfirmHolding(null);
                    await load();
                  } catch (err) {
                    console.error('Failed to delete holding:', err);
                    alert('Failed to delete holding');
                  } finally {
                    setIsDeletingHolding(false);
                  }
                }}
                disabled={isDeletingHolding}
                className="btn-glass-red"
                style={{ flex: 1, padding: '10px 18px', fontSize: 13.5, fontWeight: 700 }}
              >
                {isDeletingHolding ? 'Deleting…' : 'Delete Holding'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 5b. Centered Delete Transaction Confirmation Modal */}
      {deleteConfirmTx && createPortal(
        <div className="glass-modal-backdrop animate-fade-in" style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div className="glass-modal animate-scale-up" style={{
            maxWidth: 420, width: '100%', padding: '30px 28px 26px',
            textAlign: 'center', borderRadius: 22,
            background: '#ffffff',
            border: 'none',
            boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
          }}>
            <div style={{
              width: 54, height: 54, borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#dc2626',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Trash2 size={26} />
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              Delete Transaction Record?
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 24px' }}>
              Are you sure you want to remove the recommendation / trade record for <strong style={{ color: '#8c6314' }}>{deleteConfirmTx.symbol}</strong> from the trade ledger?
            </p>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setDeleteConfirmTx(null)}
                disabled={isDeletingTx}
                className="btn-glass-light"
                style={{ flex: 1, padding: '10px 18px', fontSize: 13.5 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTransaction}
                disabled={isDeletingTx}
                className="btn-glass-red"
                style={{ flex: 1, padding: '10px 18px', fontSize: 13.5, fontWeight: 700 }}
              >
                {isDeletingTx ? 'Deleting…' : 'Delete Record'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 6. Full Statement Parser Modal */}
      {showUploadModal && client && (
        <AddClientModal
          existingClient={client}
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => {
            setShowUploadModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}
