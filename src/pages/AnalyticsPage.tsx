import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, Cell, PieChart, Pie,
  CartesianGrid
} from 'recharts';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Spinner } from '../components/Spinner';
import { getStockMeta, cleanSymbol } from '../lib/sectorMap';
import {
  TrendingUp, TrendingDown, Users, Briefcase, Award, BarChart2, PieChart as PieIcon, Activity,
  Search, ShieldCheck, ChevronRight, X as XIcon, Building2
} from 'lucide-react';

import { BulkOrderWizardModal } from '../components/BulkOrderWizardModal';

interface HoldingWithClient {
  id: string;
  stock_symbol: string;
  nse_symbol: string;
  company_name: string;
  quantity: number;
  buy_price: number;
  current_price: number;
  invested_amount: number;
  current_value: number;
  unrealised_pnl: number;
  unrealised_pnl_pct: number;
  client_id: string;
  client_name: string;
}

const SECTOR_COLORS: Record<string, string> = {
  'Banking': '#0a192f',
  'Information Technology': '#1d3557',
  'FMCG': '#457b9d',
  'Financial Services': '#c9a84c',
  'Energy & Oil': '#e63946',
  'Pharma & Healthcare': '#5c8001',
  'Automobiles': '#8338ec',
  'Metals & Mining': '#f77f00',
  'Capital Goods': '#fcbf49',
  'Power & Utilities': '#eae2b7',
  'Cement': '#d62828',
  'Real Estate': '#003049',
  'Telecom': '#7209b7',
  'Consumer Discretionary': '#f72585',
  'Chemicals': '#4cc9f0',
  'Gold ETF': '#ffd700',
  'Silver ETF': '#c0c0c0',
  'Index ETF': '#2a9d8f',
  'Liquid ETF': '#e76f51',
  'Others': '#8d99ae',
};

const VIBRANT_PALETTE = [
  '#C9A84C', '#2a9d8f', '#e76f51', '#3b82f6', '#8b5cf6',
  '#f43f5e', '#10b981', '#f59e0b', '#06b6d4', '#ec4899'
];

function fmtCurrency(v: number) {
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function AnalyticsPage() {
  const [data, setData] = useState<HoldingWithClient[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [rmList, setRmList] = useState<string[]>([
    'Suraj Sharma', 'Shubham Chakraborty', 'Samrat Samanta', 'Swarnendu Shekhar Das', 
    'Raunak Paul', 'Uttam Paul', 'Amit Singh', 'Shantanu Saha'
  ]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSortCol, setClientSortCol] = useState<string>('value');
  const [clientSortOrder, setClientSortOrder] = useState<'asc' | 'desc'>('desc');

  // ── Smart Search ───────────────────────────────────────────────────────────
  const [searchMode, setSearchMode] = useState<'stock' | 'cash' | 'client' | 'sector' | 'rm' | 'risk' | 'settings'>('stock');
  const [stockQuery, setStockQuery] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [selectedRm, setSelectedRm] = useState('');
  const [selectedSector, setSelectedSector] = useState('');
  const [selectedRiskProfile, setSelectedRiskProfile] = useState('');
  const [cashMinFilter, setCashMinFilter] = useState(0);
  
  const [newRmName, setNewRmName] = useState('');

  // ── Buy Modal ──────────────────────────────────────────────────────────────
  const [buyModalData, setBuyModalData] = useState<{ clientId: string; clientName: string; freeCash: number } | null>(null);
  const [buySymbol, setBuySymbol] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyQty, setBuyQty] = useState('');
  const [deployPct, setDeployPct] = useState(50);

  // ── Sell Modal ─────────────────────────────────────────────────────────────
  const [sellModalData, setSellModalData] = useState<{ clientId: string; clientName: string; holding: HoldingWithClient } | null>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [sellQty, setSellQty] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Bulk Action Modals ─────────────────────────────────────────────────────
  const [bulkWizard, setBulkWizard] = useState<{ mode: 'buy'|'sell', symbol?: string, selectedClientIds?: string[], holdingsData?: any[] } | null>(null);
  const [selectedStockRows, setSelectedStockRows] = useState<Set<string>>(new Set());
  const [selectedClientRows, setSelectedClientRows] = useState<Set<string>>(new Set());

  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [holdingSnap, clientSnap] = await Promise.all([
          getDocs(collection(db, 'holdings')),
          getDocs(collection(db, 'clients'))
        ]);

        const clientMap: Record<string, { name: string; totalCapital: number; mutual_funds: number; rm: string }> = {};
        
        clientSnap.docs.forEach(d => {
          const cdata = d.data();
          clientMap[d.id] = {
            name: cdata.name ?? 'Unknown',
            totalCapital: cdata.total_capital ?? 0,
            mutual_funds: cdata.mutual_funds ?? 0,
            rm: cdata.rm_name ?? 'Unassigned'
          };
        });

        // Load RM List
        try {
          const { getDoc } = await import('firebase/firestore');
          const d = await getDoc(doc(db, 'settings', 'rm_list'));
          if (d.exists() && d.data().rms) {
            setRmList(d.data().rms);
          }
        } catch (_e) {}

        const holdings = holdingSnap.docs.map(d => {
          const h = d.data() as any;
          const clin = clientMap[h.client_id] || { name: 'Unknown', totalCapital: 0, mutual_funds: 0 };
          return {
            ...h,
            id: d.id,
            client_name: clin.name,
          } as HoldingWithClient;
        });

        setData(holdings);

        // Group by client for directory
        const clientGroups = holdings.reduce((acc, h) => {
          if (!acc[h.client_id]) {
            acc[h.client_id] = {
              id: h.client_id,
              name: h.client_name,
              invested: 0,
              value: 0,
              pnl: 0,
              stockCount: 0,
              etfCount: 0,
              totalCapital: clientMap[h.client_id]?.totalCapital ?? 0,
              mutual_funds: clientMap[h.client_id]?.mutual_funds ?? 0,
              rm: clientMap[h.client_id]?.rm ?? 'Unassigned'
            };
          }
          const val = h.current_value || h.buy_price * h.quantity;
          const inv = h.invested_amount || h.buy_price * h.quantity;
          acc[h.client_id].invested += inv;
          acc[h.client_id].value += val;
          acc[h.client_id].pnl += (h.unrealised_pnl || 0);

          const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
          if (meta.assetClass === 'ETF' || meta.assetClass === 'Commodity') {
            acc[h.client_id].etfCount++;
          } else {
            acc[h.client_id].stockCount++;
          }
          return acc;
        }, {} as Record<string, any>);

        // Handle clients with NO holdings
        clientSnap.docs.forEach(d => {
          if (!clientGroups[d.id]) {
            clientGroups[d.id] = {
              id: d.id,
              name: d.data().name ?? 'Unknown',
              invested: 0,
              value: 0,
              pnl: 0,
              stockCount: 0,
              etfCount: 0,
              totalCapital: d.data().total_capital ?? 0,
              mutual_funds: d.data().mutual_funds ?? 0,
              rm: d.data().rm_name ?? 'Unassigned'
            };
          }
        });

        setClients(Object.values(clientGroups));
        setLoading(false);
      } catch (err) {
        console.error('Error fetching analytics data:', err);
        setLoading(false);
      }
    })();
  }, []);

  // ─── Computations ───────────────────────────────────────────────────────────
  const totalInvested = useMemo(() => data.reduce((s, h) => s + (h.invested_amount || h.buy_price * h.quantity), 0), [data]);
  const totalValue = useMemo(() => data.reduce((s, h) => s + (h.current_value || h.buy_price * h.quantity), 0), [data]);
  const totalPnL = useMemo(() => totalValue - totalInvested, [totalValue, totalInvested]);
  const overallPnlPct = useMemo(() => totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0, [totalPnL, totalInvested]);

  const activeHoldingsCount = useMemo(() => new Set(data.map(h => h.stock_symbol.toUpperCase())).size, [data]);

  // Aggregate Holdings
  const aggregateHoldings = useMemo(() => {
    const map = data.reduce((acc, h) => {
      const sym = h.stock_symbol.toUpperCase();
      if (!acc[sym]) {
        const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
        acc[sym] = {
          symbol: cleanSymbol(h),
          companyName: meta.companyName || h.company_name || sym,
          quantity: 0,
          invested: 0,
          value: 0,
          pnl: 0,
          clientsCount: 0,
          sector: meta.sector,
          assetClass: meta.assetClass,
          marketCap: meta.marketCap
        };
      }
      const val = h.current_value || h.buy_price * h.quantity;
      const inv = h.invested_amount || h.buy_price * h.quantity;
      acc[sym].quantity += h.quantity;
      acc[sym].invested += inv;
      acc[sym].value += val;
      acc[sym].pnl += (h.unrealised_pnl || 0);
      acc[sym].clientsCount++;
      return acc;
    }, {} as Record<string, any>);

    return Object.values(map).sort((a: any, b: any) => b.value - a.value);
  }, [data]);

  // Filter aggregate holdings for Explorer
  const filteredHoldings = useMemo(() => {
    return aggregateHoldings.filter((h: any) =>
      h.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.sector.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [aggregateHoldings, searchTerm]);

  // Asset Class Allocation
  const assetClassData = useMemo(() => {
    const map = aggregateHoldings.reduce((acc, h: any) => {
      acc[h.assetClass] = (acc[h.assetClass] || 0) + h.value;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(map).map(([k, v]) => ({
      name: k,
      value: totalValue > 0 ? ((v as number) / totalValue) * 100 : 0,
      raw: v as number
    })).sort((a: any, b: any) => b.raw - a.raw);
  }, [aggregateHoldings, totalValue]);

  // Sector Allocation
  const sectorData = useMemo(() => {
    const map = aggregateHoldings.reduce((acc, h: any) => {
      acc[h.sector] = (acc[h.sector] || 0) + h.value;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(map).map(([k, v]) => ({
      name: k,
      value: totalValue > 0 ? ((v as number) / totalValue) * 100 : 0,
      raw: v as number
    })).sort((a: any, b: any) => b.raw - a.raw);
  }, [aggregateHoldings, totalValue]);

  // Market Cap Allocation (Equity only)
  const mcapData = useMemo(() => {
    const map = aggregateHoldings.reduce((acc, h: any) => {
      if (h.assetClass === 'Equity') {
        acc[h.marketCap] = (acc[h.marketCap] || 0) + h.value;
      }
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(map).map(([k, v]) => ({
      name: k,
      value: totalValue > 0 ? ((v as number) / totalValue) * 100 : 0,
      raw: v as number
    })).sort((a: any, b: any) => {
      const order = { 'Large': 3, 'Mid': 2, 'Small': 1 };
      return (order[b.name as keyof typeof order] || 0) - (order[a.name as keyof typeof order] || 0);
    });
  }, [aggregateHoldings, totalValue]);

  // Herfindahl-Hirschman Index (HHI) for Aggregate Holdings
  const aggregateHhi = useMemo(() => {
    if (totalValue <= 0) return 0;
    return aggregateHoldings.reduce((s, h: any) => {
      const w = h.value / totalValue;
      return s + w * w;
    }, 0);
  }, [aggregateHoldings, totalValue]);

  const effectiveStocksCount = useMemo(() => aggregateHhi > 0 ? (1 / aggregateHhi).toFixed(1) : '0', [aggregateHhi]);

  const tailHoldingsCount = useMemo(() => {
    if (totalValue <= 0) return 0;
    return aggregateHoldings.filter((h: any) => (h.value / totalValue) * 100 < 1).length;
  }, [aggregateHoldings, totalValue]);

  // Observations
  const observations = useMemo(() => {
    const list: string[] = [];
    if (sectorData.length > 0 && sectorData[0] && sectorData[0].value > 25) {
      list.push(`${sectorData[0].name} forms the largest aggregate exposure at ${sectorData[0].value.toFixed(1)}%, indicating high sector concentration across the firm's assets.`);
    }
    if (aggregateHhi * 10000 > 1800) {
      list.push(`The firm portfolio has elevated concentration (HHI of ${(aggregateHhi * 10000).toFixed(0)}), meaning performance is heavily dependent on a few major allocations.`);
    } else {
      list.push(`The firm portfolio is highly diversified (HHI of ${(aggregateHhi * 10000).toFixed(0)}), providing robust protection against individual security drawdown.`);
    }
    if (tailHoldingsCount > 12) {
      list.push(`There are ${tailHoldingsCount} tail holdings (individually under 1% weight) across client accounts, indicating potential opportunity to streamline into higher-conviction ideas.`);
    }
    const etfExposedVal = aggregateHoldings.filter((h: any) => h.assetClass === 'ETF' || h.assetClass === 'Commodity').reduce((s, h: any) => s + h.value, 0);
    const etfWeight = totalValue > 0 ? (etfExposedVal / totalValue) * 100 : 0;
    if (etfWeight > 10) {
      list.push(`Strategic passive asset allocation (ETFs & Gold/Silver) sits at ${etfWeight.toFixed(1)}% of aggregate AUM, providing standard market exposure and hedging.`);
    }
    return list;
  }, [sectorData, aggregateHhi, tailHoldingsCount, aggregateHoldings, totalValue]);

  // Client Directory Sort
  const sortedClients = useMemo(() => {
    const list = [...clients];
    list.sort((a, b) => {
      let aVal = a[clientSortCol];
      let bVal = b[clientSortCol];
      
      if (clientSortCol === 'pnlPct') {
        aVal = a.invested > 0 ? (a.pnl / a.invested) * 100 : 0;
        bVal = b.invested > 0 ? (b.pnl / b.invested) * 100 : 0;
      }
      
      if (typeof aVal === 'string') {
        return clientSortOrder === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return clientSortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [clients, clientSortCol, clientSortOrder]);

  const handleSortClients = (col: string) => {
    if (clientSortCol === col) {
      setClientSortOrder(clientSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setClientSortCol(col);
      setClientSortOrder('desc');
    }
  };

  // ── Smart Search Derived Data ───────────────────────────────────────────────

  // Mode 1: Stock Lookup
  const stockSearchResults = useMemo(() => {
    const q = stockQuery.trim().toLowerCase();
    if (!q) return [];
    return data
      .filter(h =>
        (h.nse_symbol || '').toLowerCase().includes(q) ||
        (h.stock_symbol || '').toLowerCase().includes(q) ||
        (h.company_name || '').toLowerCase().includes(q)
      )
      .sort((a, b) => (b.current_value || 0) - (a.current_value || 0));
  }, [data, stockQuery]);

  const stockSearchTotals = useMemo(() => {
    if (stockSearchResults.length === 0) return null;
    const totalQty = stockSearchResults.reduce((s, h) => s + (h.quantity || 0), 0);
    const totalInv = stockSearchResults.reduce((s, h) => s + (h.invested_amount || h.buy_price * h.quantity || 0), 0);
    const totalVal = stockSearchResults.reduce((s, h) => s + (h.current_value || 0), 0);
    const totalPnl = stockSearchResults.reduce((s, h) => s + (h.unrealised_pnl || 0), 0);
    const pnlPct = totalInv > 0 ? (totalPnl / totalInv) * 100 : 0;
    return { totalQty, totalInv, totalVal, totalPnl, pnlPct };
  }, [stockSearchResults]);

  // Mode 2: Free Cash Clients
  const freeCashClients = useMemo(() => {
    return clients
      .map(c => ({
        ...c,
        freeCash: Math.max(0, (c.totalCapital || 0) - (c.invested || 0) - (c.mutual_funds || 0)),
        freeCashPct: c.totalCapital > 0
          ? Math.max(0, ((c.totalCapital - c.invested - (c.mutual_funds || 0)) / c.totalCapital) * 100)
          : 0,
      }))
      .filter(c => c.freeCash >= cashMinFilter)
      .sort((a, b) => b.freeCash - a.freeCash);
  }, [clients, cashMinFilter]);

  // Mode 3: Client Lookup
  const clientSearchResults = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return [];
    const matchedClients = clients.filter(c =>
      (c.name || '').toLowerCase().includes(q)
    );
    return matchedClients.map(c => ({
      ...c,
      holdings: data
        .filter(h => h.client_id === c.id)
        .sort((a, b) => (b.current_value || 0) - (a.current_value || 0)),
    }));
  }, [clients, clientQuery, data]);

  // Mode 4: Sector Drill-down
  const allSectors = useMemo(() => {
    return Array.from(new Set(data.map(h => getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '').sector)))
      .filter(Boolean)
      .sort();
  }, [data]);

  const sectorDrilldown = useMemo(() => {
    if (!selectedSector) return [];
    return data
      .filter(h => {
        const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
        return meta.sector === selectedSector;
      })
      .sort((a, b) => (b.current_value || 0) - (a.current_value || 0));
  }, [data, selectedSector]);

  const sectorDrilldownTotals = useMemo(() => {
    if (sectorDrilldown.length === 0) return null;
    const totalVal = sectorDrilldown.reduce((s, h) => s + (h.current_value || 0), 0);
    const totalInv = sectorDrilldown.reduce((s, h) => s + (h.invested_amount || h.buy_price * h.quantity || 0), 0);
    const totalPnl = sectorDrilldown.reduce((s, h) => s + (h.unrealised_pnl || 0), 0);
    const pnlPct = totalInv > 0 ? (totalPnl / totalInv) * 100 : 0;
    const aumPct = totalValue > 0 ? (totalVal / totalValue) * 100 : 0;
    return { totalVal, totalInv, totalPnl, pnlPct, aumPct };
  }, [sectorDrilldown, totalValue]);

  // Mode 5: RM-wise Search
  const rmClients = useMemo(() => {
    if (!selectedRm) return [];
    const matchedClients = clients.filter(c => c.rm === selectedRm);
    return matchedClients.map(c => ({
      ...c,
      holdings: data
        .filter(h => h.client_id === c.id)
        .sort((a, b) => (b.current_value || 0) - (a.current_value || 0)),
    }));
  }, [clients, selectedRm, data]);

  const handleAddRm = async () => {
    const name = newRmName.trim();
    if (!name) return;
    try {
      const { setDoc } = await import('firebase/firestore');
      const newList = [...rmList, name];
      await setDoc(doc(db, 'settings', 'rm_list'), { rms: newList }, { merge: true });
      setRmList(newList);
      setNewRmName('');
      alert('RM Added successfully!');
    } catch (e) {
      console.error(e);
      alert('Failed to add RM');
    }
  };

  // Buy modal suggested quantity
  const suggestedBuyQty = useMemo(() => {
    const price = parseFloat(buyPrice);
    if (!buyModalData || !price || price <= 0) return 0;
    const cashToDeploy = buyModalData.freeCash * (deployPct / 100);
    return Math.floor(cashToDeploy / price);
  }, [buyModalData, buyPrice, deployPct]);

  const buyCost = useMemo(() => {
    const qty = parseFloat(buyQty) || suggestedBuyQty;
    const price = parseFloat(buyPrice) || 0;
    return qty * price;
  }, [buyQty, buyPrice, suggestedBuyQty]);

  // Sell modal realised P&L preview
  const sellPnlPreview = useMemo(() => {
    if (!sellModalData) return null;
    const qty = parseFloat(sellQty) || 0;
    const price = parseFloat(sellPrice) || 0;
    const holding = sellModalData.holding;
    const investedPerUnit = holding.invested_amount > 0 && holding.quantity > 0
      ? holding.invested_amount / holding.quantity
      : holding.buy_price;
    const realisedPnl = qty * price - qty * investedPerUnit;
    const realisedPct = investedPerUnit > 0 ? (realisedPnl / (qty * investedPerUnit)) * 100 : 0;
    return { realisedPnl, realisedPct, totalValue: qty * price };
  }, [sellModalData, sellQty, sellPrice]);

  // ── Reload all data after trade ───────────────────────────────────────────
  const reloadData = async () => {
    try {
      const [holdingSnap, clientSnap] = await Promise.all([
        getDocs(collection(db, 'holdings')),
        getDocs(collection(db, 'clients')),
      ]);
      const clientMap: Record<string, { name: string; totalCapital: number; mutual_funds: number; rm: string }> = {};
      clientSnap.docs.forEach(d => {
        const cdata = d.data();
        clientMap[d.id] = { name: cdata.name ?? 'Unknown', totalCapital: cdata.total_capital ?? 0, mutual_funds: cdata.mutual_funds ?? 0, rm: cdata.rm_name ?? 'Unassigned' };
      });
      const holdings = holdingSnap.docs.map(d => {
        const h = d.data() as any;
        const clin = clientMap[h.client_id] || { name: 'Unknown', totalCapital: 0, mutual_funds: 0 };
        return { ...h, id: d.id, client_name: clin.name } as HoldingWithClient;
      });
      setData(holdings);
      const clientGroups = holdings.reduce((acc, h) => {
        if (!acc[h.client_id]) {
          acc[h.client_id] = { id: h.client_id, name: h.client_name, invested: 0, value: 0, pnl: 0, stockCount: 0, etfCount: 0, totalCapital: clientMap[h.client_id]?.totalCapital ?? 0, mutual_funds: clientMap[h.client_id]?.mutual_funds ?? 0, rm: clientMap[h.client_id]?.rm ?? 'Unassigned' };
        }
        const val = h.current_value || h.buy_price * h.quantity;
        const inv = h.invested_amount || h.buy_price * h.quantity;
        acc[h.client_id].invested += inv;
        acc[h.client_id].value += val;
        acc[h.client_id].pnl += (h.unrealised_pnl || 0);
        const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
        if (meta.assetClass === 'ETF' || meta.assetClass === 'Commodity') acc[h.client_id].etfCount++;
        else acc[h.client_id].stockCount++;
        return acc;
      }, {} as Record<string, any>);
      clientSnap.docs.forEach(d => {
        if (!clientGroups[d.id]) {
          clientGroups[d.id] = { id: d.id, name: d.data().name ?? 'Unknown', invested: 0, value: 0, pnl: 0, stockCount: 0, etfCount: 0, totalCapital: d.data().total_capital ?? 0, mutual_funds: d.data().mutual_funds ?? 0, rm: d.data().rm_name ?? 'Unassigned' };
        }
      });
      setClients(Object.values(clientGroups));
    } catch (err) {
      console.error('reloadData error:', err);
    }
  };

  // ── Bulk Buy Handler ───────────────────────────────────────────────────────
  const handleBulkBuy = async () => {
    if (!buyModalData) return;
    const sym = buySymbol.trim().toUpperCase();
    const price = parseFloat(buyPrice);
    const qty = parseFloat(buyQty) || suggestedBuyQty;
    if (!sym || !price || !qty) { alert('Please enter symbol, price and quantity'); return; }
    if (qty * price > buyModalData.freeCash) {
      if (!confirm(`Cost ₹${(qty * price).toLocaleString('en-IN')} exceeds free cash ₹${buyModalData.freeCash.toLocaleString('en-IN')}. Proceed anyway?`)) return;
    }
    setSaving(true);
    try {
      const meta = getStockMeta(sym);
      const company_name = meta.companyName || '';
      await addDoc(collection(db, 'holdings'), {
        client_id: buyModalData.clientId,
        stock_symbol: sym,
        nse_symbol: sym,
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
        client_id: buyModalData.clientId,
        date: new Date().toISOString().split('T')[0],
        action: 'BUY',
        stock_symbol: sym,
        company_name,
        quantity: qty,
        price,
        total_value: qty * price,
        created_at: new Date().toISOString(),
      });
      setBuyModalData(null);
      setBuySymbol(''); setBuyPrice(''); setBuyQty(''); setDeployPct(50);
      await reloadData();
    } catch (err) {
      console.error(err);
      alert('Failed to add holding');
    } finally {
      setSaving(false);
    }
  };

  // ── Bulk Sell Handler ──────────────────────────────────────────────────────
  const handleBulkSell = async () => {
    if (!sellModalData) return;
    const qty = parseFloat(sellQty);
    const price = parseFloat(sellPrice);
    const holding = sellModalData.holding;
    if (!qty || !price || qty > holding.quantity) { alert('Invalid quantity or price'); return; }
    setSaving(true);
    try {
      const remainingQty = holding.quantity - qty;
      const investedPerUnit = holding.invested_amount > 0 && holding.quantity > 0
        ? holding.invested_amount / holding.quantity : holding.buy_price;
      const profitLoss = qty * price - qty * investedPerUnit;
      if (remainingQty > 0) {
        await updateDoc(doc(db, 'holdings', holding.id), {
          quantity: remainingQty,
          current_value: remainingQty * holding.current_price,
          invested_amount: investedPerUnit * remainingQty,
          unrealised_pnl: remainingQty * holding.current_price - investedPerUnit * remainingQty,
          unrealised_pnl_pct: investedPerUnit > 0 ? ((remainingQty * holding.current_price - investedPerUnit * remainingQty) / (investedPerUnit * remainingQty)) * 100 : 0,
          realised_pnl: ((holding as any).realised_pnl || 0) + profitLoss,
        });
      } else {
        await deleteDoc(doc(db, 'holdings', holding.id));
      }
      await addDoc(collection(db, 'transactions'), {
        client_id: sellModalData.clientId,
        date: new Date().toISOString().split('T')[0],
        action: 'SELL',
        stock_symbol: holding.stock_symbol,
        company_name: holding.company_name,
        quantity: qty,
        price,
        total_value: qty * price,
        created_at: new Date().toISOString(),
      });
      setSellModalData(null);
      setSellPrice(''); setSellQty('');
      await reloadData();
    } catch (err) {
      console.error(err);
      alert('Failed to sell holding');
    } finally {
      setSaving(false);
    }
  };

  // ── Bulk Order Executions ──────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Spinner size={36} />
    </div>
  );

  return (
    <div className="animate-fade-in" style={{ paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.8px', margin: 0 }}>
            Firm Analytics
          </h1>
          <p style={{ color: '#555555', fontSize: 15, marginTop: 4 }}>
            Aggregated dashboard & firm-wide management settings
          </p>
        </div>
        <button 
          onClick={() => setBulkWizard({ mode: 'buy' })}
          style={{ padding: '10px 20px', background: '#C9A84C', color: '#000', borderRadius: 8, fontWeight: 800, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Briefcase size={18} /> New Bulk Order
        </button>
      </div>

      {/* ── Smart Search Panel ──────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 24, marginBottom: 32 }}>

        {/* Tab strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Search size={18} color="#C9A84C" />
          <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>
            Smart Search
          </h3>
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 3, gap: 2 }}>
            {([
              { key: 'stock', label: 'Stock', icon: <Search size={13} style={{ marginRight: 6 }} /> },
              { key: 'cash', label: 'Free Cash', icon: <Briefcase size={13} style={{ marginRight: 6 }} /> },
              { key: 'client', label: 'Client', icon: <Users size={13} style={{ marginRight: 6 }} /> },
              { key: 'rm', label: 'By RM', icon: <Briefcase size={13} style={{ marginRight: 6 }} /> },
              { key: 'risk', label: 'Risk Profile', icon: <Users size={13} style={{ marginRight: 6 }} /> },
              { key: 'sector', label: 'Sector', icon: <Building2 size={13} style={{ marginRight: 6 }} /> },
              { key: 'settings', label: 'Settings', icon: <ShieldCheck size={13} style={{ marginRight: 6 }} /> },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setSearchMode(tab.key)}
                style={{
                  padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center',
                  background: searchMode === tab.key ? '#C9A84C' : 'transparent',
                  color: searchMode === tab.key ? '#000000' : '#777777',
                  transition: 'all 0.15s',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── MODE 1: Stock Lookup ── */}
        {searchMode === 'stock' && (
          <div>
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <input
                type="text" autoFocus
                placeholder="Type a symbol or company name (e.g. SBIN, IRFC, Reliance)…"
                value={stockQuery}
                onChange={e => setStockQuery(e.target.value)}
                style={{
                  width: '100%', padding: '12px 40px 12px 40px', fontSize: 14, borderRadius: 8, boxSizing: 'border-box',
                  background: 'rgba(0,0,0,0.04)', color: 'var(--text-primary)',
                  border: '1px solid rgba(0,0,0,0.10)', outline: 'none', transition: 'border-color 0.15s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(201,168,76,0.55)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.10)'}
              />
              <Search size={16} color="#555" style={{ position: 'absolute', left: 14, top: 14, pointerEvents: 'none' }} />
              {stockQuery && (
                <button onClick={() => setStockQuery('')} style={{ position: 'absolute', right: 12, top: 10, background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
              )}
            </div>
            
            {stockQuery && stockSearchResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                No existing holdings found for <strong style={{ color: '#C9A84C' }}>"{stockQuery}"</strong>
              </div>
            )}
            
            {stockSearchResults.length > 0 && (
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <strong style={{ color: '#C9A84C' }}>{stockSearchResults.length}</strong> client holding{stockSearchResults.length !== 1 ? 's' : ''} matching <strong style={{ color: 'var(--text-primary)' }}>"{stockQuery}"</strong>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
                      <th style={{ padding: '10px 12px', width: 40 }}>
                        <input 
                          type="checkbox" 
                          checked={selectedStockRows.size > 0 && selectedStockRows.size === stockSearchResults.length}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedStockRows(new Set(stockSearchResults.map(h => h.client_id)));
                            else setSelectedStockRows(new Set());
                          }} 
                        />
                      </th>
                      {['Client', 'Symbol', 'Company', 'Qty', 'Avg Buy', 'Curr Price', 'Value', 'Unreal P&L', 'Action'].map(col => (
                        <th key={col} style={{ padding: '10px 12px', textAlign: ['Client', 'Symbol', 'Company'].includes(col) ? 'left' : 'right', fontWeight: 800, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stockSearchResults.map((h, i) => {
                      const pnl = h.unrealised_pnl || 0;
                      const pnlPct = (h.invested_amount || 0) > 0 ? (pnl / h.invested_amount) * 100 : 0;
                      const avgBuy = h.buy_price || 0;
                      const currPrice = h.current_price || 0;
                      const isSelected = selectedStockRows.has(h.client_id);
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)', transition: 'background 0.15s', background: isSelected ? 'rgba(201,168,76,0.05)' : 'transparent' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = isSelected ? 'rgba(201,168,76,0.05)' : 'rgba(0,0,0,0.01)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = isSelected ? 'rgba(201,168,76,0.05)' : 'transparent'}
                        >
                          <td style={{ padding: '12px 12px' }}>
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => {
                                const next = new Set(selectedStockRows);
                                if (next.has(h.client_id)) next.delete(h.client_id);
                                else next.add(h.client_id);
                                setSelectedStockRows(next);
                              }}
                            />
                          </td>
                          <td style={{ padding: '12px 12px', fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer' }} onClick={() => navigate(`/client/${h.client_id}`)}>{h.client_name}</td>
                          <td style={{ padding: '12px 12px', fontWeight: 800, color: '#C9A84C', fontFamily: 'monospace' }}>{h.nse_symbol || h.stock_symbol}</td>
                          <td style={{ padding: '12px 12px', color: '#666', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.company_name}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{h.quantity.toLocaleString('en-IN')}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', color: '#777', fontFamily: 'monospace' }}>₹{avgBuy.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', color: '#666', fontFamily: 'monospace' }}>{currPrice > 0 ? `₹${currPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700, color: '#C9A84C', fontFamily: 'monospace' }}>{fmtCurrency(h.current_value || 0)}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                            <span style={{ padding: '3px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: 'monospace', background: pnl >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', color: pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                              {pnl >= 0 ? '+' : ''}{fmtCurrency(pnl)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                            </span>
                          </td>
                          <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                            <button
                              onClick={() => { setSellModalData({ clientId: h.client_id, clientName: h.client_name, holding: h }); setSellQty(String(h.quantity)); setSellPrice(String(h.current_price || '')); }}
                              style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >Sell →</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {stockSearchTotals && (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid rgba(201,168,76,0.2)', background: 'rgba(201,168,76,0.03)' }}>
                        <td colSpan={2}></td>
                        <td style={{ padding: '11px 12px', fontWeight: 800, color: '#C9A84C', fontSize: 11, textTransform: 'uppercase' }} colSpan={3}>Total ({stockSearchResults.length} clients)</td>
                        <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{stockSearchTotals.totalQty.toLocaleString('en-IN')}</td>
                        <td colSpan={2}></td>
                        <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800, color: '#C9A84C', fontFamily: 'monospace' }}>{fmtCurrency(stockSearchTotals.totalVal)}</td>
                        <td style={{ padding: '11px 12px', textAlign: 'right' }}>
                          <span style={{ padding: '3px 7px', borderRadius: 4, fontSize: 11, fontWeight: 800, fontFamily: 'monospace', background: stockSearchTotals.totalPnl >= 0 ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)', color: stockSearchTotals.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
                            {stockSearchTotals.totalPnl >= 0 ? '+' : ''}{fmtCurrency(stockSearchTotals.totalPnl)} ({stockSearchTotals.pnlPct >= 0 ? '+' : ''}{stockSearchTotals.pnlPct.toFixed(1)}%)
                          </span>
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
            {!stockQuery && <div style={{ textAlign: 'center', padding: '18px 0', color: '#444', fontSize: 13 }}>Search across all {data.length} holdings from {clients.length} clients simultaneously</div>}
          </div>
        )}

        {/* ── MODE 2: Free Cash ── */}
        {searchMode === 'cash' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Min Free Cash:</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[0, 100000, 500000, 1000000, 5000000].map(v => (
                  <button key={v} onClick={() => setCashMinFilter(v)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid', cursor: 'pointer', fontSize: 12, fontWeight: 700, transition: 'all 0.15s', borderColor: cashMinFilter === v ? '#C9A84C' : 'rgba(0,0,0,0.10)', background: cashMinFilter === v ? 'rgba(201,168,76,0.12)' : 'transparent', color: cashMinFilter === v ? '#C9A84C' : '#777' }}>
                    {v === 0 ? 'All' : v >= 1000000 ? `≥₹${(v / 100000).toFixed(0)}L` : `≥₹${(v / 100000).toFixed(1)}L`}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                <strong style={{ color: '#C9A84C' }}>{freeCashClients.length}</strong> of {clients.length} clients
              </span>
            </div>
            {freeCashClients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>No clients above the threshold.</div>
            ) : (
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
                      {['#', 'Client', 'Total Capital', 'Deployed', 'Free Cash', 'Free %', 'Action'].map(col => (
                        <th key={col} style={{ padding: '10px 12px', textAlign: ['#', 'Client'].includes(col) ? 'left' : 'right', fontWeight: 800, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {freeCashClients.map((c, i) => {
                      const pct = c.freeCashPct;
                      const pillColor = pct >= 20 ? '#22c55e' : pct >= 10 ? '#f59e0b' : '#ef4444';
                      const pillBg = pct >= 20 ? 'rgba(34,197,94,0.08)' : pct >= 10 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';
                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)', transition: 'background 0.15s' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(201,168,76,0.02)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                        >
                          <td style={{ padding: '13px 12px', color: 'var(--text-muted)', fontWeight: 700, width: 32 }}>#{i + 1}</td>
                          <td style={{ padding: '13px 12px', fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer' }} onClick={() => navigate(`/client/${c.id}`)}>{c.name}</td>
                          <td style={{ padding: '13px 12px', textAlign: 'right', color: '#666', fontFamily: 'monospace' }}>{fmtCurrency(c.totalCapital || 0)}</td>
                          <td style={{ padding: '13px 12px', textAlign: 'right', color: '#777', fontFamily: 'monospace' }}>{fmtCurrency(c.invested || 0)}</td>
                          <td style={{ padding: '13px 12px', textAlign: 'right', fontWeight: 800, color: '#C9A84C', fontFamily: 'monospace', fontSize: 14 }}>{fmtCurrency(c.freeCash)}</td>
                          <td style={{ padding: '13px 12px', textAlign: 'right' }}>
                            <span style={{ padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 800, background: pillBg, color: pillColor, fontFamily: 'monospace' }}>{pct.toFixed(1)}%</span>
                          </td>
                          <td style={{ padding: '13px 12px', textAlign: 'right' }}>
                            <button
                              onClick={() => { setBuyModalData({ clientId: c.id, clientName: c.name, freeCash: c.freeCash }); setBuySymbol(''); setBuyPrice(''); setBuyQty(''); setDeployPct(50); }}
                              style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >Buy Stock →</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── MODE 3: Client Lookup ── */}
        {searchMode === 'client' && (
          <div>
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <input
                type="text" autoFocus
                placeholder="Type a client name…"
                value={clientQuery}
                onChange={e => setClientQuery(e.target.value)}
                style={{ width: '100%', padding: '12px 40px 12px 40px', fontSize: 14, borderRadius: 8, boxSizing: 'border-box', background: 'rgba(0,0,0,0.04)', color: 'var(--text-primary)', border: '1px solid rgba(0,0,0,0.10)', outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(201,168,76,0.55)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.10)'}
              />
              <Search size={16} color="#555" style={{ position: 'absolute', left: 14, top: 14, pointerEvents: 'none' }} />
              {clientQuery && <button onClick={() => setClientQuery('')} style={{ position: 'absolute', right: 12, top: 10, background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>}
            </div>
            {clientQuery && clientSearchResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>No client found for <strong style={{ color: '#C9A84C' }}>"{clientQuery}"</strong></div>
            )}
            {clientSearchResults.map(c => {
              const freeCash = Math.max(0, (c.totalCapital || 0) - (c.invested || 0) - (c.mutual_funds || 0));
              return (
                <div key={c.id} style={{ background: 'rgba(0,0,0,0.02)', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid rgba(0,0,0,0.05)' }}>
                  {/* Client summary bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                    <input 
                      type="checkbox"
                      checked={selectedClientRows.has(c.id)}
                      onChange={() => {
                        const next = new Set(selectedClientRows);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        setSelectedClientRows(next);
                      }}
                      style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 16, cursor: 'pointer' }} onClick={() => navigate(`/client/${c.id}`)}>{c.name} <ChevronRight size={14} style={{ verticalAlign: 'middle', color: 'var(--text-muted)' }} /></div>
                    {[
                      { label: 'Valuation', val: fmtCurrency(c.value || 0), color: '#C9A84C' },
                      { label: 'Free Cash', val: fmtCurrency(freeCash), color: freeCash > 0 ? '#22c55e' : '#555' },
                      { label: 'P&L', val: `${c.pnl >= 0 ? '+' : ''}${fmtCurrency(c.pnl || 0)}`, color: c.pnl >= 0 ? '#22c55e' : '#ef4444' },
                      { label: 'Positions', val: `${c.holdings.length}`, color: '#8b5cf6' },
                    ].map(stat => (
                      <div key={stat.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: stat.color, fontFamily: 'monospace' }}>{stat.val}</div>
                      </div>
                    ))}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => { setBuyModalData({ clientId: c.id, clientName: c.name, freeCash }); setBuySymbol(''); setBuyPrice(''); setBuyQty(''); setDeployPct(50); }}
                        style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >+ Buy</button>
                    </div>
                  </div>
                  {/* Holdings mini-table */}
                  {c.holdings.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                          {['Symbol', 'Company', 'Qty', 'Buy Price', 'Curr Price', 'Value', 'P&L', 'Action'].map(col => (
                            <th key={col} style={{ padding: '6px 10px', textAlign: ['Symbol', 'Company'].includes(col) ? 'left' : 'right', fontWeight: 700, color: '#444', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {c.holdings.map((h: HoldingWithClient, j: number) => {
                          const pnl = h.unrealised_pnl || 0;
                          const pnlPct = (h.invested_amount || 0) > 0 ? (pnl / h.invested_amount) * 100 : 0;
                          return (
                            <tr key={j} style={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>
                              <td style={{ padding: '8px 10px', fontWeight: 700, color: '#C9A84C', fontFamily: 'monospace' }}>{h.nse_symbol || h.stock_symbol}</td>
                              <td style={{ padding: '8px 10px', color: '#666', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.company_name}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{h.quantity.toLocaleString('en-IN')}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#777', fontFamily: 'monospace' }}>₹{h.buy_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#666', fontFamily: 'monospace' }}>{h.current_price > 0 ? `₹${h.current_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#C9A84C', fontFamily: 'monospace' }}>{fmtCurrency(h.current_value || 0)}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: pnl >= 0 ? '#22c55e' : '#ef4444' }}>{pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</span>
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                <button onClick={() => { setSellModalData({ clientId: c.id, clientName: c.name, holding: h }); setSellQty(String(h.quantity)); setSellPrice(String(h.current_price || '')); }} style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.30)', background: 'rgba(239,68,68,0.07)', color: '#ef4444', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Sell</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-muted)', fontSize: 12 }}>No holdings yet</div>
                  )}
                </div>
              );
            })}
            {!clientQuery && <div style={{ textAlign: 'center', padding: '18px 0', color: '#444', fontSize: 13 }}>Search to view a client's full portfolio inline</div>}
          </div>
        )}

        {/* ── MODE 4: Sector Drill-down ── */}
        {searchMode === 'sector' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <Building2 size={15} color="#C9A84C" />
              <select
                value={selectedSector}
                onChange={e => setSelectedSector(e.target.value)}
                style={{ padding: '8px 14px', borderRadius: 7, background: 'rgba(0,0,0,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer', flex: 1, maxWidth: 320 }}
              >
                <option value="">— Select a Sector —</option>
                {allSectors.map(s => <option key={s} value={s} style={{ background: 'var(--bg-elevated)' }}>{s}</option>)}
              </select>
              {sectorDrilldownTotals && (
                <div style={{ display: 'flex', gap: 16, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  {[
                    { label: 'AUM Weight', val: `${sectorDrilldownTotals.aumPct.toFixed(1)}%`, color: '#C9A84C' },
                    { label: 'Total Value', val: fmtCurrency(sectorDrilldownTotals.totalVal), color: 'var(--text-primary)' },
                    { label: 'Unreal P&L', val: `${sectorDrilldownTotals.totalPnl >= 0 ? '+' : ''}${fmtCurrency(sectorDrilldownTotals.totalPnl)}`, color: sectorDrilldownTotals.totalPnl >= 0 ? '#22c55e' : '#ef4444' },
                  ].map(stat => (
                    <div key={stat.label} style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: stat.color, fontFamily: 'monospace' }}>{stat.val}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedSector && sectorDrilldown.length === 0 && <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>No holdings in this sector.</div>}
            {sectorDrilldown.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', background: 'rgba(0,0,0,0.01)' }}>
                      {['Client', 'Symbol', 'Company', 'Qty', 'Avg Buy', 'Curr Price', 'Value', 'Unreal P&L', 'AUM %'].map(col => (
                        <th key={col} style={{ padding: '10px 12px', textAlign: ['Client', 'Symbol', 'Company'].includes(col) ? 'left' : 'right', fontWeight: 800, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sectorDrilldown.map((h, i) => {
                      const pnl = h.unrealised_pnl || 0;
                      const pnlPct = (h.invested_amount || 0) > 0 ? (pnl / h.invested_amount) * 100 : 0;
                      const aumPct = totalValue > 0 ? ((h.current_value || 0) / totalValue) * 100 : 0;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)', transition: 'background 0.15s', cursor: 'pointer' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(201,168,76,0.02)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          onClick={() => navigate(`/client/${h.client_id}`)}
                        >
                          <td style={{ padding: '12px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>{h.client_name}</td>
                          <td style={{ padding: '12px 12px', fontWeight: 800, color: '#C9A84C', fontFamily: 'monospace' }}>{h.nse_symbol || h.stock_symbol}</td>
                          <td style={{ padding: '12px 12px', color: '#666', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.company_name}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{h.quantity.toLocaleString('en-IN')}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', color: '#777', fontFamily: 'monospace' }}>₹{h.buy_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', color: '#666', fontFamily: 'monospace' }}>{h.current_price > 0 ? `₹${h.current_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700, color: '#C9A84C', fontFamily: 'monospace' }}>{fmtCurrency(h.current_value || 0)}</td>
                          <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', padding: '3px 7px', borderRadius: 4, background: pnl >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', color: pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                              {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                            </span>
                          </td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', color: '#777', fontWeight: 700, fontFamily: 'monospace' }}>{aumPct.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!selectedSector && <div style={{ textAlign: 'center', padding: '18px 0', color: '#444', fontSize: 13 }}>Select a sector to see all holdings and their client exposure</div>}
          </div>
        )}

        {/* ── MODE 5: RM-wise Search ── */}
        {searchMode === 'rm' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <Users size={15} color="#C9A84C" />
              <select
                value={selectedRm}
                onChange={e => setSelectedRm(e.target.value)}
                style={{ padding: '8px 14px', borderRadius: 7, background: 'rgba(0,0,0,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer', flex: 1, maxWidth: 320 }}
              >
                <option value="">— Select a Relationship Manager —</option>
                {rmList.map(r => <option key={r} value={r} style={{ background: 'var(--bg-elevated)' }}>{r}</option>)}
                <option value="Unassigned" style={{ background: 'var(--bg-elevated)' }}>Unassigned</option>
              </select>
            </div>
            {selectedRm && rmClients.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>No clients found for <strong style={{ color: '#C9A84C' }}>{selectedRm}</strong></div>
            )}
            {rmClients.map(c => {
              const freeCash = Math.max(0, (c.totalCapital || 0) - (c.invested || 0) - (c.mutual_funds || 0));
              return (
                <div key={c.id} style={{ background: 'rgba(0,0,0,0.02)', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid rgba(0,0,0,0.05)' }}>
                  {/* Client summary bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 16, cursor: 'pointer' }} onClick={() => navigate(`/client/${c.id}`)}>{c.name} <ChevronRight size={14} style={{ verticalAlign: 'middle', color: 'var(--text-muted)' }} /></div>
                    {[
                      { label: 'Valuation', val: fmtCurrency(c.value || 0), color: '#C9A84C' },
                      { label: 'Free Cash', val: fmtCurrency(freeCash), color: freeCash > 0 ? '#22c55e' : '#555' },
                      { label: 'P&L', val: `${c.pnl >= 0 ? '+' : ''}${fmtCurrency(c.pnl || 0)}`, color: c.pnl >= 0 ? '#22c55e' : '#ef4444' },
                      { label: 'Positions', val: `${c.holdings.length}`, color: '#8b5cf6' },
                    ].map(stat => (
                      <div key={stat.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: stat.color, fontFamily: 'monospace' }}>{stat.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {!selectedRm && <div style={{ textAlign: 'center', padding: '18px 0', color: '#444', fontSize: 13 }}>Select an RM to view their assigned clients</div>}
          </div>
        )}

        {/* ── MODE: Risk Profile Search ── */}
        {searchMode === 'risk' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <Users size={15} color="#C9A84C" />
              <select
                value={selectedRiskProfile}
                onChange={e => setSelectedRiskProfile(e.target.value)}
                style={{ padding: '8px 14px', borderRadius: 7, background: 'rgba(0,0,0,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer', flex: 1, maxWidth: 320 }}
              >
                <option value="">— Select a Risk Profile —</option>
                <option value="Aggressive" style={{ background: 'var(--bg-elevated)' }}>Aggressive</option>
                <option value="Moderate" style={{ background: 'var(--bg-elevated)' }}>Moderate</option>
                <option value="Conservative" style={{ background: 'var(--bg-elevated)' }}>Conservative</option>
                <option value="Unassigned" style={{ background: 'var(--bg-elevated)' }}>Unassigned</option>
              </select>
            </div>
            {selectedRiskProfile && (clients.filter(c => (c.risk_profile || 'Unassigned') === selectedRiskProfile).length === 0) && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>No clients found for <strong style={{ color: '#C9A84C' }}>{selectedRiskProfile}</strong></div>
            )}
            {clients.filter(c => (c.risk_profile || 'Unassigned') === selectedRiskProfile).map(c => {
              const freeCash = Math.max(0, (c.totalCapital || 0) - (c.invested || 0) - (c.mutual_funds || 0));
              return (
                <div key={c.id} style={{ background: 'rgba(0,0,0,0.02)', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid rgba(0,0,0,0.05)' }}>
                  {/* Client summary bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 16, cursor: 'pointer' }} onClick={() => navigate(`/client/${c.id}`)}>{c.name} <ChevronRight size={14} style={{ verticalAlign: 'middle', color: 'var(--text-muted)' }} /></div>
                    {[
                      { label: 'Valuation', val: fmtCurrency(c.value || 0), color: '#C9A84C' },
                      { label: 'Free Cash', val: fmtCurrency(freeCash), color: freeCash > 0 ? '#22c55e' : '#555' },
                      { label: 'P&L', val: `${c.pnl >= 0 ? '+' : ''}${fmtCurrency(c.pnl || 0)}`, color: c.pnl >= 0 ? '#22c55e' : '#ef4444' },
                      { label: 'Positions', val: `${c.holdings?.length || 0}`, color: '#8b5cf6' },
                    ].map(stat => (
                      <div key={stat.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: stat.color, fontFamily: 'monospace' }}>{stat.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {!selectedRiskProfile && <div style={{ textAlign: 'center', padding: '18px 0', color: '#444', fontSize: 13 }}>Select a risk profile to view associated clients</div>}
          </div>
        )}

        {/* ── MODE 6: Settings ── */}
        {searchMode === 'settings' && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Relationship Managers</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>Manage the list of available Relationship Managers (RMs) across the firm.</p>
              
              <div style={{ display: 'flex', gap: 10, marginBottom: 24, maxWidth: 400 }}>
                <input
                  type="text"
                  placeholder="Enter new RM name..."
                  value={newRmName}
                  onChange={e => setNewRmName(e.target.value)}
                  style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(0,0,0,0.1)', outline: 'none', fontSize: 13 }}
                />
                <button
                  onClick={handleAddRm}
                  disabled={!newRmName.trim()}
                  style={{ padding: '0 20px', borderRadius: 8, background: newRmName.trim() ? '#C9A84C' : '#555', color: newRmName.trim() ? '#000' : '#aaa', border: 'none', fontWeight: 800, cursor: newRmName.trim() ? 'pointer' : 'not-allowed', fontSize: 13 }}
                >
                  Add RM
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {rmList.map(rm => (
                  <div key={rm} style={{ padding: '8px 14px', borderRadius: 20, background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                    {rm}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Buy Modal ─────────────────────────────────────────────────────────── */}
      {buyModalData && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 16, padding: 28, width: 460, maxWidth: '95vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--text-primary)' }}>Buy Stock</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Client: <span style={{ color: '#C9A84C', fontWeight: 700 }}>{buyModalData.clientName}</span></div>
              </div>
              <button onClick={() => setBuyModalData(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><XIcon size={20} /></button>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, padding: 12, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 8 }}>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Free Cash Available</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#22c55e', fontFamily: 'monospace' }}>{fmtCurrency(buyModalData.freeCash)}</div>
              </div>
            </div>
            {[
              { label: 'NSE Symbol', value: buySymbol, set: setBuySymbol, placeholder: 'e.g. SBIN', transform: (v: string) => v.toUpperCase() },
              { label: 'Buy Price (₹)', value: buyPrice, set: setBuyPrice, placeholder: 'e.g. 925.50', transform: (v: string) => v },
            ].map(field => (
              <div key={field.label} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{field.label}</label>
                <input type="text" value={field.value} onChange={e => field.set(field.transform(e.target.value))} placeholder={field.placeholder}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 7, background: 'rgba(0,0,0,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(0,0,0,0.10)', outline: 'none', fontSize: 14, boxSizing: 'border-box' }}
                  onFocus={e => e.currentTarget.style.borderColor = 'rgba(201,168,76,0.55)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.10)'}
                />
              </div>
            ))}
            {buyPrice && parseFloat(buyPrice) > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Deploy % of Free Cash: <span style={{ color: '#C9A84C' }}>{deployPct}%</span></label>
                <input type="range" min={10} max={100} step={5} value={deployPct} onChange={e => { setDeployPct(Number(e.target.value)); setDeployPct(Number(e.target.value)); }}
                  style={{ width: '100%', accentColor: '#C9A84C' }} />
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Suggested qty: <strong style={{ color: '#C9A84C' }}>{suggestedBuyQty.toLocaleString('en-IN')}</strong> shares @ ₹{parseFloat(buyPrice).toLocaleString('en-IN')} = <strong style={{ color: 'var(--text-primary)' }}>{fmtCurrency(suggestedBuyQty * parseFloat(buyPrice))}</strong>
                </div>
              </div>
            )}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Quantity {suggestedBuyQty > 0 ? `(suggested: ${suggestedBuyQty})` : ''}</label>
              <input type="number" value={buyQty || (suggestedBuyQty > 0 ? String(suggestedBuyQty) : '')} onChange={e => setBuyQty(e.target.value)} placeholder={suggestedBuyQty > 0 ? String(suggestedBuyQty) : 'Enter quantity'}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 7, background: 'rgba(0,0,0,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(0,0,0,0.10)', outline: 'none', fontSize: 14, boxSizing: 'border-box' }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(201,168,76,0.55)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.10)'}
              />
            </div>
            {buyCost > 0 && (
              <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: buyCost > buyModalData.freeCash ? 'rgba(239,68,68,0.07)' : 'rgba(201,168,76,0.07)', border: `1px solid ${buyCost > buyModalData.freeCash ? 'rgba(239,68,68,0.2)' : 'rgba(201,168,76,0.2)'}` }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: buyCost > buyModalData.freeCash ? '#ef4444' : '#C9A84C', fontFamily: 'monospace' }}>
                  Total Cost: {fmtCurrency(buyCost)} {buyCost > buyModalData.freeCash ? '⚠ Exceeds free cash' : '✓ Within free cash'}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setBuyModalData(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid rgba(0,0,0,0.10)', background: 'transparent', color: '#777', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleBulkBuy} disabled={saving || !buySymbol.trim() || !buyPrice} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: saving ? '#555' : '#22c55e', color: saving ? '#aaa' : '#000', fontSize: 13, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
                {saving ? 'Adding…' : 'Confirm Buy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sell Modal ─────────────────────────────────────────────────────────── */}
      {sellModalData && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 16, padding: 28, width: 460, maxWidth: '95vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--text-primary)' }}>Sell Holding</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  <span style={{ color: '#C9A84C', fontWeight: 700 }}>{sellModalData.clientName}</span> · <span style={{ color: '#ef4444', fontWeight: 700 }}>{sellModalData.holding.nse_symbol || sellModalData.holding.stock_symbol}</span>
                </div>
              </div>
              <button onClick={() => setSellModalData(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><XIcon size={20} /></button>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, padding: 12, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8 }}>
              {[
                { label: 'Holding Qty', val: sellModalData.holding.quantity.toLocaleString('en-IN') },
                { label: 'Avg Buy Price', val: `₹${sellModalData.holding.buy_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                { label: 'Current Price', val: sellModalData.holding.current_price > 0 ? `₹${sellModalData.holding.current_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' },
              ].map(stat => (
                <div key={stat.label} style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{stat.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{stat.val}</div>
                </div>
              ))}
            </div>
            {[
              { label: `Sell Quantity (max ${sellModalData.holding.quantity})`, value: sellQty, set: setSellQty, placeholder: `Max ${sellModalData.holding.quantity}`, type: 'number' },
              { label: 'Sell Price (₹)', value: sellPrice, set: setSellPrice, placeholder: 'e.g. 950.00', type: 'text' },
            ].map(field => (
              <div key={field.label} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{field.label}</label>
                <input type={field.type} value={field.value} onChange={e => field.set(e.target.value)} placeholder={field.placeholder}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 7, background: 'rgba(0,0,0,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(0,0,0,0.10)', outline: 'none', fontSize: 14, boxSizing: 'border-box' }}
                  onFocus={e => e.currentTarget.style.borderColor = 'rgba(239,68,68,0.55)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.10)'}
                />
              </div>
            ))}
            {sellPnlPreview && sellPnlPreview.totalValue > 0 && (
              <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: sellPnlPreview.realisedPnl >= 0 ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)', border: `1px solid ${sellPnlPreview.realisedPnl >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Proceeds: <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{fmtCurrency(sellPnlPreview.totalValue)}</strong></div>
                <div style={{ fontSize: 13, fontWeight: 800, color: sellPnlPreview.realisedPnl >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'monospace' }}>
                  Realised P&L: {sellPnlPreview.realisedPnl >= 0 ? '+' : ''}{fmtCurrency(sellPnlPreview.realisedPnl)} ({sellPnlPreview.realisedPct >= 0 ? '+' : ''}{sellPnlPreview.realisedPct.toFixed(2)}%)
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setSellModalData(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid rgba(0,0,0,0.10)', background: 'transparent', color: '#777', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleBulkSell} disabled={saving || !sellQty || !sellPrice} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: saving ? '#555' : '#ef4444', color: saving ? '#aaa' : '#fff', fontSize: 13, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
                {saving ? 'Selling…' : 'Confirm Sell'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkWizard && (
        <BulkOrderWizardModal
          onClose={() => setBulkWizard(null)}
          onSuccess={() => { setBulkWizard(null); setSelectedStockRows(new Set()); setSelectedClientRows(new Set()); reloadData(); }}
          clients={clients}
          initialMode={bulkWizard.mode}
          initialSymbol={bulkWizard.symbol ?? ''}
          initialSelectedClientIds={bulkWizard.selectedClientIds ?? []}
          holdingsData={bulkWizard.holdingsData ?? []}
        />
      )}

      {/* ── Floating Action Bar ──────────────────────────────────────────────── */}
      {(selectedStockRows.size > 0 || selectedClientRows.size > 0) && (
        <div className="animate-slide-up" style={{
          position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          borderRadius: 16, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 24,
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)', zIndex: 1000
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            {selectedStockRows.size > 0 ? selectedStockRows.size : selectedClientRows.size} Selected
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {selectedStockRows.size > 0 && (
              <>
                <button onClick={() => setBulkWizard({ mode: 'buy', symbol: stockQuery, selectedClientIds: Array.from(selectedStockRows) })} style={{ padding: '8px 16px', borderRadius: 8, background: '#22c55e', color: '#fff', border: 'none', fontWeight: 800, cursor: 'pointer' }}>Buy More</button>
                <button onClick={() => setBulkWizard({ mode: 'sell', symbol: stockQuery, selectedClientIds: Array.from(selectedStockRows), holdingsData: stockSearchResults })} style={{ padding: '8px 16px', borderRadius: 8, background: '#ef4444', color: '#fff', border: 'none', fontWeight: 800, cursor: 'pointer' }}>Bulk Sell</button>
              </>
            )}
            {selectedClientRows.size > 0 && (
              <button onClick={() => setBulkWizard({ mode: 'buy', selectedClientIds: Array.from(selectedClientRows) })} style={{ padding: '8px 16px', borderRadius: 8, background: '#C9A84C', color: '#000', border: 'none', fontWeight: 800, cursor: 'pointer' }}>Bulk Buy Stock</button>
            )}
            <button onClick={() => { setSelectedStockRows(new Set()); setSelectedClientRows(new Set()); }} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Aggregate KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 32 }}>
        {[
          { label: 'Total Firm AUM', value: fmtCurrency(totalValue), icon: <Briefcase size={16} />, color: '#C9A84C' },
          { label: 'Total Invested', value: fmtCurrency(totalInvested), icon: <Activity size={16} />, color: '#3b82f6' },
          { label: 'Unrealised P&L', value: `${totalPnL >= 0 ? '+' : ''}${fmtCurrency(totalPnL)}`, icon: totalPnL >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />, color: totalPnL >= 0 ? '#22c55e' : '#ef4444', subtitle: fmtPct(overallPnlPct) },
          { label: 'Total Clients', value: clients.length.toString(), icon: <Users size={16} />, color: '#a8dadc' },
          { label: 'Unique Securities', value: activeHoldingsCount.toString(), icon: <Award size={16} />, color: '#8b5cf6' }
        ].map((kpi, idx) => (
          <div key={idx} style={{
            background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.07)',
            borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column',
            justifyContent: 'space-between', minHeight: 100
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{kpi.label}</span>
              <div style={{
                width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: `${kpi.color}12`, border: `1px solid ${kpi.color}25`,
                color: kpi.color
              }}>{kpi.icon}</div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>{kpi.value}</div>
              {kpi.subtitle && (
                <div style={{ fontSize: 11, fontWeight: 700, color: kpi.color, marginTop: 2 }}>{kpi.subtitle}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Visual Analytics Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>
        {/* Aggregate Asset Class */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <PieIcon size={18} color="#C9A84C" />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Asset Class Allocation
            </h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'center' }}>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={assetClassData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40}>
                    {assetClassData.map((_, i) => <Cell key={i} fill={VIBRANT_PALETTE[i % VIBRANT_PALETTE.length] ?? '#888'} />)}
                  </Pie>
                  <ChartTooltip formatter={(v: any) => [`${v.toFixed(2)}%`]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {assetClassData.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: VIBRANT_PALETTE[i % VIBRANT_PALETTE.length] }} />
                    <span style={{ color: '#666', fontWeight: 600 }}>{d.name}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{d.value.toFixed(1)}%</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block' }}>{fmtCurrency(d.raw)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Aggregate Market Cap (Equity Only) */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <BarChart2 size={18} color="#C9A84C" />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Market Cap Distribution
            </h3>
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mcapData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}%`} axisLine={false} tickLine={false} />
                <ChartTooltip formatter={(v: any) => [`${v.toFixed(1)}%`]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' }} />
                <Bar dataKey="value" fill="#C9A84C" radius={[4, 4, 0, 0]} maxBarSize={35}>
                  {mcapData.map((entry, i) => (
                    <Cell key={i} fill={entry.name === 'Large' ? '#c9a84c' : entry.name === 'Mid' ? '#457b9d' : '#8b5cf6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Aggregate Sector Allocation Exposure & Observations Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 20, marginBottom: 32 }}>
        {/* Sector Allocation */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <Activity size={18} color="#C9A84C" />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Sector Concentration Exposure
            </h3>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sectorData.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#4b5563', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} width={130} />
                <ChartTooltip formatter={(v: any) => [`${v.toFixed(1)}%`]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, color: '#111827' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={15}>
                  {sectorData.slice(0, 8).map((entry, i) => (
                    <Cell key={i} fill={SECTOR_COLORS[entry.name] ?? VIBRANT_PALETTE[i % VIBRANT_PALETTE.length] ?? '#888'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Observations Panel */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <ShieldCheck size={18} color="#C9A84C" />
              <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Aggregate Observations
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {observations.map((obs, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9A84C', marginTop: 6, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: '#bbb', lineHeight: 1.5 }}>{obs}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 16, marginTop: 20 }}>
            <div style={{ background: 'rgba(0,0,0,0.02)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#555555', textTransform: 'uppercase' }}>Aggregate HHI Index</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#C9A84C', marginTop: 4 }}>{(aggregateHhi * 10000).toFixed(0)}</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.02)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#555555', textTransform: 'uppercase' }}>Effective Stock Conviction</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#C9A84C', marginTop: 4 }}>{effectiveStocksCount} Positions</div>
            </div>
          </div>
        </div>
      </div>

      {/* Clients Portfolio Directory */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 24, marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Users size={18} color="#C9A84C" />
          <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Client Portfolios Directory
          </h3>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', background: 'rgba(0,0,0,0.01)' }}>
                {['Client Name:name', 'AUM Capital:totalCapital', 'Valuation:value', 'Unrealised P&L:pnl', 'Net P&L %:pnlPct', 'Allocation Share:value', 'Positions (S / E):stockCount'].map(col => {
                  const parts = col.split(':');
                  const label = parts[0] ?? '';
                  const key = parts[1] ?? '';
                  const isSorted = clientSortCol === key;
                  return (
                    <th key={label} onClick={() => handleSortClients(key)} style={{
                      padding: '12px 16px', textAlign: label.includes('Client') ? 'left' : 'right',
                      fontWeight: 800, color: isSorted ? '#C9A84C' : '#555555', fontSize: 10,
                      textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer',
                      transition: 'color 0.15s'
                    }}>
                      {label} {isSorted && (clientSortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                  );
                })}
                <th style={{ padding: '12px 16px', width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {sortedClients.map((c) => {
                const pnl = c.pnl;
                const pnlPct = c.invested > 0 ? (pnl / c.invested) * 100 : 0;
                const weight = totalValue > 0 ? (c.value / totalValue) * 100 : 0;
                return (
                  <tr key={c.id} onClick={() => navigate(`/client/${c.id}`)} style={{
                    borderBottom: '1px solid rgba(0,0,0,0.03)', cursor: 'pointer',
                    transition: 'background 0.15s'
                  }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(201,168,76,0.02)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '16px 16px', fontWeight: 700, color: 'var(--text-primary)' }}>{c.name}</td>
                    <td style={{ padding: '16px 16px', textAlign: 'right', color: '#666', fontFamily: 'monospace' }}>{fmtCurrency(c.totalCapital)}</td>
                    <td style={{ padding: '16px 16px', textAlign: 'right', fontWeight: 700, color: '#C9A84C', fontFamily: 'monospace' }}>{fmtCurrency(c.value)}</td>
                    <td style={{ padding: '16px 16px', textAlign: 'right', fontWeight: 600, color: pnl >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'monospace' }}>
                      {pnl >= 0 ? '+' : ''}{fmtCurrency(pnl)}
                    </td>
                    <td style={{ padding: '16px 16px', textAlign: 'right' }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                        background: pnl >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                        color: pnl >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'monospace'
                      }}>
                        {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                      </span>
                    </td>
                    <td style={{ padding: '16px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{weight.toFixed(1)}%</td>
                    <td style={{ padding: '16px 16px', textAlign: 'right', color: '#777', fontWeight: 600 }}>{c.stockCount}s / {c.etfCount}e</td>
                    <td style={{ padding: '16px 16px', color: 'var(--text-muted)' }}><ChevronRight size={16} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Aggregate Holdings Explorer */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Briefcase size={18} color="#C9A84C" />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Firm-Wide Holdings Explorer
            </h3>
          </div>
          {/* Search */}
          <div style={{ position: 'relative', width: 260 }}>
            <input
              type="text"
              placeholder="Search scrip, name or sector..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px 8px 32px', fontSize: 12, borderRadius: 6,
                background: 'rgba(0,0,0,0.03)', color: 'var(--text-primary)',
                border: '1px solid rgba(0,0,0,0.08)', outline: 'none',
                transition: 'border-color 0.15s'
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'rgba(201,168,76,0.45)'}
              onBlur={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)'}
            />
            <Search size={14} color="#555" style={{ position: 'absolute', left: 10, top: 10 }} />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', background: 'rgba(0,0,0,0.01)' }}>
                {['Scrip', 'Asset Name', 'Sector', 'Avg Buy', 'Current Price', 'Quantity', 'Invested', 'Current Value', 'Unrealised P&L', 'Alloc %', 'Clients'].map(col => (
                  <th key={col} style={{
                    padding: '10px 14px', textAlign: ['Scrip', 'Asset Name', 'Sector'].includes(col) ? 'left' : 'right',
                    fontWeight: 800, color: '#555555', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px'
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredHoldings.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No securities match your search query.
                  </td>
                </tr>
              ) : (
                filteredHoldings.map((h: any, i) => {
                  const weight = totalValue > 0 ? (h.value / totalValue) * 100 : 0;
                  const avgBuy = h.invested / h.quantity;
                  const currPrice = h.value / h.quantity;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.01)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: '#C9A84C' }}>{h.symbol}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-primary)', fontWeight: 600 }}>{h.companyName}</td>
                      <td style={{ padding: '12px 14px', color: '#666', fontWeight: 600 }}>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: `${SECTOR_COLORS[h.sector] || '#333'}15`,
                          border: `1px solid ${SECTOR_COLORS[h.sector] || '#333'}25`,
                          color: SECTOR_COLORS[h.sector] || '#ccc'
                        }}>
                          {h.sector}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#999', fontFamily: 'monospace' }}>₹{avgBuy.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#666', fontFamily: 'monospace' }}>₹{currPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{h.quantity.toLocaleString('en-IN')}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#666', fontFamily: 'monospace' }}>{fmtCurrency(h.invested)}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#C9A84C', fontFamily: 'monospace' }}>{fmtCurrency(h.value)}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: h.pnl >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'monospace' }}>
                        {h.pnl >= 0 ? '+' : ''}{fmtCurrency(h.pnl)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{weight.toFixed(1)}%</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#8b5cf6' }}>{h.clientsCount} {h.clientsCount === 1 ? 'client' : 'clients'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
