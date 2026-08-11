import { fetchMarketDataCache } from './queries';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export function isCacheFresh(lastUpdatedStr?: string): boolean {
  if (!lastUpdatedStr) return false;
  
  const lastUpdated = new Date(lastUpdatedStr);
  const now = new Date();
  
  // Convert now and lastUpdated to Indian Standard Time (IST = UTC + 5:30)
  const getISTTime = (d: Date) => {
    return new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
  };
  
  const nowIST = getISTTime(now);
  const updatedIST = getISTTime(lastUpdated);
  
  const nowYear = nowIST.getUTCFullYear();
  const nowMonth = nowIST.getUTCMonth();
  const nowDate = nowIST.getUTCDate();
  
  // Expected EOD timestamp for today in IST is 4:00 PM (16:00)
  let expectedEODIST = new Date(Date.UTC(nowYear, nowMonth, nowDate, 16, 0, 0));
  
  if (nowIST.getTime() < expectedEODIST.getTime()) {
    // If it is before 4:00 PM IST today, the expected EOD was yesterday's 4:00 PM IST
    expectedEODIST.setUTCDate(expectedEODIST.getUTCDate() - 1);
  }
  
  // If the expected EOD date lands on a weekend (Saturday or Sunday),
  // we roll it back to Friday since weekends have no new market closing data.
  while (expectedEODIST.getUTCDay() === 0 || expectedEODIST.getUTCDay() === 6) {
    expectedEODIST.setUTCDate(expectedEODIST.getUTCDate() - 1);
  }
  
  // If the data in Firestore was updated at or after this last expected market close, it is fresh!
  return updatedIST.getTime() >= expectedEODIST.getTime();
}

export interface BenchmarkReturn {
  period: '1M' | '3M' | '6M' | '1Y' | 'YTD';
  label: string;
  niftyReturn: number;
  niftyStartPrice: number;
  niftyEndPrice: number;
}

export interface StockMarketData {
  symbol: string;
  high52W: number;
  low52W: number;
  currentPrice: number;
  pctFromHigh: number;
  pctFromLow: number;
  return1Y: number;
  returnYTD: number;
  return6M: number;
  return3M: number;
  return1M: number;
  trueBeta: number;
  volatility: number;
  liquidity: 'High' | 'Medium' | 'Low';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

import etfMaster from './etfMaster.json';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { timestamp: number; data: any }>();

function isLocalEnv() {
  return import.meta.env.DEV;
}

let cmotsCache: any[] | null = null;
let cmotsCacheTime = 0;

export async function fetchCMOTSData(): Promise<any[]> {
  if (cmotsCache && cmotsCache.length > 0 && Date.now() - cmotsCacheTime < CACHE_TTL) {
    return cmotsCache;
  }
  try {
    const baseUrl = isLocalEnv() ? '/api/cmots' : 'https://invesmateapis.cmots.com';
    const [nseRes, bseRes] = await Promise.all([
      fetch(`${baseUrl}/api/EOD-Bhav-Copy/NSE`),
      fetch(`${baseUrl}/api/EOD-Bhav-Copy/BSE`)
    ]);
    const nseData = nseRes.ok ? await nseRes.json() : { data: [] };
    const bseData = bseRes.ok ? await bseRes.json() : { data: [] };
    
    cmotsCache = [...(nseData.data || []), ...(bseData.data || [])];
    cmotsCacheTime = Date.now();
    return cmotsCache;
  } catch (err) {
    console.error('Failed to fetch CMOTS data', err);
    return [];
  }
}

export function getIsinForSymbol(symbol: string): string | null {
  const upper = symbol.toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
  
  if ((etfMaster.isin as Record<string, number>)[upper] !== undefined) {
      return upper;
  }
  
  const idx = (etfMaster.ticker as Record<string, number>)[upper];
  if (idx !== undefined) {
      const isinEntries = Object.entries(etfMaster.isin);
      const match = isinEntries.find(([_, i]) => i === idx);
      if (match) return match[0];
  }
  
  return null;
}

export async function fetchWithCache(url: string, isJson = true): Promise<any> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const executeFetch = async (targetUrl: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = isJson ? await res.json() : await res.text();
      return data;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  };

  try {
    const data = await executeFetch(url);
    cache.set(url, { timestamp: Date.now(), data });
    return data;
  } catch (error) {
    // CORS Proxy Fallback Chain
    if (!isLocalEnv() && url.includes('corsproxy.io')) {
      try {
        const decodedEndpoint = decodeURIComponent(url.replace('https://corsproxy.io/?', ''));
        const fallbackUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(decodedEndpoint)}`;
        console.warn(`corsproxy.io failed. Trying fallback api.allorigins.win...`);
        const data = await executeFetch(fallbackUrl);
        cache.set(url, { timestamp: Date.now(), data });
        return data;
      } catch (fallbackErr) {
        console.error('Both CORS proxies failed', fallbackErr);
      }
    } else if (!isLocalEnv() && url.includes('allorigins.win')) {
      try {
        const decodedEndpoint = decodeURIComponent(url.replace('https://api.allorigins.win/raw?url=', ''));
        const fallbackUrl = `https://corsproxy.io/?${encodeURIComponent(decodedEndpoint)}`;
        console.warn(`api.allorigins.win failed. Trying fallback corsproxy.io...`);
        const data = await executeFetch(fallbackUrl);
        cache.set(url, { timestamp: Date.now(), data });
        return data;
      } catch (fallbackErr) {
        console.error('Both CORS proxies failed', fallbackErr);
      }
    }
    throw error;
  }
}

export function getYahooUrl(symbol: string, range: string = '1y', interval: string = '1d'): string {
  const isLocal = isLocalEnv();
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
  
  if (isLocal) {
    return `/api/finance/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
  } else {
    // Using corsproxy.io as fallback since allorigins is throwing 520 errors
    return `https://corsproxy.io/?${encodeURIComponent(endpoint)}`;
  }
}

// Stats Helpers
export function calculateReturns(prices: number[]): number[] {
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i-1] > 0) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1]);
    } else {
      returns.push(0);
    }
  }
  return returns;
}

export function calculateMean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function calculateVariance(arr: number[], mean: number): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
}

export function calculateCovariance(arr1: number[], arr2: number[], mean1: number, mean2: number): number {
  const len = Math.min(arr1.length, arr2.length);
  if (len === 0) return 0;
  let cov = 0;
  for (let i = 0; i < len; i++) {
    cov += (arr1[i] - mean1) * (arr2[i] - mean2);
  }
  return cov / len;
}

export function getPeriodIndex(timestamps: number[], monthsAgo: number): number {
  const now = Date.now() / 1000;
  // Approximation: 1 month = 30.44 days
  const targetTime = now - (monthsAgo * 30.44 * 24 * 60 * 60);
  
  // Find index closest to targetTime
  let bestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function getYTDIndex(timestamps: number[]): number {
  const currentYear = new Date().getFullYear();
  const startOfYear = new Date(`${currentYear}-01-01T00:00:00Z`).getTime() / 1000;
  
  // Find first trading day of the year
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] >= startOfYear) {
      return i;
    }
  }
  return 0; // fallback to start of available data
}


// ─── Main Functions ─────────────────────────────────────────────────────────

export let cachedNiftyReturns: number[] | null = null;

export async function fetchNifty500Returns(): Promise<BenchmarkReturn[]> {
  try {
    const dbCache = await fetchMarketDataCache();
    const niftyDoc = dbCache.find(d => d.symbol === '^CRSLDX' || d.id === 'benchmark_^CRSLDX');
    
    if (niftyDoc) {
      console.log('Restoring Nifty 500 from Firestore cache...');
      if (niftyDoc.niftyDailyReturns) {
        cachedNiftyReturns = niftyDoc.niftyDailyReturns;
      }
      return niftyDoc.returns || [];
    }
    throw new Error('Nifty 500 benchmark document not found in Firestore cache');
  } catch (error) {
    console.error('Error fetching Nifty 500 returns:', error);
    return [];
  }
}


export async function fetchStockMarketData(nseSymbols: string[]): Promise<StockMarketData[]> {
  const results: StockMarketData[] = [];
  const validSymbols = nseSymbols.filter(s => !!s);
  if (validSymbols.length === 0) return results;

  const resolveQuerySymbol = (symbol: string) => {
    let sym = symbol.trim();
    if (!sym.includes('.') && !sym.startsWith('^') && !sym.includes('=')) {
      return `${sym}.NS`;
    }
    return sym;
  };

  try {
    const dbCache = await fetchMarketDataCache();
    const pendingSymbols: string[] = [];

    validSymbols.forEach(symbol => {
      const querySymbol = resolveQuerySymbol(symbol);
      const cachedEntry = dbCache.find(d => 
        d.symbol === symbol || 
        d.symbol === querySymbol || 
        d.id === symbol || 
        d.id === querySymbol
      );
      
      if (cachedEntry && cachedEntry.currentPrice > 0) {
        results.push({
          symbol: symbol,
          high52W: cachedEntry.high52W || cachedEntry.currentPrice || 0,
          low52W: cachedEntry.low52W || cachedEntry.currentPrice || 0,
          currentPrice: cachedEntry.currentPrice || 0,
          pctFromHigh: cachedEntry.pctFromHigh || 0,
          pctFromLow: cachedEntry.pctFromLow || 0,
          return1Y: cachedEntry.return1Y || 0,
          returnYTD: cachedEntry.returnYTD || 0,
          return6M: cachedEntry.return6M || 0,
          return3M: cachedEntry.return3M || 0,
          return1M: cachedEntry.return1M || 0,
          trueBeta: cachedEntry.trueBeta ?? 1.0,
          volatility: cachedEntry.volatility || 0,
          liquidity: cachedEntry.liquidity || 'Medium'
        });
      } else {
        pendingSymbols.push(symbol);
      }
    });

    console.log(`[Market Data Cache] Found ${results.length} in market_data, ${pendingSymbols.length} pending fallback`);

    if (pendingSymbols.length > 0) {
      const fallbackPromises = pendingSymbols.map(async (symbol) => {
        try {
          const upper = symbol.toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
          const priceDocRef = doc(db, 'price_cache', upper);
          const priceSnap = await getDoc(priceDocRef);
          let price = 0;
          if (priceSnap.exists()) {
            price = priceSnap.data().close || 0;
          }
          
          return {
            symbol: symbol,
            high52W: price,
            low52W: price,
            currentPrice: price,
            pctFromHigh: 0,
            pctFromLow: 0,
            return1Y: 0,
            returnYTD: 0,
            return6M: 0,
            return3M: 0,
            return1M: 0,
            trueBeta: 1.0,
            volatility: 0,
            liquidity: 'Medium' as const
          };
        } catch (err) {
          console.warn(`Failed fallback price fetch for ${symbol}`, err);
          return {
            symbol: symbol,
            high52W: 0,
            low52W: 0,
            currentPrice: 0,
            pctFromHigh: 0,
            pctFromLow: 0,
            return1Y: 0,
            returnYTD: 0,
            return6M: 0,
            return3M: 0,
            return1M: 0,
            trueBeta: 1.0,
            volatility: 0,
            liquidity: 'Medium' as const
          };
        }
      });
      
      const fallbacks = await Promise.all(fallbackPromises);
      fallbacks.forEach(f => {
        if (f) results.push(f);
      });
    }
  } catch (error) {
    console.error('Error fetching stock market data:', error);
  }

  return results;
}

// ─── NSE Bhavcopy Sync ────────────────────────────────────────────────────────
// Downloads the full NSE EOD Bhavcopy CSV (all listed securities at once).
// Uses the same proxy chain as Yahoo Finance (local Vite proxy or CORS proxies).
// Covers equities, ETFs, SGBs, and all other NSE-listed instruments.

const ALLOWED_SERIES = new Set(['EQ', 'BE', 'BZ', 'SM', 'ST', 'GS']);

/** Returns a date string in DDMMYYYY format for IST, offset by `daysBack`. */
function getBhavcopyDateStr(daysBack: number): string {
  const utcNow = Date.now();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(utcNow + istOffset - daysBack * 86400000);
  const dd = String(istDate.getUTCDate()).padStart(2, '0');
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = istDate.getUTCFullYear();
  return `${dd}${mm}${yyyy}`;
}

/** Attempts a fetch through the local Vite proxy (dev) or CORS proxies (prod). */
async function fetchNSECsv(dateStr: string): Promise<string | null> {
  const nsePath = `/products/content/sec_bhavdata_full_${dateStr}.csv`;

  if (isLocalEnv()) {
    try {
      const res = await fetch(`/api/nse${nsePath}`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) return await res.text();
    } catch { /* fall through */ }
    return null;
  }

  // Production: try corsproxy.io first, then allorigins.win
  const targetUrl = `https://archives.nseindia.com${nsePath}`;
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const text = await res.text();
        // Sanity check: a valid bhavcopy starts with "SYMBOL"
        if (text.trimStart().startsWith('SYMBOL')) return text;
      }
    } catch { /* try next proxy */ }
  }
  return null;
}

/** Parse CSV text → Map<SYMBOL, closePrice> */
function parseBhavcopyCSV(csvText: string): Map<string, number> {
  const priceMap = new Map<string, number>();
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return priceMap;

  // Header: SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, ...
  const header = lines[0].split(',').map(h => h.trim());
  const symbolIdx = header.indexOf('SYMBOL');
  const seriesIdx = header.indexOf('SERIES');
  const closeIdx  = header.indexOf('CLOSE_PRICE');

  if (symbolIdx < 0 || closeIdx < 0) return priceMap;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const symbol = cols[symbolIdx]?.toUpperCase();
    const series = cols[seriesIdx]?.trim().toUpperCase() || '';
    const close  = parseFloat(cols[closeIdx]);

    if (symbol && !isNaN(close) && close > 0 && ALLOWED_SERIES.has(series)) {
      priceMap.set(symbol, close);
    }
  }
  return priceMap;
}

export interface BhavcopyResult {
  priceMap: Map<string, number>;
  dateStr: string;   // DDMMYYYY of the data used
  recordCount: number;
}

/**
 * Downloads the most recent NSE Bhavcopy and returns a Map of SYMBOL → close price.
 * Tries today first, then walks back up to 10 days to handle weekends/holidays.
 */
export async function fetchNSEBhavcopy(): Promise<BhavcopyResult | null> {
  // Start from yesterday (bhavcopy for today is only available after ~7 PM IST)
  for (let daysBack = 1; daysBack <= 10; daysBack++) {
    const dateStr = getBhavcopyDateStr(daysBack);
    console.log(`[Bhavcopy] Trying date: ${dateStr} (offset -${daysBack}d)`);
    const csvText = await fetchNSECsv(dateStr);
    if (csvText) {
      const priceMap = parseBhavcopyCSV(csvText);
      if (priceMap.size > 100) { // must have meaningful data
        console.log(`[Bhavcopy] ✓ Got ${priceMap.size} prices for ${dateStr}`);
        return { priceMap, dateStr, recordCount: priceMap.size };
      }
    }
  }
  console.error('[Bhavcopy] Could not find valid bhavcopy in last 10 days');
  return null;
}
