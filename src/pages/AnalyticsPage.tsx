import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, Cell, PieChart, Pie,
  CartesianGrid
} from 'recharts';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Spinner } from '../components/Spinner';
import { getStockMeta, cleanSymbol } from '../lib/sectorMap';
import {
  TrendingUp, TrendingDown, Users, Briefcase, Award, BarChart2, PieChart as PieIcon, Activity,
  Search, ShieldCheck, ChevronRight
} from 'lucide-react';

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
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function AnalyticsPage() {
  const [data, setData] = useState<HoldingWithClient[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSortCol, setClientSortCol] = useState<string>('value');
  const [clientSortOrder, setClientSortOrder] = useState<'asc' | 'desc'>('desc');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [holdingSnap, clientSnap] = await Promise.all([
          getDocs(collection(db, 'holdings')),
          getDocs(collection(db, 'clients'))
        ]);

        const clientMap: Record<string, { name: string; totalCapital: number }> = {};
        
        clientSnap.docs.forEach(d => {
          const cdata = d.data();
          clientMap[d.id] = {
            name: cdata.name ?? 'Unknown',
            totalCapital: cdata.total_capital ?? 0
          };
        });

        const holdings = holdingSnap.docs.map(d => {
          const h = d.data() as any;
          const clin = clientMap[h.client_id] || { name: 'Unknown', totalCapital: 0 };
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
              totalCapital: clientMap[h.client_id]?.totalCapital ?? 0
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
              totalCapital: d.data().total_capital ?? 0
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
    if (sectorData.length > 0 && sectorData[0].value > 25) {
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

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Spinner size={36} />
    </div>
  );

  return (
    <div className="animate-fade-in" style={{ paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 900, color: '#ffffff', letterSpacing: '-0.8px', margin: 0 }}>
            Firm-Wide Analytics
          </h1>
          <p style={{ color: '#555555', fontSize: 15, marginTop: 4 }}>
            Aggregated dashboard across all client portfolios under management
          </p>
        </div>
      </div>

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
            background: '#111111', border: '1px solid rgba(255,255,255,0.07)',
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
              <div style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.5px' }}>{kpi.value}</div>
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
        <div style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <PieIcon size={18} color="#C9A84C" />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Asset Class Allocation
            </h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'center' }}>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={assetClassData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40}>
                    {assetClassData.map((_, i) => <Cell key={i} fill={VIBRANT_PALETTE[i % VIBRANT_PALETTE.length]} />)}
                  </Pie>
                  <ChartTooltip formatter={(v: any) => [`${v.toFixed(2)}%`]} contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {assetClassData.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: VIBRANT_PALETTE[i % VIBRANT_PALETTE.length] }} />
                    <span style={{ color: '#aaa', fontWeight: 600 }}>{d.name}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: '#ffffff', fontWeight: 800 }}>{d.value.toFixed(1)}%</span>
                    <span style={{ fontSize: 10, color: '#555', display: 'block' }}>{fmtCurrency(d.raw)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Aggregate Market Cap (Equity Only) */}
        <div style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <BarChart2 size={18} color="#C9A84C" />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Market Cap Distribution
            </h3>
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mcapData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#777', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#777', fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}%`} axisLine={false} tickLine={false} />
                <ChartTooltip formatter={(v: any) => [`${v.toFixed(1)}%`]} contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8 }} />
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
        <div style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <Activity size={18} color="#C9A84C" />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Sector Concentration Exposure
            </h3>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sectorData.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#777', fontSize: 10 }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#aaa', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} width={130} />
                <ChartTooltip formatter={(v: any) => [`${v.toFixed(1)}%`]} contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8 }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={15}>
                  {sectorData.slice(0, 8).map((entry, i) => (
                    <Cell key={i} fill={SECTOR_COLORS[entry.name] || VIBRANT_PALETTE[i % VIBRANT_PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Observations Panel */}
        <div style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <ShieldCheck size={18} color="#C9A84C" />
              <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 16, marginTop: 20 }}>
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#555555', textTransform: 'uppercase' }}>Aggregate HHI Index</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#C9A84C', marginTop: 4 }}>{(aggregateHhi * 10000).toFixed(0)}</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#555555', textTransform: 'uppercase' }}>Effective Stock Conviction</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#C9A84C', marginTop: 4 }}>{effectiveStocksCount} Positions</div>
            </div>
          </div>
        </div>
      </div>

      {/* Clients Portfolio Directory */}
      <div style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24, marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Users size={18} color="#C9A84C" />
          <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Client Portfolios Directory
          </h3>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
                {['Client Name:name', 'AUM Capital:totalCapital', 'Valuation:value', 'Unrealised P&L:pnl', 'Net P&L %:pnlPct', 'Allocation Share:value', 'Positions (S / E):stockCount'].map(col => {
                  const [label, key] = col.split(':');
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
                    borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer',
                    transition: 'background 0.15s'
                  }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(201,168,76,0.02)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '16px 16px', fontWeight: 700, color: '#ffffff' }}>{c.name}</td>
                    <td style={{ padding: '16px 16px', textAlign: 'right', color: '#aaa', fontFamily: 'monospace' }}>{fmtCurrency(c.totalCapital)}</td>
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
                    <td style={{ padding: '16px 16px', textAlign: 'right', fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{weight.toFixed(1)}%</td>
                    <td style={{ padding: '16px 16px', textAlign: 'right', color: '#777', fontWeight: 600 }}>{c.stockCount}s / {c.etfCount}e</td>
                    <td style={{ padding: '16px 16px', color: '#555' }}><ChevronRight size={16} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Aggregate Holdings Explorer */}
      <div style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Briefcase size={18} color="#C9A84C" />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                background: 'rgba(255,255,255,0.03)', color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.08)', outline: 'none',
                transition: 'border-color 0.15s'
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'rgba(201,168,76,0.45)'}
              onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
            />
            <Search size={14} color="#555" style={{ position: 'absolute', left: 10, top: 10 }} />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
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
                  <td colSpan={11} style={{ padding: '30px', textAlign: 'center', color: '#555' }}>
                    No securities match your search query.
                  </td>
                </tr>
              ) : (
                filteredHoldings.map((h: any, i) => {
                  const weight = totalValue > 0 ? (h.value / totalValue) * 100 : 0;
                  const avgBuy = h.invested / h.quantity;
                  const currPrice = h.value / h.quantity;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.01)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: '#C9A84C' }}>{h.symbol}</td>
                      <td style={{ padding: '12px 14px', color: '#ffffff', fontWeight: 600 }}>{h.companyName}</td>
                      <td style={{ padding: '12px 14px', color: '#aaa', fontWeight: 600 }}>
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
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#aaa', fontFamily: 'monospace' }}>₹{currPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#fff', fontWeight: 600 }}>{h.quantity.toLocaleString('en-IN')}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#aaa', fontFamily: 'monospace' }}>{fmtCurrency(h.invested)}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#C9A84C', fontFamily: 'monospace' }}>{fmtCurrency(h.value)}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: h.pnl >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'monospace' }}>
                        {h.pnl >= 0 ? '+' : ''}{fmtCurrency(h.pnl)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#ffffff', fontFamily: 'monospace' }}>{weight.toFixed(1)}%</td>
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
