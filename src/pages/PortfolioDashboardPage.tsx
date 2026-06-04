import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  LabelList,
} from 'recharts';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, Award, BarChart2, PieChart as PieIcon, Activity, Download, FileText, CheckCircle, Info } from 'lucide-react';
import { fetchClient, fetchHoldings, fetchTransactions, fetchMarketDataCache } from '../lib/queries';
import { fetchNifty500Returns, fetchStockMarketData } from '../lib/yahooFinance';
import type { BenchmarkReturn, StockMarketData } from '../lib/yahooFinance';
import { Spinner } from '../components/Spinner';
import type { Client, Holding } from '../types';
import { getStockMeta, cleanSymbol } from '../lib/sectorMap';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import NorthWealthLogo from '../assets/North_Wealth_White_Logo.png';
import { BenchmarkComparison, StockLevelAnalysis, RiskAndVolatilityTable, TransactionAnalytics } from '../components/Phase2Sections';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtCurrency(v: number) {
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// ─── Color Palettes (White Theme) ─────────────────────────────────────────────
// const VIBRANT_PALETTE = [
//   '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a',
//   '#0891b2', '#ca8a04', '#9333ea', '#e11d48', '#0d9488',
// ];

const SECTOR_COLORS: Record<string, string> = {
  'Banking': '#2563eb', 'Information Technology': '#7c3aed', 'FMCG': '#db2777',
  'Financial Services': '#0284c7', 'Energy & Oil': '#ea580c', 'Pharma & Healthcare': '#16a34a',
  'Automobiles': '#ca8a04', 'Metals & Mining': '#57534e', 'Capital Goods': '#0891b2',
  'Power & Utilities': '#4f46e5', 'Cement': '#78716c', 'Real Estate': '#0d9488',
  'Telecom': '#c026d3', 'Consumer Discretionary': '#e11d48', 'Chemicals': '#65a30d',
  'Conglomerate': '#475569', 'Infrastructure': '#d97706', 'Others': '#525252',
  'Gold ETF': '#ca8a04', 'Silver ETF': '#6b7280', 'Index ETF': '#2563eb', 'Liquid ETF': '#059669',
};

const CAP_COLORS = ['#2563eb', '#7c3aed', '#db2777'];
const ASSET_COLORS = ['#16a34a', '#ea580c', '#0891b2', '#9333ea'];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e5e5e5',
      borderRadius: 12,
      padding: '24px',
      marginBottom: '24px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.02)',
      position: 'relative'
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, width: 4, bottom: 0,
        background: '#C9A84C', borderTopLeftRadius: 12, borderBottomLeftRadius: 12
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingLeft: 8 }}>
        <div style={{ color: '#C9A84C' }}>{icon}</div>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</h3>
      </div>
      <div style={{ paddingLeft: 8 }}>
        {children}
      </div>
    </div>
  );
}

const RADIAN = Math.PI / 180;
function CustomPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#ffffff" textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={800}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#ffffff', border: '1px solid #e5e5e5', boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <div style={{ color: '#111111', fontWeight: 800 }}>{payload[0].name}</div>
      <div style={{ color: '#555555', marginTop: 4, fontWeight: 600 }}>
        {typeof payload[0].value === 'number' && payload[0].value < 200
          ? `${payload[0].value.toFixed(1)}%`
          : fmtCurrency(payload[0].value)}
      </div>
    </div>
  );
}

// ─── Derived Calculations ─────────────────────────────────────────────────────

function computeHealthScore(holdings: Holding[]) {
  if (!holdings.length) return { score: 0, factors: [] };
  const total = holdings.reduce((s, h) => s + (h.current_value || h.buy_price * h.quantity), 0);
  const divScore = Math.min(25, Math.round((holdings.length / 20) * 25));
  const topWeight = Math.max(...holdings.map(h => (h.current_value || h.buy_price * h.quantity) / total));
  const concScore = Math.round((1 - Math.min(topWeight, 0.6) / 0.6) * 25);
  const unreal = holdings.reduce((s, h) => s + h.unrealised_pnl, 0);
  const invested = holdings.reduce((s, h) => s + (h.invested_amount || h.buy_price * h.quantity), 0);
  const pnlPct = invested > 0 ? (unreal / invested) * 100 : 0;
  const pnlScore = Math.max(0, Math.min(25, Math.round(12.5 + pnlPct * 0.5)));
  const sectors = new Set(holdings.map(h => getStockMeta(h.nse_symbol, h.stock_symbol).sector));
  const secScore = Math.min(25, Math.round((sectors.size / 8) * 25));

  return {
    score: divScore + concScore + pnlScore + secScore,
    factors: [
      { label: 'Diversification', score: divScore, note: `${holdings.length} positions` },
      { label: 'Concentration', score: concScore, note: `Top: ${(topWeight * 100).toFixed(0)}% wt.` },
      { label: 'P&L Health', score: pnlScore, note: fmtPct(pnlPct) },
      { label: 'Sector Spread', score: secScore, note: `${sectors.size} sectors` },
    ],
  };
}

function generateExecutiveSummary(
  clientName: string, holdings: Holding[], totalValue: number, invested: number, 
  largePct: number, smallPct: number, healthScore: number, beta: number
): string {
  if (!holdings.length) return "No data available.";
  
  const pnl = totalValue - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
  const isProfitable = pnl >= 0;

  let summary = `This comprehensive portfolio intelligence report has been generated for ${clientName}. `;
  summary += `As of the report date, the total assets under management stand at ${fmtCurrency(totalValue)} across ${holdings.length} active positions. `;
  
  if (isProfitable) {
    summary += `The portfolio is currently operating at a net unrealised gain of ${fmtCurrency(pnl)} (${fmtPct(pnlPct)}). `;
  } else {
    summary += `The portfolio is currently operating at a net unrealised loss of ${fmtCurrency(Math.abs(pnl))} (${fmtPct(pnlPct)}). `;
  }

  summary += `In terms of market capitalisation, `;
  if (largePct > 60) {
    summary += `the portfolio exhibits a strong defensive tilt, with a significant ${(largePct).toFixed(1)}% allocation toward Large Cap equities. `;
  } else if (smallPct > 40) {
    summary += `the portfolio is aggressively positioned with ${(smallPct).toFixed(1)}% exposed to Small Cap volatility. `;
  } else {
    summary += `the portfolio maintains a balanced exposure across market caps. `;
  }

  if (beta > 1.1) {
    summary += `With an estimated portfolio beta of ${beta.toFixed(2)}, expect volatility to outpace the broader index. `;
  } else if (beta < 0.9) {
    summary += `The estimated portfolio beta of ${beta.toFixed(2)} indicates a lower-volatility, defensive posture relative to the broader market. `;
  }

  if (healthScore >= 75) {
    summary += `Overall, structural health metrics remain robust (Score: ${healthScore}/100), indicating strong diversification and manageable concentration risks.`;
  } else if (healthScore <= 50) {
    summary += `Overall structural health (Score: ${healthScore}/100) indicates significant room for optimisation, particularly concerning concentration or sector-specific risks.`;
  } else {
    summary += `Structural health metrics are satisfactory (Score: ${healthScore}/100), though active monitoring of individual sector weights is recommended.`;
  }

  return summary;
}

// ─── PDF Generation & Page Helpers ────────────────────────────────────────────
function RunningHeader({ clientName }: { clientName: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #d4af37', paddingBottom: 6, marginBottom: 14 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Portfolio Intelligence Report — <span style={{ color: '#C9A84C' }}>{clientName}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img src={NorthWealthLogo} alt="North Wealth" style={{ height: 24, width: 'auto' }} />
      </div>
    </div>
  );
}

function RunningFooter({ currentPage, totalPages }: { currentPage: number, totalPages: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e5e5e5', paddingTop: 8, marginTop: 'auto', fontSize: 8, color: '#777', fontWeight: 600 }}>
      <div>North Wealth Portfolio Intelligence</div>
      <div style={{ fontWeight: 700 }}>SEBI REG NO: INA000021544</div>
      <div style={{ fontWeight: 800 }}>Page {currentPage} of {totalPages}</div>
    </div>
  );
}

async function generatePDF(
  contentRef: React.RefObject<HTMLDivElement | null>,
  clientName: string,
) {
  if (!contentRef.current) return;

  const pageElements = contentRef.current.querySelectorAll('[id^="report-page-"]');
  if (pageElements.length === 0) return;

  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = 210;
  const pageH = 297;
  const pdfMargin = 4;
  const contentW = pageW - pdfMargin * 2;
  const contentH = pageH - pdfMargin * 2;
  const now = new Date();

  for (let i = 0; i < pageElements.length; i++) {
    const el = pageElements[i] as HTMLElement;
    if (i > 0) pdf.addPage();

    const canvas = await html2canvas(el, {
      scale: 2.2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', pdfMargin, pdfMargin, contentW, contentH, undefined, 'FAST');
  }

  const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
  pdf.save(`NorthWealth_Portfolio_Report_${safeName}_${now.toISOString().split('T')[0]}.pdf`);
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function PortfolioDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkReturn[] | null>(null);
  const [stockMarketData, setStockMarketData] = useState<StockMarketData[] | null>(null);
  const [marketDataLoading, setMarketDataLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const pdfReportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, h, t] = await Promise.all([
        fetchClient(id),
        fetchHoldings(id),
        fetchTransactions(id)
      ]);
      setClient(c);
      setHoldings(h);
      setTransactions(t);
      setLoading(false);

      if (h.length > 0) {
        // 1. Recover instantly from Firestore cache to unblock UI and activate the PDF button immediately
        try {
          const dbCache = await fetchMarketDataCache();
          
          // Pre-load benchmark Nifty returns
          const niftyDoc = dbCache.find(d => d.symbol === '^CRSLDX' || d.id === 'benchmark_^CRSLDX');
          if (niftyDoc && niftyDoc.returns) {
            setBenchmarkData(niftyDoc.returns);
          }

          // Pre-load holding stock prices
          const resolvedStock: StockMarketData[] = [];
          const symbols = h.map(x => x.nse_symbol || x.stock_symbol);
          symbols.forEach(symbol => {
            const symTrim = symbol.trim();
            const querySymbol = symTrim.includes('.') || symTrim.startsWith('^') || symTrim.includes('=') ? symTrim : `${symTrim}.NS`;
            const cachedEntry = dbCache.find(d => d.symbol === symbol || d.symbol === querySymbol || d.id === symbol || d.id === querySymbol);
            if (cachedEntry && cachedEntry.currentPrice >= 0) {
              resolvedStock.push({
                symbol: symbol,
                high52W: cachedEntry.high52W || 0,
                low52W: cachedEntry.low52W || 0,
                currentPrice: cachedEntry.currentPrice || 0,
                pctFromHigh: cachedEntry.pctFromHigh || 0,
                pctFromLow: cachedEntry.pctFromLow || 0,
                return1Y: cachedEntry.return1Y || 0,
                returnYTD: cachedEntry.returnYTD || 0,
                return6M: cachedEntry.return6M || 0,
                return3M: cachedEntry.return3M || 0,
                return1M: cachedEntry.return1M || 0,
                trueBeta: cachedEntry.trueBeta || 1.0,
                volatility: cachedEntry.volatility || 0,
                liquidity: cachedEntry.liquidity || 'Medium'
              });
            }
          });

          if (resolvedStock.length > 0) {
            setStockMarketData(resolvedStock);
          }

          // Unblock the PDF download button instantly if we found cache data
          if (niftyDoc && resolvedStock.length > 0) {
            setMarketDataLoading(false);
            console.log('Pre-loaded from cache, PDF button enabled.');
          }
        } catch (cacheErr) {
          console.warn('Failed to pre-load market data from cache:', cacheErr);
        }

        // 2. Refresh Yahoo Finance data in the background silently.
        // It will update state silently once completed. If it hangs or fails (e.g. CORS proxy issue), the user is not blocked.
        Promise.all([
          fetchNifty500Returns(),
          fetchStockMarketData(h.map(x => x.nse_symbol || x.stock_symbol))
        ]).then(([bench, stock]) => {
          if (bench && bench.length > 0) setBenchmarkData(bench);
          if (stock && stock.length > 0) setStockMarketData(stock);
          console.log('Background market data refresh complete.');
        }).catch(err => {
          console.warn('Background market data refresh encountered an error:', err);
        }).finally(() => {
          setMarketDataLoading(false); // Safeguard: ensure loading is dismissed
        });

      } else {
        setMarketDataLoading(false);
      }
    } catch (err) {
      console.error('Error loading portfolio dashboard:', err);
      setLoading(false);
      setMarketDataLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
        <Spinner size={36} />
      </div>
    );
  }

  if (!client) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f5f5', gap: 16 }}>
        <div style={{ color: '#dc2626', fontSize: 18, fontWeight: 700 }}>Client not found</div>
        <button onClick={() => navigate('/')} style={{ padding: '8px 16px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          Back to clients
        </button>
      </div>
    );
  }

  // ─── Computational Derived Metrics ───────────────────────────────────────────
  const totalInvested = holdings.reduce((s, h) => s + (h.invested_amount || h.buy_price * h.quantity), 0);
  const totalValue = holdings.reduce((s, h) => s + (h.current_price > 0 ? (h.current_value || h.buy_price * h.quantity) : 0), 0);
  const totalUnrealisedPnl = holdings.reduce((s, h) => s + h.unrealised_pnl, 0);
  const overallPnlPct = totalInvested > 0 ? (totalUnrealisedPnl / totalInvested) * 100 : 0;

  const capData = (['Large', 'Mid', 'Small'] as const).map(cap => {
    const value = holdings
      .filter(h => getStockMeta(h.nse_symbol, h.stock_symbol).marketCap === cap)
      .reduce((s, h) => s + (h.current_value || h.buy_price * h.quantity), 0);
    return { name: `${cap} Cap`, value: totalValue > 0 ? parseFloat(((value / totalValue) * 100).toFixed(1)) : 0, raw: value };
  }).filter(d => d.raw > 0);

  const assetData = (['Equity', 'Commodity', 'ETF', 'Debt'] as const).map(cls => {
    const value = holdings
      .filter(h => getStockMeta(h.nse_symbol, h.stock_symbol).assetClass === cls)
      .reduce((s, h) => s + (h.current_value || h.buy_price * h.quantity), 0);
    return { name: cls, value: totalValue > 0 ? parseFloat(((value / totalValue) * 100).toFixed(1)) : 0, raw: value };
  }).filter(d => d.raw > 0);

  const sectorMap: Record<string, number> = {};
  holdings.forEach(h => {
    const { sector } = getStockMeta(h.nse_symbol, h.stock_symbol);
    const val = h.current_value || h.buy_price * h.quantity;
    sectorMap[sector] = (sectorMap[sector] || 0) + val;
  });
  const sectorData = Object.entries(sectorMap)
    .map(([name, raw]) => ({ name, value: parseFloat(((raw / totalValue) * 100).toFixed(1)), raw }))
    .sort((a, b) => b.raw - a.raw);

  const health = computeHealthScore(holdings);
  const largePct = capData.find(d => d.name === 'Large Cap')?.value || 0;
  const smallPct = capData.find(d => d.name === 'Small Cap')?.value || 0;

  let portfolioVolatility = 0;
  const betaEstimate = holdings.reduce((s, h) => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    const weight = totalValue > 0 ? (h.current_value || h.buy_price * h.quantity) / totalValue : 0;
    
    let betaVal = meta.marketCap === 'Large' ? 0.9 : meta.marketCap === 'Mid' ? 1.1 : 1.3;
    let volVal = 15; // default 15% assumption if no data

    if (stockMarketData) {
       const smd = stockMarketData.find(s => s.symbol === (h.nse_symbol || h.stock_symbol) || s.symbol === `${h.nse_symbol || h.stock_symbol}.NS`);
       if (smd) {
         betaVal = smd.trueBeta;
         volVal = smd.volatility;
       }
    }
    
    portfolioVolatility += (volVal * weight);
    return s + (betaVal * weight);
  }, 0);

  const execSummary = generateExecutiveSummary(client.name, holdings, totalValue, totalInvested, largePct, smallPct, health.score, betaEstimate);
  const radarData = health.factors.map(f => ({ subject: f.label, score: f.score, fullMark: 25 }));
  const sortedHoldings = [...holdings].sort((a, b) => (b.current_value || b.buy_price * b.quantity) - (a.current_value || a.buy_price * a.quantity));

  const withPrice = holdings.filter(h => h.current_price > 0);
  const winners = [...withPrice].sort((a, b) => b.unrealised_pnl_pct - a.unrealised_pnl_pct).slice(0, 3);
  const losers = [...withPrice].sort((a, b) => a.unrealised_pnl_pct - b.unrealised_pnl_pct).slice(0, 3);

  const equityHoldings = holdings.filter(h => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    return meta.assetClass === 'Equity';
  });
  const totalEquityValue = equityHoldings.reduce((s, h) => s + (h.current_value || h.buy_price * h.quantity), 0);

  const weightedPE = totalEquityValue > 0 ? equityHoldings.reduce((s, h) => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    const weight = (h.current_value || h.buy_price * h.quantity) / totalEquityValue;
    return s + ((meta.pe || 20) * weight);
  }, 0) : 0;

  const weightedPB = totalEquityValue > 0 ? equityHoldings.reduce((s, h) => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    const weight = (h.current_value || h.buy_price * h.quantity) / totalEquityValue;
    return s + ((meta.pb || 2.5) * weight);
  }, 0) : 0;

  const weightedDivYield = totalValue > 0 ? holdings.reduce((s, h) => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    const weight = (h.current_value || h.buy_price * h.quantity) / totalValue;
    return s + ((meta.divYield || 1.0) * weight);
  }, 0) : 0;

  const equityMcapHoldings = holdings.filter(h => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    return meta.assetClass === 'Equity' && meta.mcap;
  });
  const totalEquityMcapValue = equityMcapHoldings.reduce((s, h) => s + (h.current_value || h.buy_price * h.quantity), 0);

  const weightedMcap = totalEquityMcapValue > 0 ? equityMcapHoldings.reduce((s, h) => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    const weight = (h.current_value || h.buy_price * h.quantity) / totalEquityMcapValue;
    return s + ((meta.mcap || 0) * weight);
  }, 0) : 0;

  let weightedMcapType = 'Small';
  if (weightedMcap >= 20000) weightedMcapType = 'Large';
  else if (weightedMcap >= 5000 && weightedMcap < 20000) weightedMcapType = 'Mid';

  const industryMap: Record<string, number> = {};
  holdings.forEach(h => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    const industryName = meta.industry || 'Others';
    const val = h.current_value || h.buy_price * h.quantity;
    industryMap[industryName] = (industryMap[industryName] || 0) + val;
  });
  // const topIndustries = Object.entries(industryMap)
  //   .map(([name, raw]) => ({ name, value: parseFloat(((raw / totalValue) * 100).toFixed(1)), raw }))
  //   .sort((a, b) => b.raw - a.raw);

  const holdingWeights = holdings.map(h => {
    const val = h.current_value || h.buy_price * h.quantity;
    const w = totalValue > 0 ? (val / totalValue) * 100 : 0;
    return { holding: h, weight: w };
  }).sort((a, b) => b.weight - a.weight);

  const belowOnePctHoldings = holdingWeights.filter(hw => hw.weight < 1);
  const belowOnePctCount = belowOnePctHoldings.length;
  // const belowOnePctCollectivePct = belowOnePctHoldings.reduce((s, hw) => s + hw.weight, 0);

  const top5HoldingPct = holdingWeights.slice(0, 5).reduce((s, hw) => s + hw.weight, 0);
  // const top5SectorPct = sectorData.slice(0, 5).reduce((s, d) => s + d.value, 0);
  // const maxHoldingPct = holdingWeights.length > 0 ? holdingWeights[0].weight : 0;

  const etfCount = holdings.filter(h => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    return meta.assetClass === 'ETF' || meta.assetClass === 'Commodity';
  }).length;

  const goldSilverCount = holdings.filter(h => {
    const meta = getStockMeta(h.nse_symbol, h.stock_symbol);
    const sec = (meta.sector || '').toLowerCase();
    return sec.includes('gold') || sec.includes('silver');
  }).length;

  const hhi = holdings.reduce((s, h) => {
    const w = (h.current_value || h.buy_price * h.quantity) / totalValue;
    return s + (w * w);
  }, 0);
  const hhiDisplay = (hhi * 10000).toFixed(0);
  const effectiveStocks = hhi > 0 ? (1 / hhi).toFixed(1) : '0';

  const highConviction = holdingWeights.filter(hw => hw.weight >= 5);
  const corePositions = holdingWeights.filter(hw => hw.weight >= 2 && hw.weight < 5);
  const satellitePositions = holdingWeights.filter(hw => hw.weight < 2);
  const highConvictionPct = highConviction.reduce((s, hw) => s + hw.weight, 0);
  const corePositionsPct = corePositions.reduce((s, hw) => s + hw.weight, 0);
  const satellitePositionsPct = satellitePositions.reduce((s, hw) => s + hw.weight, 0);
  
  const top10Holdings = holdingWeights.slice(0, 10).map(hw => {
    const meta = getStockMeta(hw.holding.nse_symbol, hw.holding.stock_symbol);
    return {
      name: cleanSymbol(hw.holding),
      companyName: meta.companyName || hw.holding.company_name || '—',
      value: parseFloat(hw.weight.toFixed(2)),
      sector: meta.sector || 'Others',
    };
  });

  const estAnnualDividend = (weightedDivYield * totalValue) / 100;
  const estMonthlyDividend = estAnnualDividend / 12;

  const observations: string[] = [];
  if (sectorData.length > 0 && sectorData[0].value > 30) {
    observations.push(`${sectorData[0].name} forms the largest sector exposure at ${sectorData[0].value}% of the overall portfolio.`);
  }
  if (belowOnePctCount > 10) {
    observations.push(`A significant portion of the portfolio is allocated towards ${belowOnePctCount} low-conviction positions.`);
  }
  if (holdings.length > 20) {
    observations.push(`The portfolio is heavily diversified across ${holdings.length} stocks and ${sectorData.length} sectors.`);
  }
  if (etfCount > 0) {
    observations.push(`The portfolio holds ${etfCount} ETFs providing passive market exposure.`);
  }
  if (goldSilverCount > 0) {
    observations.push(`${goldSilverCount} Gold/Silver ETF positions provide hedging against equity market volatility.`);
  }
  if (top5HoldingPct > 40) {
    observations.push(`Portfolio returns are being driven by a limited set of meaningful holdings in the top 5 positions (${top5HoldingPct.toFixed(1)}%).`);
  }

  const recommendations: Array<{ type: 'warning' | 'info'; title: string; desc: string }> = [];
  holdings.forEach(h => {
    const weight = totalValue > 0 ? ((h.current_value || h.buy_price * h.quantity) / totalValue * 100) : 0;
    if (weight > 15) {
      recommendations.push({
        type: 'warning',
        title: 'High Single-Asset Concentration',
        desc: `${cleanSymbol(h)} constitutes ${weight.toFixed(1)}% of your portfolio. Consider trimming this position to reduce single-stock volatility risk.`
      });
    }
  });

  sectorData.forEach(sec => {
    if (sec.value > 30) {
      recommendations.push({
        type: 'info',
        title: 'Sector Overweight Exposure',
        desc: `The ${sec.name} sector represents ${sec.value.toFixed(1)}% of your portfolio. Consider diversifying into defensive sectors to balance exposure.`
      });
    }
  });

  if (betaEstimate < 0.7) {
    recommendations.push({
      type: 'info',
      title: 'Defensive Portfolio Beta',
      desc: `Your estimated portfolio Beta is defensive (${betaEstimate.toFixed(2)}). While this protects capital in recessions, you may capture less upside during sharp market bull runs.`
    });
  }

  if (holdings.length < 6) {
    recommendations.push({
      type: 'warning',
      title: 'Under-diversification Risk',
      desc: `You hold only ${holdings.length} positions. Consider diversifying across a wider basket of stocks to mitigate individual business failures.`
    });
  }

  const handleDownloadPDF = async () => {
    setGeneratingPDF(true);
    try {
      await generatePDF(pdfReportRef, client.name);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handleDownloadExcel = () => {
    import('xlsx').then((XLSX) => {
      const dataToExport = sortedHoldings.map((h, idx) => {
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
          'Net P&L': h.unrealised_pnl,
          'Net P&L %': h.unrealised_pnl_pct,
          'Alloc %': totalValue > 0 ? (((h.current_value || h.buy_price * h.quantity) / totalValue) * 100) : 0
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Holdings");
      XLSX.writeFile(workbook, `${client.name}_Holdings.xlsx`);
    });
  };

  const PAGE_WIDTH = 800;
  const PAGE_HEIGHT = 1130; 

  const pageCardStyle: React.CSSProperties = {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    minHeight: PAGE_HEIGHT,
    maxHeight: PAGE_HEIGHT,
    background: '#ffffff',
    boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
    borderRadius: 8,
    padding: '40px 48px',
    boxSizing: 'border-box',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflow: 'hidden',
    flexShrink: 0,
  };

  const chunkSize = 20;
  const holdingChunks: Holding[][] = [];
  for (let i = 0; i < sortedHoldings.length; i += chunkSize) {
    holdingChunks.push(sortedHoldings.slice(i, i + chunkSize));
  }
  const totalPagesCount = 5 + holdingChunks.length;

  return (
    <div style={{ background: '#f5f5f7', minHeight: '100vh', padding: '32px 0', fontFamily: 'var(--font-sans)', color: '#111' }}>
      
      {/* On-Screen Action Header */}
      <div style={{ maxWidth: 1400, margin: '0 auto', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px', boxSizing: 'border-box' }}>
        <button
          onClick={() => navigate(`/client/${id}`)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#666', fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
        >
          <ArrowLeft size={16} /> Return to CRM
        </button>
        
        <button
          onClick={handleDownloadPDF}
          disabled={generatingPDF || marketDataLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 8,
            background: '#111', color: '#fff', fontSize: 13, fontWeight: 800,
            cursor: (generatingPDF || marketDataLoading) ? 'not-allowed' : 'pointer', opacity: (generatingPDF || marketDataLoading) ? 0.7 : 1, border: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}
        >
          {(generatingPDF || marketDataLoading) ? <Spinner size={14} /> : <Download size={14} />}
          {generatingPDF ? 'Generating Document...' : marketDataLoading ? 'Loading Market Data...' : 'Download PDF Report'}
        </button>
      </div>

      {/* On-Screen Full-Width Responsive Webpage Dashboard */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 24, boxSizing: 'border-box' }}>
        
        {/* Webpage Dashboard Header */}
        <div style={{ background: '#ffffff', borderRadius: 12, padding: '32px', border: '1px solid #e5e5e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.01)' }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 900, color: '#111', margin: '0 0 6px 0', letterSpacing: '-0.5px' }}>
              Portfolio Intelligence Report
            </h1>
            <div style={{ fontSize: 14, color: '#555', fontWeight: 600 }}>
              Prepared Exclusively For: <span style={{ color: '#111', fontWeight: 850 }}>{client.name}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <img src={NorthWealthLogo} alt="North Wealth" style={{ height: 64, width: 'auto', marginBottom: 8 }} />
            <div style={{ fontSize: 9, color: '#777', fontWeight: 700 }}>SEBI REG NO: INA000021544</div>
            <div style={{ fontSize: 12, color: '#555', fontWeight: 600, marginTop: 6 }}>
              Date: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>

        {/* Snapshot Metric Strip */}
        <div style={{
          background: '#faf9f5', border: '1px solid #d4af37', borderRadius: 12, padding: '18px 24px',
          display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16, boxShadow: '0 4px 12px rgba(0,0,0,0.02)'
        }}>
          {[
            { label: 'AUM', val: fmtCurrency(totalValue) },
            { label: 'Abs. Return', val: fmtPct(overallPnlPct), color: overallPnlPct >= 0 ? '#16a34a' : '#dc2626' },
            { label: 'Health Score', val: `${health.score}/100` },
            { label: 'Beta', val: betaEstimate.toFixed(2) },
            { label: 'Avg M.Cap', val: weightedMcap > 0 ? `${weightedMcapType}` : '—' },
            { label: 'Est. Yield', val: weightedDivYield > 0 ? `${weightedDivYield.toFixed(2)}%` : '—', color: '#16a34a', noBorder: true }
          ].map((m, i) => (
            <div key={i} style={{ textAlign: 'center', borderRight: m.noBorder ? 'none' : '1px solid #e5e5e5' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: m.color || '#111' }}>{m.val}</div>
            </div>
          ))}
        </div>

        {/* Exec Summary & At-a-Glance Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 24 }}>
          <SectionCard title="Executive Summary" icon={<FileText size={18} />}>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#333', margin: 0, fontWeight: 500 }}>
              {execSummary}
            </p>
          </SectionCard>

          <SectionCard title="Portfolio At-a-Glance" icon={<BarChart2 size={18} />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16, alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>Total Invested</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: '#111' }}>{fmtCurrency(totalInvested)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>Current Valuation</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: '#111' }}>{fmtCurrency(totalValue)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>Unrealised P&L</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: totalUnrealisedPnl >= 0 ? '#16a34a' : '#dc2626' }}>
                      {totalUnrealisedPnl >= 0 ? '+' : ''}{fmtCurrency(totalUnrealisedPnl)}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{
                    width: 90, height: 90, borderRadius: '50%',
                    border: `4px solid ${overallPnlPct >= 0 ? '#16a34a' : '#dc2626'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column'
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: overallPnlPct >= 0 ? '#16a34a' : '#dc2626' }}>{overallPnlPct.toFixed(1)}%</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: '#888', textTransform: 'uppercase' }}>Abs. Return</div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#777' }}>Total Sectors</span>
                  <span style={{ fontSize: 12, fontWeight: 900, color: '#111' }}>{sectorData.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#777' }}>Largest Sector</span>
                  <span style={{ fontSize: 12, fontWeight: 900, color: '#111' }}>{sectorData.length > 0 ? `${sectorData[0].name} (${sectorData[0].value.toFixed(0)}%)` : '—'}</span>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Observations & Contributors/Detractors */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {observations.length > 0 && (
              <SectionCard title="Key Observations" icon={<Info size={18} />}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {observations.map((obs, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9A84C', marginTop: 6, flexShrink: 0 }} />
                      <p style={{ fontSize: 13, lineHeight: 1.5, color: '#444', margin: 0, fontWeight: 500 }}>{obs}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {recommendations.length > 0 && (
              <SectionCard title="Advisory Insights & Recommendations" icon={<AlertTriangle size={18} />}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {recommendations.map((rec, i) => (
                    <div 
                      key={i} 
                      style={{ 
                        display: 'flex', 
                        gap: 12, 
                        padding: '16px', 
                        borderRadius: 8, 
                        background: rec.type === 'warning' ? '#fef2f2' : '#faf9f5', 
                        border: rec.type === 'warning' ? '1px solid #fecaca' : '1px solid #d4af37',
                        alignItems: 'flex-start'
                      }}
                    >
                      <div style={{ color: rec.type === 'warning' ? '#dc2626' : '#C9A84C', marginTop: 2, flexShrink: 0 }}>
                        {rec.type === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />}
                      </div>
                      <div>
                        <h4 style={{ 
                          fontSize: 14, 
                          fontWeight: 800, 
                          color: rec.type === 'warning' ? '#7f1d1d' : '#111', 
                          margin: '0 0 4px 0' 
                        }}>
                          {rec.title}
                        </h4>
                        <p style={{ 
                          fontSize: 13, 
                          lineHeight: 1.5, 
                          color: rec.type === 'warning' ? '#991b1b' : '#444', 
                          margin: 0, 
                          fontWeight: 500 
                        }}>
                          {rec.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.01)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ color: '#16a34a' }}><TrendingUp size={16} /></div>
                <h4 style={{ fontSize: 13, fontWeight: 800, color: '#14532d', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Contributors</h4>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {winners.map(w => (
                  <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(22, 163, 74, 0.08)', paddingBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#111' }}>{cleanSymbol(w)}</div>
                      <div style={{ fontSize: 10, color: '#14532d', fontWeight: 600 }}>{w.company_name}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#16a34a' }}>+{fmtCurrency(w.unrealised_pnl)}</div>
                      <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>+{w.unrealised_pnl_pct.toFixed(2)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.01)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ color: '#dc2626' }}><TrendingDown size={16} /></div>
                <h4 style={{ fontSize: 13, fontWeight: 800, color: '#7f1d1d', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Detractors</h4>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {losers.map(l => (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(220, 38, 38, 0.08)', paddingBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#111' }}>{cleanSymbol(l)}</div>
                      <div style={{ fontSize: 10, color: '#7f1d1d', fontWeight: 600 }}>{l.company_name}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#dc2626' }}>{fmtCurrency(l.unrealised_pnl)}</div>
                      <div style={{ fontSize: 10, color: '#dc2626', fontWeight: 700 }}>{l.unrealised_pnl_pct.toFixed(2)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {marketDataLoading ? (
          <div style={{ marginBottom: 16, background: '#fff', borderRadius: 8, padding: 30, border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#d4af37] mx-auto mb-4"></div>
            <p style={{ color: '#666', fontSize: 13, fontWeight: 500 }}>Fetching live market data & calculating Alpha...</p>
          </div>
        ) : benchmarkData ? (
          <BenchmarkComparison 
            benchmarkData={benchmarkData} 
            stockMarketData={stockMarketData} 
            holdings={holdings} 
            totalInvested={totalInvested} 
            totalValue={totalValue} 
          />
        ) : null}

        {/* Distributions Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <SectionCard title="Market Cap Distribution" icon={<PieIcon size={16} />}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={capData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} labelLine={false} label={CustomPieLabel}>
                    {capData.map((_, i) => <Cell key={i} fill={CAP_COLORS[i % CAP_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
                {capData.map((d, i) => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#555' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: CAP_COLORS[i % CAP_COLORS.length] }} />
                    {d.name}: <span style={{ color: '#111', fontWeight: 800 }}>{d.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Asset Class Distribution" icon={<PieIcon size={16} />}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={assetData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} labelLine={false} label={CustomPieLabel}>
                    {assetData.map((_, i) => <Cell key={i} fill={ASSET_COLORS[i % ASSET_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
                {assetData.map((d, i) => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#555' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: ASSET_COLORS[i % ASSET_COLORS.length] }} />
                    {d.name}: <span style={{ color: '#111', fontWeight: 800 }}>{d.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Sector Allocation card (full width) */}
        <SectionCard title="Sector Exposure Allocation" icon={<BarChart2 size={18} />}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 32, alignItems: 'center' }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={sectorData.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.12} />
                <XAxis type="number" unit="%" fontSize={10} fontWeight={600} stroke="#888" tickLine={false} />
                <YAxis dataKey="name" type="category" width={110} fontSize={9} fontWeight={700} stroke="#444" tickLine={false} />
                <Tooltip formatter={(value) => [`${value}%`, 'Exposure']} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                  {sectorData.slice(0, 8).map((entry, idx) => (
                    <Cell key={idx} fill={SECTOR_COLORS[entry.name] || '#333'} />
                  ))}
                  <LabelList dataKey="value" position="right" formatter={(v) => `${v}%`} fontSize={9} fontWeight={750} fill="#111" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sectorData.slice(0, 6).map((entry) => (
                <div key={entry.name} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: SECTOR_COLORS[entry.name] || '#333' }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#333' }}>{entry.name}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#111' }}>{entry.value}% ({fmtCurrency(entry.raw)})</span>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* Top 10 Holdings & Overlap Analysis */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 24 }}>
          <SectionCard title="Top 10 Holdings Allocation" icon={<BarChart2 size={16} />}>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={top10Holdings} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.12} />
                <XAxis type="number" unit="%" fontSize={10} fontWeight={600} stroke="#888" tickLine={false} domain={[0, dataMax => dataMax + 1]} />
                <YAxis dataKey="name" type="category" width={80} fontSize={10} fontWeight={700} stroke="#444" tickLine={false} />
                <Tooltip formatter={(value) => [`${value}%`, 'Weight']} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
                  {top10Holdings.map((entry, idx) => (
                    <Cell key={idx} fill={SECTOR_COLORS[entry.sector] || '#333'} />
                  ))}
                  <LabelList dataKey="value" position="right" formatter={(v) => `${v}%`} fontSize={9} fontWeight={750} fill="#111" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard title="Overlap & Conviction Analysis" icon={<Award size={16} />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 800, color: '#C9A84C', margin: '0 0 12px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Portfolio Depth Metrics
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'Unique Sectors Represented', val: sectorData.length },
                    { label: 'Unique Industries Held', val: Object.keys(industryMap).length },
                    { label: 'Herfindahl-Hirschman Index (HHI)', val: `${hhiDisplay} pts`, tooltip: 'Measure of concentration (below 1500 is highly diversified)' },
                    { label: 'Effective Number of Stocks', val: `${effectiveStocks} scrips`, tooltip: 'Number of equal-weighted stocks representing this portfolio' }
                  ].map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }} title={item.tooltip}>{item.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: '#111' }}>{item.val}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 800, color: '#C9A84C', margin: '0 0 12px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Conviction Tiers Allocation
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'High Conviction (>5% wt.)', count: highConviction.length, pct: highConvictionPct, color: '#16a34a' },
                    { label: 'Core Positions (2-5% wt.)', count: corePositions.length, pct: corePositionsPct, color: '#2563eb' },
                    { label: 'Satellite Tiers (<2% wt.)', count: satellitePositions.length, pct: satellitePositionsPct, color: '#db2777' }
                  ].map((tier, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: tier.color }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>{tier.label}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 10, background: '#f0f0f0', padding: '2px 8px', borderRadius: 4, fontWeight: 700, color: '#555' }}>{tier.count} scrips</span>
                        <span style={{ fontSize: 13, fontWeight: 900, color: '#111', width: 55, textAlign: 'right' }}>{tier.pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        {!marketDataLoading && stockMarketData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <StockLevelAnalysis 
              benchmarkData={benchmarkData}
              stockMarketData={stockMarketData} 
              holdings={holdings} 
              totalInvested={totalInvested}
              totalValue={totalValue} 
            />
            <RiskAndVolatilityTable 
              benchmarkData={benchmarkData}
              stockMarketData={stockMarketData} 
              holdings={holdings} 
              totalInvested={totalInvested}
              totalValue={totalValue} 
            />
          </div>
        )}

        {/* Diagnostics & Dividend Income */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <SectionCard title="Risk & Valuation Diagnostics" icon={<Activity size={16} />}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 20, alignItems: 'center' }}>
              <ResponsiveContainer width="100%" height={180}>
                <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                  <PolarGrid stroke="#cccccc" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fontWeight: 700, fill: '#444' }} />
                  <Radar name="Portfolio" dataKey="score" stroke="#16a34a" fill="#16a34a" fillOpacity={0.2} />
                </RadarChart>
              </ResponsiveContainer>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                  <span style={{ color: '#666', fontWeight: 600 }}>Weighted Beta</span>
                  <span style={{ fontWeight: 800, color: '#111' }}>{betaEstimate.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                  <span style={{ color: '#666', fontWeight: 600 }}>Weighted P/E</span>
                  <span style={{ fontWeight: 800, color: '#111' }}>{weightedPE.toFixed(1)}x</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                  <span style={{ color: '#666', fontWeight: 600 }}>Weighted P/B</span>
                  <span style={{ fontWeight: 800, color: '#111' }}>{weightedPB.toFixed(1)}x</span>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Estimated Annual Dividend Income" icon={<TrendingUp size={16} />}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '24px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Annual Dividend (Est.)</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#16a34a' }}>{fmtCurrency(estAnnualDividend)}</div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 8, fontWeight: 600 }}>Weighted Yield of {weightedDivYield.toFixed(2)}%</div>
              </div>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '24px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Monthly Equivalent (Est.)</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#16a34a' }}>{fmtCurrency(estMonthlyDividend)}</div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 8, fontWeight: 600 }}>Approximate monthly yield</div>
              </div>
            </div>
          </SectionCard>
        </div>

        {transactions && transactions.length > 0 && (
          <TransactionAnalytics 
            benchmarkData={benchmarkData}
            stockMarketData={stockMarketData} 
            holdings={holdings} 
            totalInvested={totalInvested}
            totalValue={totalValue} 
            transactions={transactions}
          />
        )}

        {/* COMPLETE PORTFOLIO HOLDINGS */}
        <div style={{ background: '#ffffff', border: '1px solid #e5e5e5', borderRadius: 12, padding: '32px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, borderBottom: '2px solid #111', paddingBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <Award size={22} color="#D4AF37" />
              <h3 style={{ fontSize: 20, fontWeight: 900, color: '#111', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Complete Portfolio Holdings
              </h3>
            </div>
            <button
              onClick={handleDownloadExcel}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', background: '#f5f5f5', border: '1px solid #ddd',
                borderRadius: 6, fontSize: 13, fontWeight: 700, color: '#333', cursor: 'pointer'
              }}
            >
              <Download size={14} /> Export to Excel
            </button>
          </div>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  {['#', 'Asset', 'Sector', 'M Cap', 'Quantity', 'Avg. Buy', 'Curr. Price', 'Invested', 'Current Val', 'Net P&L', 'Alloc %'].map(col => (
                    <th key={col} style={{ padding: '14px 10px', textAlign: ['Asset', 'Sector', 'M Cap'].includes(col) ? 'left' : (col === '#' ? 'center' : 'right'), fontWeight: 800, color: '#333', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.5px', borderBottom: '2px solid #ddd' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedHoldings.map((h, idx) => {
                  const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
                  const displayCompanyName = meta.companyName || h.company_name;
                  const isProfit = h.unrealised_pnl >= 0;
                  const weight = totalValue > 0 ? (((h.current_value || h.buy_price * h.quantity) / totalValue) * 100) : 0;
                  const displaySymbol = cleanSymbol(h);
                  
                  return (
                    <tr key={h.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '14px 10px', textAlign: 'center', fontWeight: 700, color: '#666' }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '14px 10px', textAlign: 'left' }}>
                        <div style={{ fontWeight: 800, color: '#111', fontSize: 14 }}>{displaySymbol}</div>
                        <div style={{ fontSize: 11, color: '#666', fontWeight: 500 }}>
                          {displayCompanyName || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '14px 10px', textAlign: 'left', fontWeight: 600, color: '#444' }}>{meta.sector}</td>
                      <td style={{ padding: '14px 10px', textAlign: 'left', fontWeight: 600, color: '#444' }}>{meta.marketCap}</td>
                      <td style={{ padding: '14px 10px', textAlign: 'right', fontWeight: 700, color: '#444' }}>{h.quantity}</td>
                      <td style={{ padding: '14px 10px', textAlign: 'right', fontWeight: 700, color: '#444' }}>₹{h.buy_price.toFixed(2)}</td>
                      <td style={{ padding: '14px 10px', textAlign: 'right', fontWeight: 700, color: '#444' }}>
                        {h.current_price > 0 ? `₹${h.current_price.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ padding: '14px 10px', textAlign: 'right', fontWeight: 750, color: '#111' }}>
                        {fmtCurrency(h.invested_amount || h.buy_price * h.quantity)}
                      </td>
                      <td style={{ padding: '14px 10px', textAlign: 'right', fontWeight: 800, color: '#111' }}>
                        {h.current_price > 0 ? fmtCurrency(h.current_value || h.buy_price * h.quantity) : '—'}
                      </td>
                      <td style={{ padding: '14px 10px', textAlign: 'right' }}>
                        <span style={{ fontWeight: 800, color: isProfit ? '#16a34a' : '#dc2626' }}>
                          {isProfit ? '+' : ''}{fmtCurrency(h.unrealised_pnl)}
                        </span>
                        <div style={{ fontSize: 11, color: isProfit ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                          {isProfit ? '+' : ''}{h.unrealised_pnl_pct.toFixed(2)}%
                        </div>
                      </td>
                      <td style={{ padding: '14px 10px', textAlign: 'right', fontWeight: 800, color: '#111' }}>
                        {weight.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 32, background: '#faf9f5', border: '1px solid #d4af37', borderRadius: 8, padding: '20px 24px', boxSizing: 'border-box' }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: '#111', marginBottom: 8, letterSpacing: '0.5px' }}>REGULATORY DISCLOSURES & TERMS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: '#777', fontWeight: 700, marginBottom: 2 }}>REGISTERED ENTITY</div>
                <div style={{ fontSize: 12, color: '#333', fontWeight: 600 }}>INVESMATE INSIGHTS PRIVATE LIMITED</div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>SEBI REG NO: INA000021544</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#777', fontWeight: 700, marginBottom: 2 }}>REGISTERED ADDRESS</div>
                <div style={{ fontSize: 11, color: '#555', lineHeight: 1.5 }}>
                  5, Narendra Nagar, Belgharia, North 24 Parganas,<br/>Kolkata, West Bengal, 700056
                </div>
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#777', lineHeight: 1.6, textAlign: 'justify' }}>
              <strong>Disclaimer:</strong> This report is generated algorithmically based on current market data and holdings. It is strictly confidential and for the addressee only. Registration granted by SEBI, membership of BASL and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors. Investment in securities market are subject to market risks. Read all the related documents carefully before investing. Past performance is not indicative of future results.
            </div>
          </div>
        </div>

      </div>

      {/* Hidden A4-aspect ratio pages container for PDF downloads (off-screen render) */}
      <div style={{ position: 'absolute', left: '-9999px', top: 0, width: PAGE_WIDTH, pointerEvents: 'none' }}>
        <div ref={pdfReportRef}>
          {/* Page 1 */}
          <div id="report-page-1" style={pageCardStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #D4AF37', paddingBottom: 12, marginBottom: 16 }}>
                <div>
                  <h1 style={{ fontSize: 28, fontWeight: 900, color: '#111', margin: '0 0 4px 0', letterSpacing: '-0.5px' }}>
                    Portfolio Intelligence Report
                  </h1>
                  <div style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>
                    Prepared Exclusively For: <span style={{ color: '#111', fontWeight: 800 }}>{client.name}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <img src={NorthWealthLogo} alt="North Wealth" style={{ height: 52, width: 'auto', marginBottom: 6 }} />
                  <div style={{ fontSize: 8, color: '#777', fontWeight: 700 }}>SEBI REG NO: INA000021544</div>
                  <div style={{ fontSize: 11, color: '#555', fontWeight: 600, marginTop: 4 }}>
                    Date: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              </div>

              <div style={{
                background: '#faf9f5', border: '1px solid #d4af37', borderRadius: 8, padding: '10px 16px', marginBottom: 16,
                display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0
              }}>
                {[
                  { label: 'AUM', val: fmtCurrency(totalValue) },
                  { label: 'Abs. Return', val: fmtPct(overallPnlPct), color: overallPnlPct >= 0 ? '#16a34a' : '#dc2626' },
                  { label: 'Health Score', val: `${health.score}/100` },
                  { label: 'Beta', val: betaEstimate.toFixed(2) },
                  { label: 'Avg M.Cap', val: weightedMcap > 0 ? `${weightedMcapType}` : '—' },
                  { label: 'Est. Yield', val: weightedDivYield > 0 ? `${weightedDivYield.toFixed(2)}%` : '—', color: '#16a34a', noBorder: true }
                ].map((m, i) => (
                  <div key={i} style={{ textAlign: 'center', borderRight: m.noBorder ? 'none' : '1px solid #e5e5e5', padding: '2px 0' }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{m.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: m.color || '#111' }}>{m.val}</div>
                  </div>
                ))}
              </div>

              <SectionCard title="Executive Summary" icon={<FileText size={16} />}>
                <p style={{ fontSize: 11, lineHeight: 1.5, color: '#333', margin: 0, fontWeight: 500 }}>
                  {execSummary}
                </p>
              </SectionCard>

              <div style={{ height: 14 }} />

              <SectionCard title="Portfolio At-a-Glance" icon={<BarChart2 size={16} />}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 20, alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', padding: '5px 0' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>Total Invested</span>
                      <span style={{ fontSize: 12, fontWeight: 900, color: '#111' }}>{fmtCurrency(totalInvested)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', padding: '5px 0' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>Current Valuation</span>
                      <span style={{ fontSize: 12, fontWeight: 900, color: '#111' }}>{fmtCurrency(totalValue)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', padding: '5px 0' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>Unrealised P&L</span>
                      <span style={{ fontSize: 12, fontWeight: 900, color: totalUnrealisedPnl >= 0 ? '#16a34a' : '#dc2626' }}>
                        {totalUnrealisedPnl >= 0 ? '+' : ''}{fmtCurrency(totalUnrealisedPnl)}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div style={{
                      width: 75, height: 75, borderRadius: '50%',
                      border: `3px solid ${overallPnlPct >= 0 ? '#16a34a' : '#dc2626'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column'
                    }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: overallPnlPct >= 0 ? '#16a34a' : '#dc2626' }}>{overallPnlPct.toFixed(1)}%</div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: '#999', textTransform: 'uppercase' }}>Abs. Return</div>
                    </div>
                  </div>
                </div>

                <div style={{ height: 10 }} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', padding: '5px 0' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>Total Sectors</span>
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#111' }}>{sectorData.length}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', padding: '5px 0' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#777', textTransform: 'uppercase' }}>Largest Sector</span>
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#111' }}>{sectorData.length > 0 ? `${sectorData[0].name} (${sectorData[0].value.toFixed(0)}%)` : '—'}</span>
                  </div>
                </div>
              </SectionCard>

              <div style={{ height: 14 }} />

              {observations.length > 0 && (
                <SectionCard title="Key Observations" icon={<Info size={16} />}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {observations.slice(0, 3).map((obs, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#C9A84C', marginTop: 5, flexShrink: 0 }} />
                        <p style={{ fontSize: 11, lineHeight: 1.4, color: '#444', margin: 0, fontWeight: 500 }}>{obs}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}
            </div>
            
            <RunningFooter currentPage={1} totalPages={totalPagesCount} />
          </div>

          {/* Page 2 */}
          <div id="report-page-2" style={pageCardStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <RunningHeader clientName={client.name} />

              {!marketDataLoading && benchmarkData && (
                <div style={{ marginBottom: 16 }}>
                  <BenchmarkComparison 
                    benchmarkData={benchmarkData} 
                    stockMarketData={stockMarketData} 
                    holdings={holdings} 
                    totalInvested={totalInvested} 
                    totalValue={totalValue} 
                  />
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 16 }}>
                <SectionCard title="Market Cap Distribution" icon={<PieIcon size={14} />}>
                  <ResponsiveContainer width="100%" height={120}>
                    <PieChart>
                      <Pie data={capData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={50} labelLine={false} label={CustomPieLabel}>
                        {capData.map((_, i) => <Cell key={i} fill={CAP_COLORS[i % CAP_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                    {capData.map((d, i) => (
                      <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: '#555' }}>
                        <div style={{ width: 8, height: 8, borderRadius: 1, background: CAP_COLORS[i % CAP_COLORS.length] }} />
                        {d.name}: <span style={{ color: '#111', fontWeight: 800 }}>{d.value}%</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Asset Class Distribution" icon={<PieIcon size={14} />}>
                  <ResponsiveContainer width="100%" height={120}>
                    <PieChart>
                      <Pie data={assetData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={50} labelLine={false} label={CustomPieLabel}>
                        {assetData.map((_, i) => <Cell key={i} fill={ASSET_COLORS[i % ASSET_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                    {assetData.map((d, i) => (
                      <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: '#555' }}>
                        <div style={{ width: 8, height: 8, borderRadius: 1, background: ASSET_COLORS[i % ASSET_COLORS.length] }} />
                        {d.name}: <span style={{ color: '#111', fontWeight: 800 }}>{d.value}%</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <div style={{ color: '#16a34a' }}><TrendingUp size={14} /></div>
                    <h4 style={{ fontSize: 11, fontWeight: 800, color: '#14532d', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Contributors</h4>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {winners.slice(0, 3).map(w => (
                      <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(22, 163, 74, 0.08)', paddingBottom: 4 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 800, color: '#111' }}>{cleanSymbol(w)}</div>
                          <div style={{ fontSize: 8, color: '#14532d', fontWeight: 600 }}>{w.company_name}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: '#16a34a' }}>+{fmtCurrency(w.unrealised_pnl)}</div>
                          <div style={{ fontSize: 8, color: '#16a34a', fontWeight: 700 }}>+{w.unrealised_pnl_pct.toFixed(2)}%</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <div style={{ color: '#dc2626' }}><TrendingDown size={14} /></div>
                    <h4 style={{ fontSize: 11, fontWeight: 800, color: '#7f1d1d', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Detractors</h4>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {losers.slice(0, 3).map(l => (
                      <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(220, 38, 38, 0.08)', paddingBottom: 4 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 800, color: '#111' }}>{cleanSymbol(l)}</div>
                          <div style={{ fontSize: 8, color: '#7f1d1d', fontWeight: 600 }}>{l.company_name}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: '#dc2626' }}>{fmtCurrency(l.unrealised_pnl)}</div>
                          <div style={{ fontSize: 8, color: '#dc2626', fontWeight: 700 }}>{l.unrealised_pnl_pct.toFixed(2)}%</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <RunningFooter currentPage={2} totalPages={totalPagesCount} />
          </div>

          {/* Page 3 */}
          <div id="report-page-3" style={pageCardStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <RunningHeader clientName={client.name} />

              <SectionCard title="Top 10 Holdings Allocation" icon={<BarChart2 size={14} />}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={top10Holdings} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.12} />
                    <XAxis type="number" unit="%" fontSize={9} fontWeight={600} stroke="#888" tickLine={false} domain={[0, dataMax => dataMax + 1]} />
                    <YAxis dataKey="name" type="category" width={80} fontSize={9} fontWeight={700} stroke="#444" tickLine={false} />
                    <Tooltip formatter={(value) => [`${value}%`, 'Weight']} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                      {top10Holdings.map((entry, idx) => (
                        <Cell key={idx} fill={SECTOR_COLORS[entry.sector] || '#333'} />
                      ))}
                      <LabelList dataKey="value" position="right" formatter={(v) => `${v}%`} fontSize={8} fontWeight={750} fill="#111" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                  {top10Holdings.slice(0, 5).map((h, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 8, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</div>
                      <div style={{ fontSize: 7, color: '#777', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.companyName}</div>
                      <div style={{ fontSize: 9, fontWeight: 950, color: SECTOR_COLORS[h.sector] || '#333', marginTop: 1 }}>{h.value}%</div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <div style={{ height: 10 }} />

              <SectionCard title="Sector Exposure Allocation" icon={<BarChart2 size={14} />}>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={sectorData.slice(0, 6)} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.12} />
                    <XAxis type="number" unit="%" fontSize={9} fontWeight={600} stroke="#888" tickLine={false} />
                    <YAxis dataKey="name" type="category" width={90} fontSize={8} fontWeight={700} stroke="#444" tickLine={false} />
                    <Tooltip formatter={(value) => [`${value}%`, 'Exposure']} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={12}>
                      {sectorData.slice(0, 6).map((entry, idx) => (
                        <Cell key={idx} fill={SECTOR_COLORS[entry.name] || '#333'} />
                      ))}
                      <LabelList dataKey="value" position="right" formatter={(v) => `${v}%`} fontSize={8} fontWeight={750} fill="#111" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </SectionCard>

              <div style={{ height: 10 }} />

              <SectionCard title="Overlap & Conviction Analysis" icon={<Award size={14} />}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                  <div>
                    <h4 style={{ fontSize: 11, fontWeight: 800, color: '#C9A84C', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Portfolio Depth Metrics
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[
                        { label: 'Unique Sectors Represented', val: sectorData.length },
                        { label: 'Unique Industries Held', val: Object.keys(industryMap).length },
                        { label: 'Herfindahl-Hirschman Index (HHI)', val: `${hhiDisplay} pts`, tooltip: 'Measure of concentration (below 1500 is highly diversified)' },
                        { label: 'Effective Number of Stocks', val: `${effectiveStocks} scrips`, tooltip: 'Number of equal-weighted stocks representing this portfolio' }
                      ].map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', paddingBottom: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#555' }} title={item.tooltip}>{item.label}</span>
                          <span style={{ fontSize: 11, fontWeight: 900, color: '#111' }}>{item.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 style={{ fontSize: 11, fontWeight: 800, color: '#C9A84C', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Conviction Tiers Allocation
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[
                        { label: 'High Conviction (>5% wt.)', count: highConviction.length, pct: highConvictionPct, color: '#16a34a' },
                        { label: 'Core Positions (2-5% wt.)', count: corePositions.length, pct: corePositionsPct, color: '#2563eb' },
                        { label: 'Satellite Tiers (<2% wt.)', count: satellitePositions.length, pct: satellitePositionsPct, color: '#db2777' }
                      ].map((tier, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0', paddingBottom: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: tier.color }} />
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#555' }}>{tier.label}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 9, background: '#f0f0f0', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#555' }}>{tier.count} scrips</span>
                            <span style={{ fontSize: 11, fontWeight: 900, color: '#111', width: 45, textAlign: 'right' }}>{tier.pct.toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>
            <RunningFooter currentPage={3} totalPages={totalPagesCount} />
          </div>

          {/* Page 4 */}
          <div id="report-page-4" style={pageCardStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <RunningHeader clientName={client.name} />

              {!marketDataLoading && stockMarketData && (
                <>
                  <StockLevelAnalysis 
                    benchmarkData={benchmarkData}
                    stockMarketData={stockMarketData}
                    holdings={holdings}
                    totalInvested={totalInvested}
                    totalValue={totalValue}
                  />
                  <div style={{ height: 10 }} />
                  <RiskAndVolatilityTable
                    benchmarkData={benchmarkData}
                    stockMarketData={stockMarketData}
                    holdings={holdings}
                    totalInvested={totalInvested}
                    totalValue={totalValue}
                  />
                  <div style={{ height: 10 }} />
                </>
              )}

              <SectionCard title="Risk & Valuation Diagnostics" icon={<Activity size={14} />}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 20, alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <ResponsiveContainer width="100%" height={165}>
                      <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                        <PolarGrid stroke="#cccccc" />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fontWeight: 700, fill: '#444' }} />
                        <Radar name="Portfolio" dataKey="score" stroke="#16a34a" fill="#16a34a" fillOpacity={0.2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    {(() => {
                      const topHoldings = [...holdings].sort((a, b) => (b.current_value || b.buy_price * b.quantity) - (a.current_value || a.buy_price * a.quantity)).slice(0, 5);
                      const top5Pct = topHoldings.reduce((s, h) => s + (h.current_value || h.buy_price * h.quantity), 0) / totalValue * 100;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ background: top5Pct > 60 ? '#fef2f2' : '#f0fdf4', padding: 12, borderRadius: 8, border: `1px solid ${top5Pct > 60 ? '#fecaca' : '#bbf7d0'}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                              {top5Pct > 60 ? <AlertTriangle size={12} color="#dc2626" /> : <CheckCircle size={12} color="#16a34a" />}
                              <span style={{ fontSize: 9, color: top5Pct > 60 ? '#dc2626' : '#16a34a', fontWeight: 750, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Concentration Check
                              </span>
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 900, color: top5Pct > 60 ? '#dc2626' : '#16a34a' }}>
                              {top5Pct.toFixed(1)}% <span style={{ fontSize: 11, fontWeight: 600 }}>in Top 5 Assets</span>
                            </div>
                            <div style={{ fontSize: 9, color: top5Pct > 60 ? '#991b1b' : '#166534', marginTop: 3, lineHeight: 1.4, fontWeight: 500 }}>
                              {top5Pct > 60 ? 'High concentration risk detected. Vulnerable to single-stock volatility.' : 'Healthy distribution among top holdings. Concentration risk is well-managed.'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}>
                              <span style={{ color: '#666', fontWeight: 600 }}>Weighted Portfolio Beta</span>
                              <span style={{ fontWeight: 800, color: '#111' }}>{betaEstimate.toFixed(2)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}>
                              <span style={{ color: '#666', fontWeight: 600 }}>Weighted P/E Ratio</span>
                              <span style={{ fontWeight: 800, color: '#111' }}>{weightedPE.toFixed(1)}x</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}>
                              <span style={{ color: '#666', fontWeight: 600 }}>Weighted P/B Ratio</span>
                              <span style={{ fontWeight: 800, color: '#111' }}>{weightedPB.toFixed(1)}x</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </SectionCard>
            </div>
            <RunningFooter currentPage={4} totalPages={totalPagesCount} />
          </div>

          {/* Page 5 */}
          <div id="report-page-5" style={pageCardStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <RunningHeader clientName={client.name} />

              <SectionCard title="Estimated Annual Dividend Income" icon={<TrendingUp size={14} />}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Annual Dividend (Est.)</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: '#16a34a' }}>{fmtCurrency(estAnnualDividend)}</div>
                    <div style={{ fontSize: 9, color: '#555', marginTop: 4, fontWeight: 600 }}>Based on weighted div yield of {weightedDivYield.toFixed(2)}%</div>
                  </div>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Monthly Equivalent (Est.)</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: '#16a34a' }}>{fmtCurrency(estMonthlyDividend)}</div>
                    <div style={{ fontSize: 9, color: '#555', marginTop: 4, fontWeight: 600 }}>Approximate monthly cash flow</div>
                  </div>
                </div>
              </SectionCard>

              <div style={{ height: 10 }} />

              {transactions && transactions.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <TransactionAnalytics 
                    benchmarkData={benchmarkData}
                    stockMarketData={stockMarketData}
                    holdings={holdings}
                    totalInvested={totalInvested}
                    totalValue={totalValue}
                    transactions={transactions}
                  />
                </div>
              )}

              <SectionCard title="Advisory Insights & Recommendations" icon={<AlertTriangle size={14} />}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {recommendations.map((rec, i) => (
                    <div 
                      key={i} 
                      style={{ 
                        display: 'flex', 
                        gap: 10, 
                        padding: '10px 12px', 
                        borderRadius: 6, 
                        background: rec.type === 'warning' ? '#fef2f2' : '#faf9f5', 
                        border: rec.type === 'warning' ? '1px solid #fecaca' : '1px solid #d4af37',
                        alignItems: 'flex-start'
                      }}
                    >
                      <div style={{ color: rec.type === 'warning' ? '#dc2626' : '#C9A84C', marginTop: 1, flexShrink: 0 }}>
                        {rec.type === 'warning' ? <AlertTriangle size={12} /> : <Info size={12} />}
                      </div>
                      <div>
                        <h4 style={{ 
                          fontSize: 11, 
                          fontWeight: 800, 
                          color: rec.type === 'warning' ? '#7f1d1d' : '#111', 
                          margin: '0 0 2px 0' 
                        }}>
                          {rec.title}
                        </h4>
                        <p style={{ 
                          fontSize: 10, 
                          lineHeight: 1.4, 
                          color: rec.type === 'warning' ? '#991b1b' : '#444', 
                          margin: 0, 
                          fontWeight: 500 
                        }}>
                          {rec.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
            <RunningFooter currentPage={5} totalPages={totalPagesCount} />
          </div>

          {/* Holdings Tables (Pages 6+) */}
          {holdingChunks.map((chunk, chunkIdx) => {
            const pageNum = 6 + chunkIdx;
            const isLastPage = chunkIdx === holdingChunks.length - 1;
            return (
              <div key={chunkIdx} id={`report-page-${pageNum}`} style={pageCardStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1 }}>
                  <RunningHeader clientName={client.name} />
                  
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, borderBottom: '2px solid #111', paddingBottom: 8 }}>
                      <Award size={16} color="#D4AF37" />
                      <h3 style={{ fontSize: 14, fontWeight: 900, color: '#111', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Complete Portfolio Holdings {holdingChunks.length > 1 ? `(Part ${chunkIdx + 1} of ${holdingChunks.length})` : ''}
                      </h3>
                    </div>
                    
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                      <thead>
                        <tr style={{ background: '#f5f5f5' }}>
                          {['#', 'Asset', 'Sector', 'M Cap', 'Qty', 'Avg. Buy', 'Curr. Price', 'Invested', 'Current Val', 'Net P&L', 'Alloc %'].map(col => (
                            <th key={col} style={{
                              padding: '8px 6px',
                              textAlign: ['Asset', 'Sector', 'M Cap'].includes(col) ? 'left' : (col === '#' ? 'center' : 'right'),
                              fontWeight: 800,
                              color: '#333',
                              textTransform: 'uppercase',
                              fontSize: 8,
                              letterSpacing: '0.5px',
                              borderBottom: '2px solid #ddd'
                            }}>
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {chunk.map((h, i) => {
                          const meta = getStockMeta(h.nse_symbol || h.stock_symbol || '', h.company_name || '');
                          const displayCompanyName = meta.companyName || h.company_name;
                          const isProfit = h.unrealised_pnl >= 0;
                          const weight = totalValue > 0 ? (((h.current_value || h.buy_price * h.quantity) / totalValue) * 100) : 0;
                          const displaySymbol = cleanSymbol(h);
                          
                          return (
                            <tr key={h.id} style={{ borderBottom: '1px solid #eee' }}>
                              <td style={{ padding: '6px', textAlign: 'center', fontWeight: 700, color: '#666', borderBottom: '1px solid #eee' }}>
                                {chunkIdx * chunkSize + i + 1}
                              </td>
                              <td style={{ padding: '6px', textAlign: 'left', borderBottom: '1px solid #eee' }}>
                                <div style={{ fontWeight: 800, color: '#111', fontSize: 10 }}>{displaySymbol}</div>
                                <div style={{ fontSize: 7, color: '#777', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
                                  {displayCompanyName || '—'}
                                </div>
                              </td>
                              <td style={{ padding: '6px', textAlign: 'left', fontWeight: 600, color: '#444', borderBottom: '1px solid #eee' }}>{meta.sector}</td>
                              <td style={{ padding: '6px', textAlign: 'left', fontWeight: 600, color: '#444', borderBottom: '1px solid #eee' }}>{meta.marketCap}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700, color: '#444' }}>{h.quantity}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700, color: '#444' }}>₹{h.buy_price.toFixed(2)}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700, color: '#444' }}>
                                {h.current_price > 0 ? `₹${h.current_price.toFixed(2)}` : '—'}
                              </td>
                              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700, color: '#111' }}>
                                {fmtCurrency(h.invested_amount || h.buy_price * h.quantity)}
                              </td>
                              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 800, color: '#111' }}>
                                {h.current_price > 0 ? fmtCurrency(h.current_value || h.buy_price * h.quantity) : '—'}
                              </td>
                              <td style={{ padding: '6px', textAlign: 'right', borderBottom: '1px solid #eee' }}>
                                <span style={{ fontWeight: 800, color: isProfit ? '#16a34a' : '#dc2626' }}>
                                  {isProfit ? '+' : ''}{fmtCurrency(h.unrealised_pnl)}
                                </span>
                                <div style={{ fontSize: 7.5, color: isProfit ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                                  {isProfit ? '+' : ''}{h.unrealised_pnl_pct.toFixed(2)}%
                                </div>
                              </td>
                              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 800, color: '#111' }}>
                                {weight.toFixed(2)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  
                  {isLastPage && (
                    <div style={{ marginTop: 'auto', background: '#faf9f5', border: '1px solid #d4af37', borderRadius: 8, padding: '12px 16px', boxSizing: 'border-box' }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: '#111', marginBottom: 4, letterSpacing: '0.5px' }}>REGULATORY DISCLOSURES & TERMS</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 8, color: '#777', fontWeight: 700, marginBottom: 1 }}>REGISTERED ENTITY</div>
                          <div style={{ fontSize: 9, color: '#333', fontWeight: 600 }}>INVESMATE INSIGHTS PRIVATE LIMITED</div>
                          <div style={{ fontSize: 8, color: '#555', marginTop: 1 }}>SEBI REG NO: INA000021544</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 8, color: '#777', fontWeight: 700, marginBottom: 1 }}>REGISTERED ADDRESS</div>
                          <div style={{ fontSize: 8, color: '#555', lineHeight: 1.3 }}>
                            5, Narendra Nagar, Belgharia, North 24 Parganas,<br/>Kolkata, West Bengal, 700056
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 8, color: '#777', lineHeight: 1.4, textAlign: 'justify' }}>
                        <strong>Disclaimer:</strong> This report is generated algorithmically based on current market data and holdings. It is strictly confidential and for the addressee only. Registration granted by SEBI, membership of BASL and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors. Investment in securities market are subject to market risks. Read all the related documents carefully before investing. Past performance is not indicative of future results.
                      </div>
                    </div>
                  )}
                </div>
                
                <RunningFooter currentPage={pageNum} totalPages={totalPagesCount} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
