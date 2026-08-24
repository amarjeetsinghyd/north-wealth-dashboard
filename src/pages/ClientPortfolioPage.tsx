import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, IndianRupee, TrendingUp, TrendingDown, ChartBar as BarChart3, CircleAlert as AlertCircle, Pencil, Check, X as XIcon, Wallet, Landmark, Download, Upload, PlusCircle, Trash2 } from 'lucide-react';
import { fetchClient, fetchHoldings, fetchTransactions } from '../lib/queries';
import { doc, updateDoc, addDoc, collection, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Client, Holding, Transaction, PortfolioSummary } from '../types';
import { AddClientModal } from '../components/AddClientModal';
import { SummaryCard } from '../components/SummaryCard';
import { PnLBadge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { getStockMeta, cleanSymbol } from '../lib/sectorMap';

function fmtCurrency(v: number) {
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtCurrencyKPI(v: number) {
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

type SortColumn = 'scrip' | 'sector' | 'marketCap' | 'qty' | 'buy_price' | 'current_price' | 'invested_amount' | 'current_value' | 'unrealised_pnl' | 'unrealised_pnl_pct' | 'alloc' | 'source' | 'purchase_date' | null;
type SortOrder = 'asc' | 'desc';
type TxSortColumn = 'date' | 'stock_symbol' | 'action' | 'quantity' | 'price' | 'total_value' | null;

export function ClientPortfolioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Rebalance & Inline Actions
  const [isRebalanceMode, setIsRebalanceMode] = useState(false);
  const [sellModalData, setSellModalData] = useState<{ holding: Holding, sellPrice: string, quantity: string } | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [nseSymbol, setNseSymbol] = useState('');
  const [buyQuantity, setBuyQuantity] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [savingTransaction, setSavingTransaction] = useState(false);
  
  // Upload Statement Modal
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Total Capital & Cash Balance
  const [totalCapital, setTotalCapital] = useState<number>(0);
  const [totalCapitalInput, setTotalCapitalInput] = useState<string>('');
  const [editingCapital, setEditingCapital] = useState(false);
  const [savingCapital, setSavingCapital] = useState(false);
  
  const [mutualFunds, setMutualFunds] = useState<number>(0);
  const [mutualFundsInput, setMutualFundsInput] = useState<string>('');
  const [editingMutualFunds, setEditingMutualFunds] = useState(false);
  const [savingMutualFunds, setSavingMutualFunds] = useState(false);
  
  // Date / Billing editing
  const [editingDate, setEditingDate] = useState(false);
  const [newDate, setNewDate] = useState('');
  
  // Asset Allocation editing
  const [isEditingAllocation, setIsEditingAllocation] = useState(false);
  const [allocationInputs, setAllocationInputs] = useState({ equity: '', mf: '', cash: '' });
  const [savingAllocation, setSavingAllocation] = useState(false);
  
  // ── 4-Tab Portfolio & Transaction View States ────────────────────────────
  const [portfolioTab, setPortfolioTab] = useState<'actual' | 'estimated' | 'fresh_tx' | 'cash'>('estimated');
  const [txTab, setTxTab] = useState<'all' | 'buy' | 'sell'>('buy');
  const [reconciliationReason, setReconciliationReason] = useState('');
  const [isEditingReconReason, setIsEditingReconReason] = useState(false);
  const [savingReconReason, setSavingReconReason] = useState(false);

  const [auaBreachReason, setAuaBreachReason] = useState('');
  const [isEditingAuaReason, setIsEditingAuaReason] = useState(false);
  const [savingAuaReason, setSavingAuaReason] = useState(false);

  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [stockSearch, setStockSearch] = useState('');
  const [txSortColumn, setTxSortColumn] = useState<TxSortColumn>('date');
  const [txSortOrder, setTxSortOrder] = useState<SortOrder>('desc');
  const [txStockSearch, setTxStockSearch] = useState('');

  const [editingBuyPrice, setEditingBuyPrice] = useState<string | null>(null);
  const [editBuyPriceVal, setEditBuyPriceVal] = useState('');
  
  const [editingHoldingSource, setEditingHoldingSource] = useState<string | null>(null);
  const [editingHoldingDate, setEditingHoldingDate] = useState<string | null>(null);
  const [editingTxDate, setEditingTxDate] = useState<string | null>(null);

  const [sectorFilter, setSectorFilter] = useState<string>('');
  const [mcapFilter, setMcapFilter] = useState<string>('');

  const uniqueSectors = Array.from(new Set(holdings.map(h => getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '').sector))).filter(Boolean).sort();
  const uniqueMCaps = Array.from(new Set(holdings.map(h => getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '').marketCap))).filter(Boolean).sort();
  const [savingBuyPrice, setSavingBuyPrice] = useState(false);

  const [editingScrip, setEditingScrip] = useState<string | null>(null);
  const [editScripVal, setEditScripVal] = useState('');
  const [savingScrip, setSavingScrip] = useState(false);




  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, h, tx] = await Promise.all([
        fetchClient(id),
        fetchHoldings(id),
        fetchTransactions(id),
      ]);
      setClient(c);
      setTotalCapital(c?.total_capital || 0);
      setMutualFunds(c?.mutual_funds || 0);
      setHoldings(h);
      setTransactions(tx);
    } catch (err) {
      console.warn('Error loading portfolio data:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  }, [load]);

  // ── Auto-reload holdings when global "Refresh All Prices" completes ─────────
  // Layout.tsx dispatches 'nw:prices-refreshed' after a successful global refresh.
  // This makes the current client's page update instantly without a manual reload.
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

  useEffect(() => {
    if (client) {
      setReconciliationReason((client as any).cash_difference_reason || '');
      setAuaBreachReason((client as any).aua_breach_reason || '');
    }
  }, [client]);

  const saveReconReason = async () => {
    if (!id) return;
    setSavingReconReason(true);
    try {
      await updateDoc(doc(db, 'clients', id), { cash_difference_reason: reconciliationReason });
      setIsEditingReconReason(false);
    } catch (e) {
      console.error(e);
      alert('Failed to save reason');
    } finally {
      setSavingReconReason(false);
    }
  };

  const saveAuaReason = async () => {
    if (!id) return;
    setSavingAuaReason(true);
    try {
      await updateDoc(doc(db, 'clients', id), { aua_breach_reason: auaBreachReason });
      setIsEditingAuaReason(false);
    } catch (e) {
      console.error(e);
      alert('Failed to save reason');
    } finally {
      setSavingAuaReason(false);
    }
  };

  const syncBaseCashToEstimated = async (newAmount: number) => {
    if (!id) return;
    if (!window.confirm(`Sync Base Free Cash to ₹${newAmount.toLocaleString('en-IN')}?`)) return;
    try {
      await updateDoc(doc(db, 'clients', id), { asset_free_cash: newAmount });
      await load();
    } catch (e) {
      console.error(e);
      alert('Failed to sync cash');
    }
  };

  const actualHoldings = useMemo(() => {
    return holdings.filter((h: Holding) => h.source === 'Existing' || !h.source);
  }, [holdings]);

  const tabHoldings = useMemo(() => {
    if (portfolioTab === 'actual') {
      return actualHoldings;
    }
    return holdings;
  }, [holdings, actualHoldings, portfolioTab]);

  const handleDownloadExcel = () => {
    import('xlsx').then((XLSX) => {
      const dataToExport = getSortedHoldings().map((h: Holding, idx: number) => {
        const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
        const summaryCurrentValue = holdings.reduce((sum: number, hold: Holding) => sum + (hold.current_value || hold.buy_price * hold.quantity), 0);
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
    let filtered = tabHoldings;
    if (sectorFilter) {
      filtered = filtered.filter((h: Holding) => {
        const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
        return meta.sector === sectorFilter;
      });
    }
    if (mcapFilter) {
      filtered = filtered.filter((h: Holding) => {
        const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
        return meta.marketCap === mcapFilter;
      });
    }
    if (stockSearch) {
      const s = stockSearch.toLowerCase();
      filtered = filtered.filter((h: Holding) => 
        h.stock_symbol.toLowerCase().includes(s) || 
        (h.company_name && h.company_name.toLowerCase().includes(s)) ||
        (h.nse_symbol && h.nse_symbol.toLowerCase().includes(s))
      );
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

      if (sortColumn === 'source') {
        return sortOrder === 'asc' ? (a.source || '').localeCompare(b.source || '') : (b.source || '').localeCompare(a.source || '');
      }
      if (sortColumn === 'purchase_date') {
        return sortOrder === 'asc' ? (a.purchase_date || '').localeCompare(b.purchase_date || '') : (b.purchase_date || '').localeCompare(a.purchase_date || '');
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

  const getSortedTransactions = () => {
    let filtered = transactions;
    if (txTab === 'buy') {
      filtered = filtered.filter(tx => tx.action === 'BUY');
    } else if (txTab === 'sell') {
      filtered = filtered.filter(tx => tx.action === 'SELL');
    }
    if (txStockSearch) {
      const s = txStockSearch.toLowerCase();
      filtered = filtered.filter(tx => 
        tx.stock_symbol.toLowerCase().includes(s) || 
        (tx.company_name && tx.company_name.toLowerCase().includes(s))
      );
    }
    if (!txSortColumn) return filtered;
    return [...filtered].sort((a, b) => {
      const aVal = a[txSortColumn];
      const bVal = b[txSortColumn];
      if (txSortColumn === 'date' || txSortColumn === 'stock_symbol' || txSortColumn === 'action') {
        return txSortOrder === 'asc' ? String(aVal ?? '').localeCompare(String(bVal ?? '')) : String(bVal ?? '').localeCompare(String(aVal ?? ''));
      }
      return txSortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
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

  const saveAllocation = async () => {
    if (!id || !client) return;
    setSavingAllocation(true);
    try {
      const updates: Record<string, number | null> = {};
      if (allocationInputs.equity.trim() !== '') updates.asset_equity = parseFloat(allocationInputs.equity);
      else updates.asset_equity = null;
      
      if (allocationInputs.mf.trim() !== '') updates.asset_mutual_funds = parseFloat(allocationInputs.mf);
      else updates.asset_mutual_funds = null;
      
      if (allocationInputs.cash.trim() !== '') updates.asset_free_cash = parseFloat(allocationInputs.cash);
      else updates.asset_free_cash = null;

      await updateDoc(doc(db, 'clients', id), updates);
      setIsEditingAllocation(false);
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to save allocation values');
    } finally {
      setSavingAllocation(false);
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


  const saveScrip = async (holdingId: string) => {
    const newSymbol = editScripVal.trim().toUpperCase();
    if (!newSymbol) {
      setSavingScrip(false);
      return;
    }
    const meta = getStockMeta(newSymbol, '');
    // Allow saving even if symbol not in master database - user can refresh prices after
    const companyName = meta.companyName || newSymbol;
    setSavingScrip(true);
    try {
      const holding = holdings.find(h => h.id === holdingId);
      if (!holding) { setSavingScrip(false); return; }
      await updateDoc(doc(db, 'holdings', holdingId), {
        stock_symbol: newSymbol,
        nse_symbol: newSymbol,
        company_name: companyName,
      });
      setEditingScrip(null);
      setEditScripVal('');
      await load();
    } catch (err) {
      console.warn('Error saving scrip:', err);
    } finally {
      setSavingScrip(false);
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
      console.warn('Error saving total capital:', err);
      alert('Failed to save total capital');
    } finally {
      setSavingCapital(false);
    }
  };

  const saveMutualFunds = async () => {
    if (!id) return;
    const val = parseFloat(mutualFundsInput);
    if (isNaN(val) || val < 0) {
      alert('Please enter a valid amount');
      return;
    }
    setSavingMutualFunds(true);
    try {
      await updateDoc(doc(db, 'clients', id), { mutual_funds: val });
      setMutualFunds(val);
      setEditingMutualFunds(false);
    } catch (err) {
      console.error('Error saving mutual funds:', err);
      alert('Failed to save mutual funds');
    } finally {
      setSavingMutualFunds(false);
    }
  };

  const saveOnboardingDate = async () => {
    if (!id || !newDate) return;
    try {
      await updateDoc(doc(db, 'clients', id), { onboarding_date: newDate });
      setClient({ ...client, onboarding_date: newDate } as Client);
      setEditingDate(false);
    } catch (err) {
      console.error(err);
      alert('Failed to save date');
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
          realised_pnl: (holding.realised_pnl || 0) + profitLoss,
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
        buy_price: investedPerUnit,
        realised_pnl: profitLoss,
        total_value: totalValue,
        created_at: new Date().toISOString(),
      });

      if (client?.asset_free_cash !== undefined && client?.asset_free_cash !== null) {
        await updateDoc(doc(db, 'clients', id), {
          asset_free_cash: (client.asset_free_cash || 0) + totalValue
        });
      }

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
      const company_name = meta.companyName || cleanSymbol;
      const normClean = cleanSymbol.replace(/\.NS$/, '').replace(/\.BO$/, '');
      const existingHolding = holdings.find(h => {
        const hSym = (h.nse_symbol || h.stock_symbol || '').trim().toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
        return hSym === normClean;
      });

      const nowIso = new Date().toISOString();
      const todayDate = nowIso.split('T')[0];

      if (existingHolding) {
        const exQty = existingHolding.quantity || 0;
        const totalQty = exQty + qty;
        const exInv = existingHolding.invested_amount || ((existingHolding.buy_price || 0) * exQty);
        const incomingInv = qty * price;
        const totalInv = exInv + incomingInv;
        const avgBuy = totalQty > 0 ? totalInv / totalQty : price;
        const currPrice = existingHolding.current_price > 0 ? existingHolding.current_price : 0;
        const currVal = currPrice > 0 ? totalQty * currPrice : 0;
        const unrealPnl = currVal > 0 ? currVal - totalInv : 0;
        const unrealPnlPct = (totalInv > 0 && currVal > 0) ? (unrealPnl / totalInv) * 100 : 0;

        await updateDoc(doc(db, 'holdings', existingHolding.id), {
          quantity: totalQty,
          buy_price: avgBuy,
          invested_amount: totalInv,
          current_value: currVal,
          unrealised_pnl: unrealPnl,
          unrealised_pnl_pct: unrealPnlPct,
          updated_at: nowIso,
        });
      } else {
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
          source: 'Fresh',
          created_at: nowIso,
        });
      }

      await addDoc(collection(db, 'transactions'), {
        client_id: id,
        date: todayDate,
        action: 'BUY',
        stock_symbol: cleanSymbol,
        company_name,
        quantity: qty,
        price,
        total_value: qty * price,
        created_at: nowIso,
      });

      if (client?.asset_free_cash !== undefined && client?.asset_free_cash !== null) {
        await updateDoc(doc(db, 'clients', id), {
          asset_free_cash: Math.max(0, (client.asset_free_cash || 0) - (qty * price))
        });
      }

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

  const handleDeleteHolding = async (holdingId: string, scripName: string) => {
    if (!window.confirm(`Are you sure you want to delete holding "${scripName}"?`)) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'holdings', holdingId));
      await load();
    } catch (err) {
      console.error('Failed to delete holding:', err);
      alert('Failed to delete holding');
    }
  };

  const activeSummaryHoldings = portfolioTab === 'actual' ? actualHoldings : holdings;

  const summary: PortfolioSummary = activeSummaryHoldings.reduce(
    (acc: PortfolioSummary, h: Holding) => {
      const hasPrice = h.current_price > 0;
      const inv = h.invested_amount || (h.buy_price * h.quantity);
      const val = hasPrice ? (h.current_value || h.buy_price * h.quantity) : inv;
      return {
        totalInvested: acc.totalInvested + inv,
        currentValue: acc.currentValue + val,
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

  // --- Asset Allocation & Cash Logic ---
  let calcEquityVal = 0;
  let calcMfVal = 0;
  let trackedMfInvested = 0;
  
  holdings.forEach((h: Holding) => {
    const meta = getStockMeta(h.nse_symbol, h.company_name);
    const val = (h.current_value || h.buy_price * h.quantity);
    const inv = (h.invested_amount || h.buy_price * h.quantity);
    if (meta.assetClass === 'Mutual Fund') {
      calcMfVal += val;
      trackedMfInvested += inv;
    }
    else {
      calcEquityVal += val;
    }
  });

  const untrackedMf = Math.max(0, mutualFunds - trackedMfInvested);
  const calculatedMfCurrent = calcMfVal + untrackedMf; 
  const calculatedCashBalance = Math.max(0, totalCapital - summary.totalInvested - untrackedMf);

  // Apply manual overrides if present
  const equityVal = client?.asset_equity !== undefined && client.asset_equity !== null ? client.asset_equity : calcEquityVal;
  const totalMfCurrent = client?.asset_mutual_funds !== undefined && client.asset_mutual_funds !== null ? client.asset_mutual_funds : calculatedMfCurrent;
  const cashBalance = client?.asset_free_cash !== undefined && client.asset_free_cash !== null ? client.asset_free_cash : calculatedCashBalance;
  const totalPortfolioValue = equityVal + totalMfCurrent + cashBalance;

  // ── Liquid ETFs, AUA Breach & Cash Position Engine ───────────────────────
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

  const freshBuysTotal = useMemo(() => {
    return transactions.filter((t: Transaction) => t.action === 'BUY').reduce((sum: number, t: Transaction) => sum + t.total_value, 0);
  }, [transactions]);

  const freshSellsTotal = useMemo(() => {
    return transactions.filter((t: Transaction) => t.action === 'SELL').reduce((sum: number, t: Transaction) => sum + t.total_value, 0);
  }, [transactions]);

  const totalAua = totalCapital;
  const allocatedAua = summary.totalInvested + totalMfCurrent + cashBalance;
  const auaBuffer = totalAua - allocatedAua;
  const isAuaBreached = totalAua > 0 && allocatedAua > totalAua;
  const auaBreachAmount = Math.max(0, allocatedAua - totalAua);

  // Dynamic estimated cash position
  const baseCashBroughtIn = client?.asset_free_cash !== undefined && client?.asset_free_cash !== null ? client.asset_free_cash : calculatedCashBalance;
  const dynamicEstimatedCash = Math.max(0, baseCashBroughtIn - freshBuysTotal + freshSellsTotal + liquidEtfTotalValue);
  const cashDiscrepancy = Math.abs(dynamicEstimatedCash - cashBalance);

  // Cash Strategy Buckets
  const momentumCash = Math.round(cashBalance * 0.2);
  const longTermCash = Math.max(0, cashBalance - momentumCash);
  const freeCashRatio = totalPortfolioValue > 0 ? (cashBalance / totalPortfolioValue) * 100 : 0;
  // -------------------------------------

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

  const gridCols = isRebalanceMode
    ? '36px 170px 155px 80px 80px 115px 125px 115px 125px 130px 90px 75px 85px 105px 80px 50px'
    : '36px 170px 155px 80px 80px 115px 125px 115px 125px 130px 90px 75px 85px 105px 50px';

  const updateHoldingField = async (holdingId: string, field: string, val: string) => {
    try {
      await updateDoc(doc(db, 'holdings', holdingId), { [field]: val });
      setHoldings(prev => prev.map(h => h.id === holdingId ? { ...h, [field]: val } : h));
    } catch (err) {
      console.error(err);
      alert('Failed to update holding');
    }
  };

  const updateTxDate = async (txId: string, val: string) => {
    try {
      await updateDoc(doc(db, 'transactions', txId), { date: val });
      setTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, date: val } : tx));
    } catch (err) {
      console.error(err);
      alert('Failed to update transaction date');
    }
  };

  return (
    <div className="animate-fade-in">

      {/* Back + Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <button
          onClick={() => navigate('/')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: '#555555', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 0', transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#C9A84C'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#555555'}
        >
          <ArrowLeft size={16} /> Back to Clients
        </button>

        <button
          onClick={() => setShowUploadModal(true)}
          className="btn-glass-gold"
          style={{ padding: '8px 18px', fontSize: 13 }}
        >
          <Upload size={15} /> Upload Statement
        </button>
      </div>

      <div style={{ marginBottom: 'var(--space-8)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <div style={{
              width: 48, height: 48, borderRadius: 'var(--radius-full)',
              background: '#18181b', border: '1px solid rgba(212, 175, 55, 0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 600, fontSize: 18,
              color: '#d4af37',
            }}>
              {client.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.3px', margin: 0 }}>
                {client.name}
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', color: 'var(--text-muted)', fontSize: '13px', marginTop: 4 }}>
                {client.risk_profile && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Risk:</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{client.risk_profile}</span>
                    <span style={{ opacity: 0.3, marginLeft: 4 }}>•</span>
                  </span>
                )}
                {client.rm_name && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>RM:</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{client.rm_name}</span>
                    <span style={{ opacity: 0.3, marginLeft: 4 }}>•</span>
                  </span>
                )}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Onboarded:</span>
                  {editingDate ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={{ padding: '2px 6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
                      <button onClick={saveOnboardingDate} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a' }}><Check size={14} /></button>
                      <button onClick={() => setEditingDate(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><XIcon size={14} /></button>
                    </span>
                  ) : (
                    <span style={{ cursor: 'pointer', borderBottom: '1px dashed var(--border-default)', color: 'var(--text-primary)', fontWeight: 500 }} onClick={() => { setNewDate(client.onboarding_date || ''); setEditingDate(true); }}>
                      {client.onboarding_date ? new Date(client.onboarding_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Set Date'}
                    </span>
                  )}
                </span>
              </div>
              
              <div style={{ display: 'flex', gap: 10, marginTop: 10, fontSize: 12 }}>
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '4px 10px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Billed:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtCurrency(client.billed_amount || 0)}</span>
                </div>
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '4px 10px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Paid:</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-success-500, #16a34a)' }}>{fmtCurrency(client.amount_paid || 0)}</span>
                </div>
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '4px 10px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Balance:</span>
                  <span style={{ fontWeight: 600, color: ((client.billed_amount || 0) - (client.amount_paid || 0)) > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                    {fmtCurrency((client.billed_amount || 0) - (client.amount_paid || 0))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={() => setIsRebalanceMode(!isRebalanceMode)}
                className="btn-glass-light"
                style={{
                  padding: '7px 16px', fontSize: 13,
                  color: isRebalanceMode ? 'var(--gold-dark)' : 'var(--text-secondary)',
                  borderColor: isRebalanceMode ? 'var(--gold)' : undefined,
                }}
              >
                <TrendingUp size={14} /> {isRebalanceMode ? 'Close Rebalance' : 'Rebalance Portfolio'}
              </button>
              
              <button
                onClick={() => navigate(`/client/${id}/dashboard`)}
                className="btn-glass-gold"
                style={{
                  padding: '7px 18px', borderRadius: 999,
                  fontSize: 11, fontWeight: 700,
                  letterSpacing: '1px', textTransform: 'uppercase',
                }}
              >
                <span>✦</span>
                <span>Portfolio Intelligence</span>
                <span>✦</span>
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 4 }}>
              <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#16a34a' }}></span>
              Prices auto-updated daily between 7:45 PM and 10:45 PM IST
            </div>
          </div>
        </div>
      </div>

      {/* ── AUA Breached / Buffer Alert ────────────────────────────────── */}
      {isAuaBreached && (
        <div style={{
          marginBottom: 'var(--space-6)', padding: '16px 20px', borderRadius: 12,
          background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.35)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AlertCircle size={22} style={{ color: '#ef4444', flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#dc2626', fontSize: 14 }}>⚠️ AUA Capacity Breached / Over-Allocated</strong>
                <div style={{ color: '#991b1b', fontSize: 12.5, marginTop: 2 }}>
                  Total Deployed Assets (₹{allocatedAua.toLocaleString('en-IN', { maximumFractionDigits: 0 })}) exceed Total AUA (₹{totalAua.toLocaleString('en-IN', { maximumFractionDigits: 0 })}) by <strong style={{ color: '#dc2626' }}>₹{auaBreachAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong>.
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsEditingAuaReason(!isEditingAuaReason)}
              className="btn-glass-light"
              style={{ padding: '6px 14px', fontSize: 12, borderColor: 'rgba(239, 68, 68, 0.4)', color: '#dc2626' }}
            >
              {isEditingAuaReason ? 'Close Reason' : 'Log / Edit Reason'}
            </button>
          </div>

          {(isEditingAuaReason || client?.aua_breach_reason) && (
            <div style={{ background: 'rgba(255, 255, 255, 0.75)', padding: '12px 16px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.25)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 6 }}>
                Mandatory Reason for Exceeding AUA:
              </div>
              {isEditingAuaReason ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  <input
                    type="text"
                    value={auaBreachReason}
                    onChange={e => setAuaBreachReason(e.target.value)}
                    placeholder="e.g. Additional capital commitment received from client pending bank transfer"
                    className="glass-input"
                    style={{ flex: 1, padding: '8px 12px', fontSize: 13 }}
                  />
                  <button
                    onClick={saveAuaReason}
                    disabled={savingAuaReason}
                    className="btn-glass-gold"
                    style={{ padding: '8px 16px', fontSize: 12 }}
                  >
                    {savingAuaReason ? 'Saving...' : 'Save Reason'}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#333', fontStyle: 'italic' }}>
                  "{client?.aua_breach_reason || 'No explanation logged yet.'}"
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <SummaryCard title="Total Invested" value={fmtCurrencyKPI(summary.totalInvested)} icon={<IndianRupee size={16} />} accentColor="var(--color-primary-500)" />
        <SummaryCard title="Current Value" value={fmtCurrencyKPI(summary.currentValue)} icon={<BarChart3 size={16} />} accentColor="var(--color-accent-500)" trend={summary.currentValue >= summary.totalInvested ? 'up' : 'down'} />
        <SummaryCard title="Unrealised P&L" value={fmtCurrencyKPI(summary.unrealisedPnL)} subtitle={`${summary.unrealisedPnLPct >= 0 ? '+' : ''}${summary.unrealisedPnLPct.toFixed(2)}%`} icon={summary.unrealisedPnL >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />} trend={summary.unrealisedPnL >= 0 ? 'up' : 'down'} accentColor={summary.unrealisedPnL >= 0 ? 'var(--color-success-500)' : 'var(--color-error-500)'} />
        <SummaryCard title="Realised P&L" value={fmtCurrencyKPI(summary.realisedPnL)} icon={summary.realisedPnL >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />} trend={summary.realisedPnL >= 0 ? 'up' : summary.realisedPnL < 0 ? 'down' : 'neutral'} accentColor={summary.realisedPnL >= 0 ? 'var(--color-success-500)' : 'var(--color-error-500)'} />
        <SummaryCard title="Free Cash" value={fmtCurrencyKPI(cashBalance)} icon={<Wallet size={16} />} accentColor="#C9A84C" />
      </div>

      {/* Asset Allocation Bar */}
      <div style={{ 
        background: 'var(--bg-elevated)', borderRadius: 12, padding: '16px 20px', 
        border: '1px solid var(--border-subtle)', marginBottom: 'var(--space-8)',
        display: 'flex', flexDirection: 'column', gap: 12
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Asset Allocation</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Portfolio Value: </span>{fmtCurrency(totalPortfolioValue)}
            {auaBuffer > 0 && (
              <span style={{ marginLeft: 14, color: '#16a34a', fontWeight: 600, fontSize: 11, background: 'rgba(22,163,74,0.08)', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(22,163,74,0.2)' }}>
                AUA Buffer Remaining: {fmtCurrency(auaBuffer)}
              </span>
            )}
          </div>
        </div>
        
        {/* Progress Bar */}
        <div style={{ width: '100%', height: 6, borderRadius: 999, display: 'flex', overflow: 'hidden', background: 'var(--border-subtle)' }}>
          {totalPortfolioValue > 0 && (
            <>
              <div style={{ width: `${(equityVal / totalPortfolioValue) * 100}%`, background: '#3b82f6', transition: 'width 0.5s' }} title="Equity" />
              <div style={{ width: `${(totalMfCurrent / totalPortfolioValue) * 100}%`, background: '#f59e0b', transition: 'width 0.5s' }} title="Mutual Funds" />
              <div style={{ width: `${(cashBalance / totalPortfolioValue) * 100}%`, background: '#10b981', transition: 'width 0.5s' }} title="Free Cash" />
            </>
          )}
        </div>
        
        {/* Legends */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 20, fontSize: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: '#3b82f6' }} /> Equity: <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{fmtCurrency(equityVal)} ({(equityVal / totalPortfolioValue * 100 || 0).toFixed(1)}%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: '#f59e0b' }} /> Mutual Funds: <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{fmtCurrency(totalMfCurrent)} ({(totalMfCurrent / totalPortfolioValue * 100 || 0).toFixed(1)}%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: '#10b981' }} /> Free Cash: <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{fmtCurrency(cashBalance)} ({(cashBalance / totalPortfolioValue * 100 || 0).toFixed(1)}%)</span>
            </div>
          </div>

          <button onClick={() => {
              setAllocationInputs({
                equity: client?.asset_equity !== undefined && client?.asset_equity !== null ? String(client.asset_equity) : '',
                mf: client?.asset_mutual_funds !== undefined && client?.asset_mutual_funds !== null ? String(client.asset_mutual_funds) : '',
                cash: client?.asset_free_cash !== undefined && client?.asset_free_cash !== null ? String(client.asset_free_cash) : ''
              });
              setIsEditingAllocation(!isEditingAllocation);
            }} 
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', transition: 'color 0.2s', padding: 0 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
          >
            <Pencil size={11} /> {isEditingAllocation ? 'Close' : 'Update'}
          </button>
        </div>

        {isEditingAllocation && (
          <div style={{ background: 'rgba(0,0,0,0.03)', padding: '16px 20px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', marginTop: 8, animation: 'fadeIn 0.2s ease forwards' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Override automatic calculation with manual values (leave blank to auto-calculate):
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6', display: 'block', marginBottom: 6 }}>Equity (₹)</label>
                <input type="number" value={allocationInputs.equity} onChange={e => setAllocationInputs(prev => ({...prev, equity: e.target.value}))} placeholder="Auto" style={{ width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border-default)', outline: 'none' }} onFocus={e => (e.target as HTMLElement).style.borderColor = '#3b82f6'} onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', display: 'block', marginBottom: 6 }}>Mutual Funds (₹)</label>
                <input type="number" value={allocationInputs.mf} onChange={e => setAllocationInputs(prev => ({...prev, mf: e.target.value}))} placeholder="Auto" style={{ width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border-default)', outline: 'none' }} onFocus={e => (e.target as HTMLElement).style.borderColor = '#f59e0b'} onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#10b981', display: 'block', marginBottom: 6 }}>Free Cash (₹)</label>
                <input type="number" value={allocationInputs.cash} onChange={e => setAllocationInputs(prev => ({...prev, cash: e.target.value}))} placeholder="Auto" style={{ width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border-default)', outline: 'none' }} onFocus={e => (e.target as HTMLElement).style.borderColor = '#10b981'} onBlur={e => (e.target as HTMLElement).style.borderColor = 'var(--border-default)'} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setIsEditingAllocation(false)} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveAllocation} disabled={savingAllocation} style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, background: '#3b82f6', color: 'white', border: 'none', borderRadius: 6, cursor: savingAllocation ? 'not-allowed' : 'pointer', opacity: savingAllocation ? 0.7 : 1 }}>
                {savingAllocation ? 'Saving...' : 'Save Allocation'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 4-Tab Portfolio System Navigation Bar ────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, padding: '6px 8px', borderRadius: 14,
        background: 'rgba(255, 255, 255, 0.75)', border: '1px solid rgba(229, 231, 235, 0.8)',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { key: 'estimated', label: 'Estimated Portfolio', badge: `${holdings.length} Working` },
            { key: 'actual', label: 'Actual Portfolio', badge: `${actualHoldings.length} Initial` },
            { key: 'fresh_tx', label: 'Fresh Transactions', badge: `${transactions.length} Orders` },
            { key: 'cash', label: 'Cash Positions & Ledger', badge: fmtCurrencyKPI(cashBalance) },
          ].map(t => {
            const isActive = portfolioTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setPortfolioTab(t.key as any)}
                style={{
                  padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                  border: isActive ? '1px solid var(--gold-border)' : '1px solid transparent',
                  background: isActive ? 'rgba(201,168,76,0.14)' : 'transparent',
                  color: isActive ? '#8c6314' : 'var(--text-secondary)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'all 0.15s ease',
                  boxShadow: isActive ? '0 2px 8px rgba(201,168,76,0.12)' : 'none',
                }}
              >
                <span>{t.label}</span>
                <span style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                  background: isActive ? '#8c6314' : 'rgba(0,0,0,0.06)',
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
          <span>{portfolioTab === 'actual' ? 'Original Baseline View' : portfolioTab === 'cash' ? 'Dynamic Cash Reconciliation' : portfolioTab === 'fresh_tx' ? 'Executed CRM Orders' : 'Live Working Model (CMP Sync)'}</span>
        </div>
      </div>

      {/* ── TAB 1 & TAB 2: Holdings Views (Estimated & Actual) ───────────── */}
      {(portfolioTab === 'estimated' || portfolioTab === 'actual') && (
        <>
          {/* Rebalancing Capital Panel (only in Rebalance Mode on Estimated Tab) */}
          {isRebalanceMode && portfolioTab === 'estimated' && (
            <div className="animate-fade-in" style={{
              marginBottom: 'var(--space-6)',
              background: 'linear-gradient(135deg, rgba(17,17,17,0.95) 0%, rgba(26,22,12,0.95) 100%)',
              border: '1px solid var(--gold-border)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px 28px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                background: 'linear-gradient(90deg, transparent, var(--gold), var(--gold-light), var(--gold), transparent)',
                opacity: 0.7,
              }} />
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
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: '#EAE0C8', margin: 0, letterSpacing: '0.3px' }}>
                    Rebalancing Capital Overview
                  </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button
                      onClick={() => setShowBuyModal(true)}
                      className="btn-glass-gold"
                      style={{ padding: '7px 14px', fontSize: 12 }}
                    >
                      <PlusCircle size={14} /> Add Scrip
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
                {/* Total Capital Input */}
                <div style={{
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  padding: '16px 20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Total Capital</span>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)' }}>
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
                          background: 'rgba(201,168,76,0.06)', color: '#EAE0C8',
                          border: '1px solid var(--gold-border)', borderRadius: 6, outline: 'none',
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
                  <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>Click to set total deployed capital</div>
                </div>

                {/* Mutual Funds Input */}
                <div style={{
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  padding: '16px 20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Mutual Funds</span>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)' }}>
                      <Wallet size={14} />
                    </div>
                  </div>
                  {editingMutualFunds ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--gold)', fontSize: 22, fontWeight: 800 }}>₹</span>
                      <input
                        type="number"
                        value={mutualFundsInput}
                        onChange={e => setMutualFundsInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveMutualFunds(); if (e.key === 'Escape') { setEditingMutualFunds(false); setMutualFundsInput(String(mutualFunds)); } }}
                        autoFocus
                        style={{
                          flex: 1, padding: '6px 10px', fontSize: 18, fontWeight: 800,
                          background: 'rgba(201,168,76,0.06)', color: '#EAE0C8',
                          border: '1px solid var(--gold-border)', borderRadius: 6, outline: 'none',
                        }}
                      />
                      <button onClick={saveMutualFunds} disabled={savingMutualFunds} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success-500)', padding: 4 }}><Check size={16} /></button>
                      <button onClick={() => { setEditingMutualFunds(false); setMutualFundsInput(String(mutualFunds)); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error-500)', padding: 4 }}><XIcon size={16} /></button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--gold-light)', letterSpacing: '-0.5px' }}>
                        {mutualFunds > 0 ? fmtCurrency(mutualFunds) : '₹0.00'}
                      </span>
                      <button
                        onClick={() => { setEditingMutualFunds(true); setMutualFundsInput(String(mutualFunds)); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, opacity: 0.6, display: 'flex', alignItems: 'center' }}
                        title="Edit mutual funds"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>Amount invested in MFs</div>
                </div>

                {/* Total Investment */}
                <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Total Investment</span>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
                      <IndianRupee size={14} />
                    </div>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#EAE0C8', letterSpacing: '-0.5px' }}>
                    {fmtCurrency(summary.totalInvested)}
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>Sum of all invested amounts</div>
                </div>

                {/* Cash Balance */}
                <div style={{
                  background: cashBalance >= 0 ? 'linear-gradient(135deg, rgba(0,0,0,0.4) 0%, rgba(34,197,94,0.04) 100%)' : 'linear-gradient(135deg, rgba(0,0,0,0.4) 0%, rgba(239,68,68,0.04) 100%)',
                  border: `1px solid ${cashBalance >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}`,
                  borderRadius: 12, padding: '16px 20px',
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
                  <div style={{ fontSize: 24, fontWeight: 800, color: totalCapital <= 0 ? '#555' : cashBalance >= 0 ? 'var(--color-success-500)' : 'var(--color-error-500)', letterSpacing: '-0.5px' }}>
                    {totalCapital > 0 ? fmtCurrency(cashBalance) : '—'}
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>
                    {totalCapital > 0 ? `${cashBalance >= 0 ? 'Available' : 'Over-invested'}` : 'Set total capital to calculate'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Holdings Table */}
          <section style={{ marginBottom: 'var(--space-10)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                    {portfolioTab === 'actual' ? 'Actual Baseline Holdings' : 'Holdings & Working Portfolio'} &nbsp;
                    <span style={{ fontSize: 15, fontWeight: 400, color: '#555555' }}>
                      ({getSortedHoldings().length} positions)
                    </span>
                  </h2>
                  {holdings.some(h => h.last_price_update) && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                      Prices last updated: {new Date(Math.max(...holdings.filter(h => h.last_price_update).map(h => new Date(h.last_price_update!).getTime()))).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="Search stock..."
                    value={stockSearch}
                    onChange={e => setStockSearch(e.target.value)}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
                  />
                </div>
              </div>
              
              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <select
                  value={sectorFilter}
                  onChange={(e) => setSectorFilter(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                >
                  <option value="">All Sectors</option>
                  {uniqueSectors.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                  value={mcapFilter}
                  onChange={(e) => setMcapFilter(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                >
                  <option value="">All M Cap</option>
                  {uniqueMCaps.map(m => <option key={m} value={m}>{m}</option>)}
                </select>

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
              </div>
            </div>

            {getSortedHoldings().length === 0 ? (
              <div style={{ background: 'var(--bg-elevated)', border: '2px dashed var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-12)', textAlign: 'center' }}>
                <BarChart3 size={40} style={{ color: 'var(--text-muted)', margin: '0 auto var(--space-4)', display: 'block', opacity: 0.4 }} />
                <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>No holdings in this view</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 8 }}>
                  {portfolioTab === 'actual' ? 'No existing holdings were imported during onboarding' : 'Upload a broker statement or add holdings'}
                </p>
              </div>
            ) : (
              <div className="glass-card" style={{ overflowX: 'auto', maxHeight: '75vh' }}>
                <div style={{ minWidth: 1610 }}>
                  {/* Table Header */}
                  <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 'var(--space-3)', padding: '12px 18px', borderBottom: '1px solid rgba(229, 231, 235, 0.8)', background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>#</div>
                    <button onClick={() => handleSort('scrip')} style={{ fontSize: 11, color: sortColumn === 'scrip' ? '#8c6314' : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                      Scrip {sortColumn === 'scrip' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </button>
                    <button onClick={() => handleSort('sector')} style={{ fontSize: 11, color: sortColumn === 'sector' ? '#8c6314' : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                      Sector {sortColumn === 'sector' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </button>
                    <button onClick={() => handleSort('marketCap')} style={{ fontSize: 11, color: sortColumn === 'marketCap' ? '#8c6314' : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                      M Cap {sortColumn === 'marketCap' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </button>
                    {['qty:Qty', 'buy_price:Avg Buy Price', 'invested_amount:Invested', 'current_price:Curr Price', 'current_value:Curr Value', 'unrealised_pnl:Unreal P&L', 'unrealised_pnl_pct:P&L %', 'alloc:Alloc %'].map(colStr => {
                      const [colKey, colName] = colStr.split(':');
                      return (
                        <button key={colKey} onClick={() => handleSort(colKey as SortColumn)} style={{ fontSize: 11, color: sortColumn === colKey ? '#8c6314' : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                          {colName} {sortColumn === colKey && (sortOrder === 'asc' ? '↑' : '↓')}
                        </button>
                      );
                    })}
                    <button onClick={() => handleSort('source')} style={{ fontSize: 11, color: sortColumn === 'source' ? '#8c6314' : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                      Source {sortColumn === 'source' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </button>
                    <button onClick={() => handleSort('purchase_date')} style={{ fontSize: 11, color: sortColumn === 'purchase_date' ? '#8c6314' : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                      Pur. Date {sortColumn === 'purchase_date' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </button>
                    {isRebalanceMode && portfolioTab === 'estimated' && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>Action</span>}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delete</div>
                  </div>

                  {/* Table Rows */}
                  {getSortedHoldings().map((h: Holding, i: number) => {
                    const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
                    const displayCompanyName = meta.companyName || h.company_name;
                    return (
                    <div key={h.id} style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 'var(--space-3)', alignItems: 'center', padding: '11px 18px', borderBottom: i < getSortedHoldings().length - 1 ? '1px solid rgba(229, 231, 235, 0.7)' : 'none', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(201, 168, 76, 0.03)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <div style={{ color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 500 }}>{i + 1}</div>
                      <div>
                        {editingScrip === h.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="text"
                              value={editScripVal}
                              onChange={e => setEditScripVal(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveScrip(h.id); if (e.key === 'Escape') { setEditingScrip(null); setEditScripVal(''); } }}
                              autoFocus
                              style={{ width: 105, padding: '3px 6px', fontSize: 12.5, background: '#ffffff', color: 'var(--text-primary)', border: '1px solid var(--gold)', borderRadius: 4, outline: 'none' }}
                            />
                            <button onClick={() => saveScrip(h.id)} disabled={savingScrip} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', padding: 2 }}><Check size={14} /></button>
                            <button onClick={() => { setEditingScrip(null); setEditScripVal(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 2 }}><XIcon size={14} /></button>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontWeight: 600, color: '#8c6314', fontSize: 13.5, letterSpacing: '0.2px' }}>{cleanSymbol(h)}</span>
                              <button onClick={() => { setEditingScrip(h.id); setEditScripVal(cleanSymbol(h)); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, opacity: 0.6, display: 'flex', alignItems: 'center' }} title="Edit scrip"><Pencil size={11} /></button>
                            </div>
                            {displayCompanyName && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }} title={displayCompanyName}>
                                {displayCompanyName}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      <div style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }} title={meta.sector}>
                        {meta.sector}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }}>
                        {meta.marketCap}
                      </div>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 400 }} className="tabular-nums">
                        {h.quantity.toLocaleString('en-IN')}
                      </div>
                      
                      {/* Buy Price with Edit options */}
                      <div style={{ color: 'var(--text-secondary)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {editingBuyPrice === h.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input type="number" value={editBuyPriceVal} onChange={e => setEditBuyPriceVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveBuyPrice(h.id); if (e.key === 'Escape') { setEditingBuyPrice(null); setEditBuyPriceVal(''); } }} autoFocus style={{ width: 85, padding: '3px 6px', fontSize: 12.5, background: '#ffffff', color: 'var(--text-primary)', border: '1px solid var(--gold)', borderRadius: 4, outline: 'none' }} />
                            <button onClick={() => saveBuyPrice(h.id)} disabled={savingBuyPrice} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', padding: 2 }}><Check size={14} /></button>
                            <button onClick={() => { setEditingBuyPrice(null); setEditBuyPriceVal(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 2 }}><XIcon size={14} /></button>
                          </div>
                        ) : (
                          <>
                            <span className="tabular-nums" style={{ fontWeight: 400 }}>
                              {h.buy_price > 0 ? `₹${h.buy_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : <span style={{ color: 'var(--color-accent-400)', fontSize: 11.5, fontStyle: 'italic' }}>Not set</span>}
                            </span>
                            <button onClick={() => { setEditingBuyPrice(h.id); setEditBuyPriceVal(h.buy_price > 0 ? String(h.buy_price) : ''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, opacity: 0.6, display: 'flex', alignItems: 'center' }} title="Edit buy price"><Pencil size={11} /></button>
                          </>
                        )}
                      </div>

                      <div style={{ color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 400 }} className="tabular-nums">
                        {h.buy_price > 0 ? fmtCurrency(h.invested_amount || h.buy_price * h.quantity) : '0'}
                      </div>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 400 }} className="tabular-nums">
                        {h.current_price > 0 ? `₹${h.current_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '0'}
                      </div>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 400 }} className="tabular-nums">
                        {h.current_price > 0 ? fmtCurrency(h.current_value || h.buy_price * h.quantity) : '0'}
                      </div>
                      <div style={{ color: h.unrealised_pnl >= 0 ? '#16a34a' : '#dc2626', fontSize: 13.5, fontWeight: 500 }} className="tabular-nums">
                        {h.current_price > 0 ? `${h.unrealised_pnl >= 0 ? '+' : ''}${fmtCurrency(h.unrealised_pnl)}` : '0'}
                      </div>
                      <div>
                        {h.current_price > 0 ? <PnLBadge value={h.unrealised_pnl_pct} suffix="%" /> : <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>0%</span>}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 400 }} className="tabular-nums">
                        {summary.currentValue > 0 ? (((h.current_price > 0 ? (h.current_value || h.buy_price * h.quantity) : (h.invested_amount || h.buy_price * h.quantity)) / summary.currentValue) * 100).toFixed(1) + '%' : '0%'}
                      </div>
                      
                      {/* Holding Source */}
                      <div>
                        {editingHoldingSource === h.id ? (
                          <select
                            autoFocus
                            value={h.source || 'Existing'}
                            onChange={e => { updateHoldingField(h.id, 'source', e.target.value); setEditingHoldingSource(null); }}
                            onBlur={() => setEditingHoldingSource(null)}
                            style={{ padding: '2px 4px', fontSize: 11, borderRadius: 4, outline: 'none' }}
                          >
                            <option value="Existing">Existing</option>
                            <option value="Fresh">Fresh</option>
                          </select>
                        ) : (
                          <span onClick={() => setEditingHoldingSource(h.id)} style={{ cursor: 'pointer', borderBottom: '1px dashed #ccc', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                            {h.source || 'Existing'}
                          </span>
                        )}
                      </div>

                      {/* Purchase Date */}
                      <div>
                        {editingHoldingDate === h.id ? (
                          <input
                            type="date"
                            autoFocus
                            value={h.purchase_date || ''}
                            onChange={e => { updateHoldingField(h.id, 'purchase_date', e.target.value); setEditingHoldingDate(null); }}
                            onBlur={() => setEditingHoldingDate(null)}
                            style={{ padding: '2px 4px', fontSize: 11, borderRadius: 4, outline: 'none', width: '100%' }}
                          />
                        ) : (
                          <span onClick={() => setEditingHoldingDate(h.id)} style={{ cursor: 'pointer', borderBottom: '1px dashed #ccc', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                            {h.purchase_date ? new Date(h.purchase_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : 'Set Date'}
                          </span>
                        )}
                      </div>
                      
                      {/* Inline Rebalance Sell Action */}
                      {isRebalanceMode && portfolioTab === 'estimated' && (
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

                      {/* Delete Holding Button */}
                      <div style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => handleDeleteHolding(h.id, cleanSymbol(h))}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error-500)',
                            padding: '4px 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            opacity: 0.7, transition: 'opacity 0.15s, background 0.15s',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.background = 'rgba(239, 68, 68, 0.1)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
                          title="Delete holding"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* ── TAB 3: Fresh Transactions View ──────────────────────────────── */}
      {portfolioTab === 'fresh_tx' && (
        <section style={{ marginBottom: 'var(--space-10)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                Fresh Transactions & Execution Ledger &nbsp;
                <span style={{ fontSize: 15, fontWeight: 400, color: '#555555' }}>
                  ({getSortedTransactions().length} orders)
                </span>
              </h2>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                All Buy and Sell trades executed post-onboarding with target strategy buckets and execution price bands.
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, background: 'var(--bg-elevated)', padding: 4, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                {[
                  { key: 'buy', label: 'Buy Orders' },
                  { key: 'sell', label: 'Sell Orders' },
                  { key: 'all', label: 'All Orders' },
                ].map(b => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setTxTab(b.key as any)}
                    style={{
                      padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none',
                      background: txTab === b.key ? 'var(--gold)' : 'transparent',
                      color: txTab === b.key ? '#000000' : 'var(--text-secondary)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="Search stock in orders..."
                value={txStockSearch}
                onChange={e => setTxStockSearch(e.target.value)}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
              />

              <button
                onClick={() => setShowBuyModal(true)}
                className="btn-glass-gold"
                style={{ padding: '7px 14px', fontSize: 12 }}
              >
                <PlusCircle size={14} /> Execute New Trade
              </button>
            </div>
          </div>

          {getSortedTransactions().length === 0 ? (
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-12)', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No fresh transactions found</p>
              <p style={{ fontSize: 13, marginTop: 6 }}>Execute buy/sell trades via Rebalancing mode or the Bulk Order Wizard</p>
            </div>
          ) : (
            <div className="glass-card" style={{ overflowX: 'auto', maxHeight: '70vh' }}>
              <div style={{ minWidth: 1100 }}>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '120px 140px 180px 90px 100px 120px 130px 130px 140px', gap: 12, padding: '12px 18px', borderBottom: '1px solid rgba(229,231,235,0.8)', background: 'rgba(255,255,255,0.95)', position: 'sticky', top: 0, zIndex: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Execution Date</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Symbol</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Company</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Action</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Quantity</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Price (₹)</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Value</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Strategy Bucket</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Price Range</div>
                </div>

                {/* Rows */}
                {getSortedTransactions().map((tx, i) => {
                  const meta = getStockMeta(tx.stock_symbol, tx.company_name || '');
                  return (
                    <div key={tx.id} style={{ display: 'grid', gridTemplateColumns: '120px 140px 180px 90px 100px 120px 130px 130px 140px', gap: 12, alignItems: 'center', padding: '11px 18px', borderBottom: i < getSortedTransactions().length - 1 ? '1px solid rgba(229,231,235,0.7)' : 'none' }}>
                      <div>
                        {editingTxDate === tx.id ? (
                          <input
                            type="date"
                            autoFocus
                            value={tx.date || ''}
                            onChange={e => { updateTxDate(tx.id, e.target.value); setEditingTxDate(null); }}
                            onBlur={() => setEditingTxDate(null)}
                            style={{ padding: '2px 4px', fontSize: 11, borderRadius: 4, outline: 'none', width: '100%' }}
                          />
                        ) : (
                          <span onClick={() => setEditingTxDate(tx.id)} style={{ cursor: 'pointer', borderBottom: '1px dashed #ccc', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                            {new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                      <div style={{ fontWeight: 700, color: '#8c6314', fontSize: 13.5 }}>{cleanSymbol(tx)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {meta.companyName || tx.company_name || '—'}
                      </div>
                      <div>
                        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: tx.action === 'BUY' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: tx.action === 'BUY' ? '#16a34a' : '#dc2626' }}>
                          {tx.action}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 500 }} className="tabular-nums">{tx.quantity.toLocaleString('en-IN')}</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }} className="tabular-nums">₹{tx.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }} className="tabular-nums">{fmtCurrency(tx.total_value)}</div>
                      <div>
                        <span style={{ fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: ((tx as any).bucket || 'Long-Term') === 'Momentum' ? 'rgba(168,85,247,0.1)' : 'rgba(59,130,246,0.1)', color: ((tx as any).bucket || 'Long-Term') === 'Momentum' ? '#7e22ce' : '#1d4ed8' }}>
                          {(tx as any).bucket || 'Long-Term Core'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        {(tx as any).price_range || 'Exact Execution'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── TAB 4: Cash Positions & Reconciliation View ─────────────────── */}
      {portfolioTab === 'cash' && (
        <section style={{ marginBottom: 'var(--space-10)' }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Dynamic Cash Position Engine & Discrepancy Reconciliation
            </h2>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
              Arithmetic ledger tracing starting cash, fresh trade flows, Liquid BeES investments, and capital bucket allocations.
            </span>
          </div>

          {/* Cash KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Starting Cash Brought In</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{fmtCurrency(baseCashBroughtIn)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Onboarding cash capital</div>
            </div>

            <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 6 }}>Fresh Buys Deployed (-)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#dc2626' }}>- {fmtCurrency(freshBuysTotal)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{transactions.filter(t => t.action === 'BUY').length} buy orders executed</div>
            </div>

            <div style={{ background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', marginBottom: 6 }}>Fresh Sells Inflow (+)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#16a34a' }}>+ {fmtCurrency(freshSellsTotal)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{transactions.filter(t => t.action === 'SELL').length} sell orders executed</div>
            </div>

            <div style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', marginBottom: 6 }}>Liquid BeES Parked Cash</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#2563eb' }}>{fmtCurrency(liquidEtfTotalValue)}</div>
              <div style={{ fontSize: 11, color: '#2563eb', marginTop: 4 }}>Yield: ~5.5-6.5% p.a.</div>
            </div>

            <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8c6314', textTransform: 'uppercase', marginBottom: 6 }}>Estimated Available Cash</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#8c6314' }}>{fmtCurrency(dynamicEstimatedCash)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Live free capital</div>
            </div>
          </div>

          {/* Strategy Buckets & Reconciliation Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            {/* Strategy Cash Buckets */}
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '20px 22px' }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px' }}>Strategy Capital Buckets</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(59,130,246,0.06)', borderRadius: 8 }}>
                  <div>
                    <strong style={{ color: '#1d4ed8', fontSize: 13 }}>Long-Term Core Strategy Cash (80%)</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Reserved for high-conviction staggered dips</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#1d4ed8' }}>{fmtCurrency(longTermCash)}</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(168,85,247,0.06)', borderRadius: 8 }}>
                  <div>
                    <strong style={{ color: '#7e22ce', fontSize: 13 }}>Momentum Strategy Tactical Cash (20%)</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Swing and breakout swing trades</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#7e22ce' }}>{fmtCurrency(momentumCash)}</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: freeCashRatio < 10 ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)', borderRadius: 8 }}>
                  <div>
                    <strong style={{ color: freeCashRatio < 10 ? '#dc2626' : '#16a34a', fontSize: 13 }}>Free Cash / Portfolio Ratio</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{freeCashRatio < 10 ? '⚠️ Low cash buffer warning (< 10%)' : 'Healthy liquidity buffer'}</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: freeCashRatio < 10 ? '#dc2626' : '#16a34a' }}>{freeCashRatio.toFixed(1)}%</div>
                </div>
              </div>
            </div>

            {/* Reconciliation Engine */}
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Cash Discrepancy & Reconciliation</h3>
                {cashDiscrepancy > 100 && (
                  <button
                    onClick={() => syncBaseCashToEstimated(dynamicEstimatedCash)}
                    className="btn-glass-gold"
                    style={{ padding: '5px 12px', fontSize: 11 }}
                  >
                    Sync Base Cash
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Calculated Estimated Cash:</span>
                  <strong>{fmtCurrency(dynamicEstimatedCash)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Client Master Base Cash:</span>
                  <strong>{fmtCurrency(cashBalance)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Variance / Discrepancy:</span>
                  <strong style={{ color: cashDiscrepancy > 100 ? '#dc2626' : '#16a34a' }}>
                    {cashDiscrepancy > 100 ? `₹${cashDiscrepancy.toLocaleString('en-IN')} discrepancy` : 'Fully Reconciled (₹0)'}
                  </strong>
                </div>

                <div style={{ marginTop: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Reason for Variance / Audit Trail:</span>
                    <button
                      onClick={() => setIsEditingReconReason(!isEditingReconReason)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#8c6314', fontWeight: 600 }}
                    >
                      {isEditingReconReason ? 'Cancel' : 'Edit Note'}
                    </button>
                  </div>
                  {isEditingReconReason ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={reconciliationReason}
                        onChange={e => setReconciliationReason(e.target.value)}
                        placeholder="e.g. Dividend payout received in demat account"
                        className="glass-input"
                        style={{ flex: 1, padding: '6px 10px', fontSize: 12 }}
                      />
                      <button onClick={saveReconReason} disabled={savingReconReason} className="btn-glass-gold" style={{ padding: '6px 12px', fontSize: 11 }}>
                        {savingReconReason ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      "{reconciliationReason || 'No variance explanation logged yet.'}"
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Liquid BeES Holdings Table */}
          {liquidHoldings.length > 0 && (
            <div className="glass-card" style={{ padding: 18, borderRadius: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12 }}>
                Parked Liquid ETF Holdings ({liquidHoldings.length} scrips)
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 140px 140px 140px 140px', gap: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <div>Scrip</div>
                <div>Quantity</div>
                <div>Avg Buy Price</div>
                <div>Current Value</div>
                <div>Unrealised P&L</div>
              </div>
              {liquidHoldings.map((lh: Holding) => (
                <div key={lh.id} style={{ display: 'grid', gridTemplateColumns: '160px 140px 140px 140px 140px', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)', fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: '#8c6314' }}>{cleanSymbol(lh)}</div>
                  <div>{lh.quantity.toLocaleString('en-IN')}</div>
                  <div>₹{lh.buy_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div style={{ fontWeight: 600 }}>{fmtCurrency(lh.current_value || lh.buy_price * lh.quantity)}</div>
                  <div style={{ color: lh.unrealised_pnl >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                    {lh.unrealised_pnl >= 0 ? '+' : ''}{fmtCurrency(lh.unrealised_pnl)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Transaction History Ledger (Always available at bottom) ──────── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Transaction Log &nbsp;
              <span style={{ fontSize: 'var(--text-base)', fontWeight: 400, color: 'var(--text-muted)' }}>({getSortedTransactions().length} records)</span>
            </h2>
            <div style={{ display: 'flex', gap: 6, background: 'var(--bg-elevated)', padding: 3, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setTxTab('buy')}
                style={{
                  padding: '4px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 6, border: 'none',
                  background: txTab === 'buy' ? 'rgba(34,197,94,0.15)' : 'transparent',
                  color: txTab === 'buy' ? '#16a34a' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                Buy Orders ({transactions.filter(t => t.action === 'BUY').length})
              </button>
              <button
                type="button"
                onClick={() => setTxTab('sell')}
                style={{
                  padding: '4px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 6, border: 'none',
                  background: txTab === 'sell' ? 'rgba(239,68,68,0.15)' : 'transparent',
                  color: txTab === 'sell' ? '#dc2626' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                Sell Orders ({transactions.filter(t => t.action === 'SELL').length})
              </button>
              <button
                type="button"
                onClick={() => setTxTab('all')}
                style={{
                  padding: '4px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 6, border: 'none',
                  background: txTab === 'all' ? 'var(--gold)' : 'transparent',
                  color: txTab === 'all' ? '#000000' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                All Orders ({transactions.length})
              </button>
            </div>
          </div>
          <div>
            <input
              type="text"
              placeholder="Search stock..."
              value={txStockSearch}
              onChange={e => setTxStockSearch(e.target.value)}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
            />
          </div>
        </div>

        {getSortedTransactions().length === 0 ? (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            No {txTab === 'sell' ? 'sell' : txTab === 'buy' ? 'buy' : ''} transactions recorded yet
          </div>
        ) : (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', overflowY: 'auto', maxHeight: '60vh' }}>
            {txTab === 'sell' ? (
              /* Sell Ledger View */
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 160px 100px 120px 120px 130px 110px', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Date</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Stock Name</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Qty Sold</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Avg Buy Price</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Sales Price</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Realised P&L (₹)</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>P&L (%)</div>
                </div>
                {getSortedTransactions().map((tx, i) => {
                  const pnl = tx.realised_pnl !== undefined ? tx.realised_pnl : ((tx as any).realised_pnl || 0);
                  let buyPr = tx.buy_price !== undefined && tx.buy_price > 0 ? tx.buy_price : 0;
                  if (!buyPr && tx.price > 0 && tx.quantity > 0 && pnl !== 0) {
                    buyPr = tx.price - (pnl / tx.quantity);
                  }
                  const pnlPct = buyPr > 0 ? ((tx.price - buyPr) / buyPr) * 100 : 0;
                  return (
                    <div key={tx.id} style={{ display: 'grid', gridTemplateColumns: '120px 160px 100px 120px 120px 130px 110px', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3) var(--space-5)', borderBottom: i < getSortedTransactions().length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                        {new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                      <div style={{ fontWeight: 700, color: '#8c6314', fontSize: 13.5 }}>{cleanSymbol(tx)}</div>
                      <div style={{ fontSize: 13 }} className="tabular-nums">{tx.quantity.toLocaleString('en-IN')}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }} className="tabular-nums">
                        {buyPr > 0 ? `₹${buyPr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600 }} className="tabular-nums">₹{tx.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: pnl >= 0 ? '#16a34a' : '#dc2626' }} className="tabular-nums">
                        {pnl >= 0 ? '+' : ''}{fmtCurrency(pnl)}
                      </div>
                      <div>
                        <PnLBadge value={pnlPct} suffix="%" />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Standard / Buy Orders View */
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.8fr 1fr 1fr', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
                  {[
                    { col: 'date', label: 'Date' },
                    { col: 'stock_symbol', label: 'Symbol' },
                    { col: 'action', label: 'Action' },
                    { col: 'quantity', label: 'Quantity' },
                    { col: 'price', label: 'Price' },
                    { col: 'total_value', label: 'Total' }
                  ].map(({ col, label }) => (
                    <button key={col} onClick={() => handleTxSort(col as TxSortColumn)} style={{ fontSize: 'var(--text-xs)', color: txSortColumn === col ? 'var(--color-primary-400)' : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                      {label} {txSortColumn === col ? (txSortOrder === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  ))}
                </div>
                {getSortedTransactions().map((tx, i) => (
                  <div key={tx.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 0.8fr 1fr 1fr', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3) var(--space-5)', borderBottom: i < getSortedTransactions().length - 1 ? '1px solid var(--border-subtle)' : 'none', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <div>
                      {editingTxDate === tx.id ? (
                        <input
                          type="date"
                          autoFocus
                          value={tx.date || ''}
                          onChange={e => { updateTxDate(tx.id, e.target.value); setEditingTxDate(null); }}
                          onBlur={() => setEditingTxDate(null)}
                          style={{ padding: '2px 4px', fontSize: 11, borderRadius: 4, outline: 'none' }}
                        />
                      ) : (
                        <div onClick={() => setEditingTxDate(tx.id)} style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', cursor: 'pointer', borderBottom: '1px dashed #ccc', display: 'inline-block' }}>
                          {new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, color: '#8c6314', fontSize: 'var(--text-sm)' }}>{cleanSymbol(tx)}</div>
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

      {/* Upload Statement Modal */}
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