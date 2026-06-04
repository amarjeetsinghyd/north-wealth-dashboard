import React from 'react';
import { Activity, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import type { BenchmarkReturn, StockMarketData } from '../lib/yahooFinance';
import type { Holding } from '../types';
import { getStockMeta } from '../lib/sectorMap';

export const SectionCard = ({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) => (
  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e2e8f0', height: '100%', boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>
      <div style={{ color: '#111' }}>{icon}</div>
      <h3 style={{ fontSize: 11, fontWeight: 900, color: '#111', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</h3>
    </div>
    {children}
  </div>
);

interface Phase2SectionsProps {
  benchmarkData: BenchmarkReturn[] | null;
  stockMarketData: StockMarketData[] | null;
  holdings: Holding[];
  totalInvested: number;
  totalValue: number;
}

export function BenchmarkComparison({ benchmarkData, stockMarketData, holdings, totalValue }: Phase2SectionsProps) {
  if (!benchmarkData || benchmarkData.length === 0) {
    return (
      <SectionCard title="Benchmark Comparison & Alpha" icon={<Activity size={16} />}>
        <div style={{ color: '#dc2626', fontSize: 12, padding: '10px 0', textAlign: 'center', fontWeight: 600 }}>
          Market data temporarily unavailable. Please check your network connection or try again later.
        </div>
      </SectionCard>
    );
  }

  let portfolio1YReturn = 0;

  const chartData = benchmarkData.map(b => {
    let portfolioWeightedReturn = 0;
    
    holdings.forEach(h => {
      const symbol = h.nse_symbol || h.stock_symbol;
      const smd = stockMarketData?.find(s => s.symbol === symbol || s.symbol === `${symbol}.NS`);
      
      if (smd) {
        const holdingValue = h.current_value || (h.buy_price * h.quantity);
        const weight = totalValue > 0 ? holdingValue / totalValue : 0;
        
        let scripReturn = 0;
        if (b.period === '1M') scripReturn = smd.return1M || 0;
        else if (b.period === '3M') scripReturn = smd.return3M || 0;
        else if (b.period === '6M') scripReturn = smd.return6M || 0;
        else if (b.period === 'YTD') scripReturn = smd.returnYTD || 0;
        else if (b.period === '1Y') scripReturn = smd.return1Y || 0;
        
        portfolioWeightedReturn += (scripReturn * weight);
      }
    });

    if (b.period === '1Y') portfolio1YReturn = portfolioWeightedReturn;

    return {
      name: b.label,
      Nifty500: parseFloat(b.niftyReturn.toFixed(2)),
      Portfolio: parseFloat(portfolioWeightedReturn.toFixed(2)),
      Alpha: parseFloat((portfolioWeightedReturn - b.niftyReturn).toFixed(2))
    };
  });

  const data1Y = benchmarkData.find(d => d.period === '1Y');
  const nifty1Y = data1Y ? data1Y.niftyReturn : 0;
  const alpha1Y = portfolio1YReturn - nifty1Y;

  return (
    <SectionCard title="Historical Performance & Alpha" icon={<Activity size={16} />}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
        
        {/* Alpha Summary Bar */}
        <div style={{ background: '#faf9f5', border: '1px solid #d4af37', borderRadius: 8, padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Portfolio Return (1Y)</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#111' }}>{portfolio1YReturn.toFixed(2)}%</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Nifty 500 (1Y)</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#111' }}>{nifty1Y.toFixed(2)}%</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Generated Alpha (1Y)</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: alpha1Y >= 0 ? '#16a34a' : '#dc2626' }}>
              {alpha1Y > 0 ? '+' : ''}{alpha1Y.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Chart */}
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#666', fontWeight: 600 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#666' }} tickFormatter={(val: number) => `${val}%`} />
              <RechartsTooltip formatter={(value: any) => [`${value}%`]} cursor={{ fill: '#f5f5f5' }} />
              <Bar dataKey="Portfolio" fill="#C9A84C" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar dataKey="Nifty500" fill="#334155" radius={[4, 4, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        <div style={{ fontSize: 9, color: '#888', fontStyle: 'italic', textAlign: 'center' }}>
          *Note: Portfolio returns shown are based on static weightings of current holdings.
        </div>
      </div>
    </SectionCard>
  );
}


export function StockLevelAnalysis({ stockMarketData, holdings, totalValue }: Phase2SectionsProps) {
  if (!stockMarketData || stockMarketData.length === 0) {
    return (
      <SectionCard title="Stock-Level Risk, Momentum & Alpha Analysis" icon={<TrendingUp size={16} />}>
        <div style={{ color: '#dc2626', fontSize: 12, padding: '10px 0', textAlign: 'center', fontWeight: 600 }}>
          Market data temporarily unavailable. Please check your network connection or try again later.
        </div>
      </SectionCard>
    );
  }

  // 52W Distribution
  let nearHigh = 0;
  let nearLow = 0;
  let neutral = 0;

  const scripAnalyses: any[] = [];

  holdings.forEach(h => {
    const symbol = h.nse_symbol || h.stock_symbol;
    const smd = stockMarketData.find(s => s.symbol === symbol || s.symbol === `${symbol}.NS`);
    const meta = getStockMeta(symbol, symbol);
    
    if (smd) {
      if (smd.pctFromHigh >= -10) nearHigh++;
      else if (smd.pctFromLow <= 20) nearLow++;
      else neutral++;

      // Generate Dynamic Text
      let text = '';
      if (meta.assetClass === 'Equity') {
         text = `${symbol}: ${smd.liquidity} liquidity, ${meta.marketCap}-cap ${meta.sector} equity with a 1Y return of ${smd.return1Y > 0 ? '+' : ''}${smd.return1Y.toFixed(1)}%. Currently trading ${Math.abs(smd.pctFromHigh).toFixed(1)}% below its 52W high, with a true beta of ${smd.trueBeta.toFixed(2)}.`;
      } else if (meta.assetClass === 'ETF' && !meta.sector.toLowerCase().includes('gold')) {
         text = `${symbol}: ${smd.liquidity} liquidity Index/Sector ETF tracking the broader market. 1Y Return: ${smd.return1Y > 0 ? '+' : ''}${smd.return1Y.toFixed(1)}% with annualized volatility of ${smd.volatility.toFixed(1)}%.`;
      } else if (symbol.startsWith('SGB') || meta.sector.toLowerCase().includes('gold')) {
         text = `${symbol}: Sovereign/Gold asset providing portfolio hedge. Trading ${Math.abs(smd.pctFromHigh).toFixed(1)}% below its 52W high.`;
      } else {
         text = `${symbol}: 1Y Return: ${smd.return1Y.toFixed(1)}%. Beta: ${smd.trueBeta.toFixed(2)}. Volatility: ${smd.volatility.toFixed(1)}%.`;
      }
      
      scripAnalyses.push({
        symbol,
        company: h.company_name,
        beta: smd.trueBeta,
        vol: smd.volatility,
        alpha: smd.return1Y, // simplified as absolute return
        liquidity: smd.liquidity,
        text,
        weight: totalValue > 0 ? ((h.current_value || h.buy_price * h.quantity) / totalValue) * 100 : 0
      });
    }
  });

  // Sort by weight
  scripAnalyses.sort((a, b) => b.weight - a.weight);

  return (
    <SectionCard title="Stock-Level Risk, Momentum & Alpha Analysis" icon={<TrendingUp size={16} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* Distribution Strip */}
        <div style={{ display: 'flex', gap: 2, borderRadius: 4, overflow: 'hidden', height: 24 }}>
          <div style={{ flex: nearHigh, background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>
            {nearHigh > 0 && `${nearHigh} Near 52W High`}
          </div>
          <div style={{ flex: neutral, background: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 10, fontWeight: 700 }}>
            {neutral > 0 && `${neutral} Neutral`}
          </div>
          <div style={{ flex: nearLow, background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>
            {nearLow > 0 && `${nearLow} Near 52W Low`}
          </div>
        </div>

        {/* Scrip Analysis List (Top 5 for brevity) */}
        <div>
          <h4 style={{ fontSize: 11, fontWeight: 800, color: '#C9A84C', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Dynamic Scrip Analysis (Top 5 Holdings)
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {scripAnalyses.slice(0, 5).map((s, i) => (
              <div key={i} style={{ fontSize: 10, color: '#444', lineHeight: 1.4, background: '#f8fafc', padding: '8px 12px', borderRadius: 6, borderLeft: '3px solid #C9A84C' }}>
                {s.text}
              </div>
            ))}
          </div>
        </div>

      </div>
    </SectionCard>
  );
}

export function RiskAndVolatilityTable({ stockMarketData, holdings, totalValue }: Phase2SectionsProps) {
  if (!stockMarketData || stockMarketData.length === 0) return null; // Can just hide the table if data is missing, the above section already shows the error

  const data = holdings.map(h => {
    const symbol = h.nse_symbol || h.stock_symbol;
    const smd = stockMarketData.find(s => s.symbol === symbol || s.symbol === `${symbol}.NS`);
    const weight = totalValue > 0 ? ((h.current_value || h.buy_price * h.quantity) / totalValue) * 100 : 0;
    return {
      symbol: cleanSymbol(symbol),
      weight,
      beta: smd?.trueBeta || 0,
      volatility: smd?.volatility || 0,
      return1Y: smd?.return1Y || 0,
      liquidity: smd?.liquidity || 'Unknown'
    };
  }).sort((a, b) => b.weight - a.weight);

  return (
    <SectionCard title="Holding Risk & Return Metrics" icon={<Activity size={14} />}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 5px', borderBottom: '1px solid #ddd', color: '#777' }}>Asset</th>
            <th style={{ textAlign: 'right', padding: '6px 5px', borderBottom: '1px solid #ddd', color: '#777' }}>Wt%</th>
            <th style={{ textAlign: 'right', padding: '6px 5px', borderBottom: '1px solid #ddd', color: '#777' }}>True Beta</th>
            <th style={{ textAlign: 'right', padding: '6px 5px', borderBottom: '1px solid #ddd', color: '#777' }}>1Y Vol.</th>
            <th style={{ textAlign: 'right', padding: '6px 5px', borderBottom: '1px solid #ddd', color: '#777' }}>1Y Ret.</th>
            <th style={{ textAlign: 'right', padding: '6px 5px', borderBottom: '1px solid #ddd', color: '#777' }}>Liquidity</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 15).map((d, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '6px 5px', fontWeight: 800 }}>{d.symbol}</td>
              <td style={{ padding: '6px 5px', textAlign: 'right' }}>{d.weight.toFixed(1)}%</td>
              <td style={{ padding: '6px 5px', textAlign: 'right', color: d.beta > 1.2 ? '#dc2626' : (d.beta < 0.8 ? '#16a34a' : '#111') }}>{d.beta.toFixed(2)}</td>
              <td style={{ padding: '6px 5px', textAlign: 'right' }}>{d.volatility.toFixed(1)}%</td>
              <td style={{ padding: '6px 5px', textAlign: 'right', color: d.return1Y > 0 ? '#16a34a' : '#dc2626' }}>{d.return1Y > 0 ? '+' : ''}{d.return1Y.toFixed(1)}%</td>
              <td style={{ padding: '6px 5px', textAlign: 'right' }}>
                <span style={{ 
                  background: d.liquidity === 'High' ? '#dcfce7' : d.liquidity === 'Medium' ? '#fef9c3' : '#fee2e2', 
                  color: d.liquidity === 'High' ? '#166534' : d.liquidity === 'Medium' ? '#854d0e' : '#991b1b',
                  padding: '2px 6px', borderRadius: 4, fontWeight: 600, fontSize: 11
                }}>
                  {d.liquidity}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  );
}

export function TransactionAnalytics({ transactions }: Phase2SectionsProps & { transactions: any[] }) {
  const hasTransactionDates = transactions && transactions.length > 0 && transactions.some(t => t.date && t.date !== new Date().toISOString().split('T')[0]);
  
  if (!hasTransactionDates) {
    // Hidden completely when no valid historical transaction dates exist
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionCard title="Advanced Risk & Return Metrics" icon={<Activity size={16} />}>
        <div style={{ padding: 20, textAlign: 'center', color: '#666', fontSize: 12, background: '#f8fafc', borderRadius: 8, border: '1px dashed #cbd5e1' }}>
          Transaction History not detected. Advanced Risk Metrics (CAGR, Sharpe, Max Drawdown) module will activate here in the next update.
        </div>
      </SectionCard>
      
      <SectionCard title="LTCG / STCG Tax Classification" icon={<TrendingUp size={16} />}>
        <div style={{ padding: 20, textAlign: 'center', color: '#666', fontSize: 12, background: '#f8fafc', borderRadius: 8, border: '1px dashed #cbd5e1' }}>
          Transaction History not detected. Taxation module (LTCG vs STCG classification) will activate here in the next update.
        </div>
      </SectionCard>
    </div>
  );
}

function cleanSymbol(symbol: string) {
  return symbol.replace('.NS', '').replace('.BO', '');
}
