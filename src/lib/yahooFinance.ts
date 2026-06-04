import { fetchMarketDataCache, saveMarketDataCache } from './queries';

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

async function fetchCMOTSData(): Promise<any[]> {
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

function getIsinForSymbol(symbol: string): string | null {
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

async function fetchWithCache(url: string, isJson = true): Promise<any> {
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

function getYahooUrl(symbol: string, range: string = '1y', interval: string = '1d'): string {
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
function calculateReturns(prices: number[]): number[] {
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

function calculateMean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function calculateVariance(arr: number[], mean: number): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
}

function calculateCovariance(arr1: number[], arr2: number[], mean1: number, mean2: number): number {
  const len = Math.min(arr1.length, arr2.length);
  if (len === 0) return 0;
  let cov = 0;
  for (let i = 0; i < len; i++) {
    cov += (arr1[i] - mean1) * (arr2[i] - mean2);
  }
  return cov / len;
}

function getPeriodIndex(timestamps: number[], monthsAgo: number): number {
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

function getYTDIndex(timestamps: number[]): number {
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

let cachedNiftyReturns: number[] | null = null;

export async function fetchNifty500Returns(): Promise<BenchmarkReturn[]> {
  let dbCacheFallback: any[] = [];
  try {
    // 1. Try to load from Firestore cache
    const dbCache = await fetchMarketDataCache();
    dbCacheFallback = dbCache;
    const niftyDoc = dbCache.find(d => d.symbol === '^CRSLDX' || d.id === 'benchmark_^CRSLDX');
    
    if (niftyDoc && isCacheFresh(niftyDoc.last_updated)) {
      console.log('Restoring Nifty 500 from Firestore cache...');
      if (niftyDoc.niftyDailyReturns) {
        cachedNiftyReturns = niftyDoc.niftyDailyReturns;
      }
      return niftyDoc.returns || [];
    }

    // 2. Outdated or missing: fetch fresh from Yahoo Finance
    console.log('Fetching Nifty 500 from Yahoo Finance...');
    const url = getYahooUrl('^CRSLDX');
    const data = await fetchWithCache(url);
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('Invalid Nifty 500 data structure');

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close || [];
    
    // Save daily returns for beta calculation later
    const dailyReturns = calculateReturns(closes);
    cachedNiftyReturns = dailyReturns;

    // Scan backwards to find the last valid close price (prevents null EOD -100% bug)
    let endPrice = closes[closes.length - 1];
    for (let j = closes.length - 1; j >= 0; j--) {
      if (closes[j] !== null && closes[j] > 0) {
        endPrice = closes[j];
        break;
      }
    }

    const periods: { p: '1M' | '3M' | '6M' | '1Y' | 'YTD', label: string, idxResolver: () => number }[] = [
      { p: '1M', label: '1 Month', idxResolver: () => getPeriodIndex(timestamps, 1) },
      { p: '3M', label: '3 Months', idxResolver: () => getPeriodIndex(timestamps, 3) },
      { p: '6M', label: '6 Months', idxResolver: () => getPeriodIndex(timestamps, 6) },
      { p: 'YTD', label: 'Year to Date', idxResolver: () => getYTDIndex(timestamps) },
      { p: '1Y', label: '1 Year', idxResolver: () => 0 }, // 1Y is the full dataset (index 0)
    ];

    const benchmarkReturns: BenchmarkReturn[] = periods.map(per => {
      const startIdx = per.idxResolver();
      const startPrice = closes[startIdx] || closes[0];
      const ret = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;
      
      return {
        period: per.p,
        label: per.label,
        niftyReturn: ret,
        niftyStartPrice: startPrice,
        niftyEndPrice: endPrice
      };
    });

    // 3. Save back to Firestore cache
    await saveMarketDataCache('benchmark_^CRSLDX', {
      symbol: '^CRSLDX',
      returns: benchmarkReturns,
      niftyDailyReturns: dailyReturns
    });

    return benchmarkReturns;
  } catch (error) {
    console.error('Error fetching Nifty 500 returns:', error);
    // FALLBACK: If network/proxy fails completely, recover the latest cached version from Firestore!
    try {
      const niftyDoc = dbCacheFallback.find(d => d.symbol === '^CRSLDX' || d.id === 'benchmark_^CRSLDX');
      if (niftyDoc && niftyDoc.returns) {
        console.warn('Network failed. Restoring last available benchmark data from Firestore as fallback.');
        if (niftyDoc.niftyDailyReturns) {
          cachedNiftyReturns = niftyDoc.niftyDailyReturns;
        }
        return niftyDoc.returns;
      }
    } catch (fallbackErr) {
      console.error('Failed recovery from Firestore cache', fallbackErr);
    }
    return [];
  }
}


export async function fetchStockMarketData(nseSymbols: string[]): Promise<StockMarketData[]> {
  const results: StockMarketData[] = [];
  const validSymbols = nseSymbols.filter(s => !!s);
  if (validSymbols.length === 0) return results;

  // Helper to format symbols (stop appending .NS to .BO or other custom symbols)
  const resolveQuerySymbol = (symbol: string) => {
    let sym = symbol.trim();
    if (!sym.includes('.') && !sym.startsWith('^') && !sym.includes('=')) {
      return `${sym}.NS`;
    }
    return sym;
  };

  // 1. Fetch entire Firestore cache in a single fast query
  const dbCache = await fetchMarketDataCache();

  const pendingSymbols: string[] = [];

  // 2. Load fresh ones from cache, mark others as pending
  validSymbols.forEach(symbol => {
    const querySymbol = resolveQuerySymbol(symbol);
    const cachedEntry = dbCache.find(d => d.symbol === symbol || d.symbol === querySymbol || d.id === symbol || d.id === querySymbol);
    
    if (cachedEntry && isCacheFresh(cachedEntry.last_updated) && cachedEntry.currentPrice > 0) {
      results.push({
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
    } else {
      pendingSymbols.push(symbol);
    }
  });

  console.log(`Cache matching: ${results.length} fresh, ${pendingSymbols.length} pending.`);

  if (pendingSymbols.length === 0) {
    return results;
  }

  // 3. We have pending symbols. Prepare Nifty 500 returns for beta calculation.
  if (!cachedNiftyReturns) {
    await fetchNifty500Returns(); 
  }
  const niftyReturns = cachedNiftyReturns || [];
  const niftyMean = calculateMean(niftyReturns);
  const niftyVar = calculateVariance(niftyReturns, niftyMean);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // 4. Pre-fetch CMOTS live price data to guarantee pricing even if Yahoo fails
  const cmotsData = await fetchCMOTSData();

  // 5. Batch fetch pending symbols from Yahoo Finance
  const concurrencyLimit = 5;
  for (let i = 0; i < pendingSymbols.length; i += concurrencyLimit) {
    const batch = pendingSymbols.slice(i, i + concurrencyLimit);
    
    const batchPromises = batch.map(async (symbol) => {
      try {
        const querySymbol = resolveQuerySymbol(symbol);
        
        // Handle SGBs specially since Yahoo often doesn't have good daily volume/OHLCV for them.
        if (querySymbol.startsWith('SGB')) {
            const dataObj = {
              symbol,
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
              trueBeta: 0,
              volatility: 0,
              liquidity: 'Medium' as const
            };
            // Cache SGB placeholder in Firestore so we don't keep hammering Yahoo
            await saveMarketDataCache(symbol, dataObj);
            return dataObj;
        }

        // Find CMOTS Match for reliable current price
        const cmotsMatch = cmotsData.find(d => d.scripcode === symbol || d.scripcode === symbol.replace('.NS', '') || d.scripcode === symbol.replace('.BO', ''));
        
        let currentPrice = cmotsMatch ? cmotsMatch.close : 0;
        let high52W = cmotsMatch ? cmotsMatch.high : 0;
        let low52W = cmotsMatch ? cmotsMatch.low : 0;
        let pctFromHigh = 0;
        let pctFromLow = 0;
        let return1Y = 0, returnYTD = 0, return6M = 0, return3M = 0, return1M = 0;
        let trueBeta = 1.0, annualizedVolatility = 0;
        let liquidity: 'High' | 'Medium' | 'Low' = 'Low';

        // Check if it's an ETF and we need to fetch from ETF API
        if (!currentPrice) {
          const isin = getIsinForSymbol(symbol);
          if (isin) {
            try {
              const baseUrl = isLocalEnv() ? '/api/cmots' : 'https://invesmateapis.cmots.com';
              const etfRes = await fetch(`${baseUrl}/api/ETFGetQuotes/NSE/${isin}`);
              const etfJson = await etfRes.json();
              if (etfJson.success && etfJson.data && etfJson.data.length > 0) {
                const etfData = etfJson.data[0];
                currentPrice = etfData.CurrentPrice;
                high52W = etfData.HI_52_WK || etfData.DayHigh;
                low52W = etfData.LO_52_WK || etfData.DayLow;
              }
            } catch (etfErr) {
              console.warn(`Failed to fetch CMOTS ETF API for ${symbol} / ${isin}`, etfErr);
            }
          }
        }
        try {
          const url = getYahooUrl(querySymbol);
          const data = await fetchWithCache(url);
          
          const result = data.chart?.result?.[0];
          if (result) {
            const meta = result.meta;
            const closes = result.indicators.quote[0].close || [];
            const volumes = result.indicators.quote[0].volume || [];
            const timestamps = result.timestamp || [];
            
            // If CMOTS failed, fallback to Yahoo
            if (!currentPrice) currentPrice = meta.regularMarketPrice || 0;
            if (!high52W) high52W = meta.fiftyTwoWeekHigh || currentPrice;
            if (!low52W) low52W = meta.fiftyTwoWeekLow || currentPrice;
            
            pctFromHigh = high52W > 0 ? ((currentPrice - high52W) / high52W) * 100 : 0;
            pctFromLow = low52W > 0 ? ((currentPrice - low52W) / low52W) * 100 : 0;
            
            // 1Y Return
            const startPrice = closes.find((c: number) => c !== null && c > 0) || currentPrice;
            return1Y = startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;

            // Scan backwards to find the last valid close price
            let endPrice = closes[closes.length - 1] || currentPrice;
            for (let j = closes.length - 1; j >= 0; j--) {
              if (closes[j] !== null && closes[j] > 0) {
                endPrice = closes[j];
                break;
              }
            }

            const idx1M = getPeriodIndex(timestamps, 1);
            const idx3M = getPeriodIndex(timestamps, 3);
            const idx6M = getPeriodIndex(timestamps, 6);
            const idxYTD = getYTDIndex(timestamps);

            return1M = closes[idx1M] > 0 ? ((endPrice - closes[idx1M]) / closes[idx1M]) * 100 : 0;
            return3M = closes[idx3M] > 0 ? ((endPrice - closes[idx3M]) / closes[idx3M]) * 100 : 0;
            return6M = closes[idx6M] > 0 ? ((endPrice - closes[idx6M]) / closes[idx6M]) * 100 : 0;
            returnYTD = closes[idxYTD] > 0 ? ((endPrice - closes[idxYTD]) / closes[idxYTD]) * 100 : 0;

            // Volatility & Beta
            const stockReturns = calculateReturns(closes.filter((c: number) => c !== null));
            const stockMean = calculateMean(stockReturns);
            const stockVar = calculateVariance(stockReturns, stockMean);
            
            annualizedVolatility = Math.sqrt(stockVar) * Math.sqrt(252) * 100;
            
            if (niftyVar > 0 && stockReturns.length > 0) {
              const len = Math.min(stockReturns.length, niftyReturns.length);
              const alignedStockReturns = stockReturns.slice(stockReturns.length - len);
              const alignedNiftyReturns = niftyReturns.slice(niftyReturns.length - len);
              const cov = calculateCovariance(alignedStockReturns, alignedNiftyReturns, calculateMean(alignedStockReturns), calculateMean(alignedNiftyReturns));
              trueBeta = cov / niftyVar;
            }

            const avgVolume = calculateMean(volumes.filter((v: number) => v !== null));
            const dailyTurnover = avgVolume * currentPrice;
            if (dailyTurnover > 50_000_0000) liquidity = 'High';
            else if (dailyTurnover > 10_000_0000) liquidity = 'Medium';
          }
        } catch (yahooErr) {
          console.warn(`Yahoo Finance failed for ${symbol}, falling back to CMOTS-only data`, yahooErr);
        }

        const dataObj = {
          symbol,
          high52W,
          low52W,
          currentPrice,
          pctFromHigh,
          pctFromLow,
          return1Y,
          returnYTD,
          return6M,
          return3M,
          return1M,
          trueBeta,
          volatility: annualizedVolatility,
          liquidity
        };

        // Cache stock data in Firestore so it's shared
        await saveMarketDataCache(symbol, dataObj);

        return dataObj;

      } catch (err) {
        console.warn(`Failed to fetch market data for ${symbol}`, err);
        // FALLBACK: Search in dbCache for the outdated cached entry!
        const querySymbol = resolveQuerySymbol(symbol);
        const cachedEntry = dbCache.find(d => d.symbol === symbol || d.symbol === querySymbol || d.id === symbol || d.id === querySymbol);
        if (cachedEntry && cachedEntry.currentPrice >= 0) {
          console.warn(`Using outdated cached data for ${symbol} as fallback.`);
          return {
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
          };
        }
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(r => {
      if (r) results.push(r);
    });

    // Add a tiny delay between batches to respect rate limits
    if (i + concurrencyLimit < pendingSymbols.length) {
      await sleep(150);
    }
  }

  return results;
}
