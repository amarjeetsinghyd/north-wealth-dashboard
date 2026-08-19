export interface BenchmarkReturn {
  period: '1M' | '3M' | '6M' | '1Y' | 'YTD';
  label: string;
  niftyReturn: number;
  niftyStartPrice: number;
  niftyEndPrice: number;
}

export interface MarketDataCacheEntry {
  id?: string;
  symbol: string;
  currentPrice: number;
  high52W?: number;
  low52W?: number;
  pctFromHigh?: number;
  pctFromLow?: number;
  return1Y?: number;
  returnYTD?: number;
  return6M?: number;
  return3M?: number;
  return1M?: number;
  trueBeta?: number;
  volatility?: number;
  liquidity?: 'High' | 'Medium' | 'Low';
  returns?: BenchmarkReturn[];
  niftyDailyReturns?: number[];
  last_updated?: string;
  [key: string]: any;
}

export interface BenchmarkDataPoint {
  date: string;
  value: number;
}