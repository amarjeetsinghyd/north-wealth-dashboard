import companyMaster from './companyMaster.json';
import etfMaster from './etfMaster.json';
import etfSectorMap from './etfSectorMap.json';

export type CompanyTuple = (string | number | null)[];

export interface CompanyMaster {
  nse: Record<string, number>;
  bse: Record<string, number>;
  isin: Record<string, number>;
  companies: CompanyTuple[];
}

export { companyMaster, etfMaster };

export type MarketCap = 'Large' | 'Mid' | 'Small';
export type AssetClass = 'Equity' | 'Commodity' | 'Debt' | 'ETF' | 'Mutual Fund';

export interface StockMeta {
  sector: string;
  marketCap: MarketCap;
  assetClass: AssetClass;
  pe?: number;
  pb?: number;
  divYield?: number;
  industry?: string;
  mcap?: number;
  companyName?: string;
  listingStatus?: 'Active' | 'Delisted' | 'BSE Only' | 'Suspended' | 'Unlisted';
  statusReason?: string;
}

const DEFAULT_META: StockMeta = {
  sector: 'Others',
  marketCap: 'Mid',
  assetClass: 'Equity',
  pe: 20.0,
  pb: 2.5,
  divYield: 1.0,
  listingStatus: 'Active',
  statusReason: 'Standard active listing',
};


/**
 * Looks up metadata for a given NSE symbol.
 * Priority:
 *   1. etfSectorMap.json  — exact NSE ticker → ETF sector (built from CSV cross-reference)
 *   2. companyMaster.json — exact NSE/BSE symbol → company sector (from CMOTS CSV)
 *   3. DEFAULT_META (Others) if nothing found
 *
 * NO name-based heuristics. Sector is ALWAYS taken verbatim from the CSV masters.
 */
// Fast O(1) company name & shortname lookup index for BSE-only & unlisted stocks
const companyNameIndex: Record<string, number> = {};
(() => {
  const comps = ((companyMaster as any).companies || []) as CompanyTuple[];
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    if (!c) continue;
    if (c[7]) {
      const k = String(c[7]).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (k && companyNameIndex[k] === undefined) companyNameIndex[k] = i;
    }
    if (c[0]) {
      const k = String(c[0]).toUpperCase()
        .replace(/LIMITED/g, '')
        .replace(/LTD/g, '')
        .replace(/[^A-Z0-9]/g, '');
      if (k && companyNameIndex[k] === undefined) companyNameIndex[k] = i;
    }
  }
})();

export function getStockMeta(symbolOrNse: string | null | undefined, stockSymbol?: string | null | undefined): StockMeta {
  const cleanNse = symbolOrNse && symbolOrNse !== 'null' && symbolOrNse !== 'undefined' ? symbolOrNse.trim() : '';
  const cleanStock = stockSymbol && stockSymbol !== 'null' && stockSymbol !== 'undefined' ? stockSymbol.trim() : '';

  const symbol = cleanNse || cleanStock;
  if (!symbol) return DEFAULT_META;

  const upper = symbol.toUpperCase().replace(/-EQ$/, '').replace(/\.NS$/, '').replace(/\.BO$/, '');
  const normKey = upper.replace(/[^A-Z0-9]/g, '');

  // ── 1. ETF Sector Map (exact NSE ticker → sector from CSV) ─────────────────
  const etfEntry = (etfSectorMap as Record<string, { name: string; category: string; sector: string; amc: string }>)[upper];
  if (etfEntry) {
    const cat = (etfEntry.category || '').toLowerCase();
    const assetClass: AssetClass = cat.includes('commodity') ? 'Commodity' : cat.includes('debt') ? 'Debt' : 'ETF';
    return {
      sector:        etfEntry.sector || 'Others',
      marketCap:     'Large',
      assetClass,
      industry:      etfEntry.name,
      companyName:   etfEntry.name,
      listingStatus: 'Active',
      statusReason:  'Active ETF trading on exchange',
    };
  }

  // ── 2. Company Master (exact NSE/BSE symbol or normalized Name/Shortname) ──
  let companyIdx = (companyMaster.nse as Record<string, number>)[upper];
  if (companyIdx === undefined) {
    companyIdx = (companyMaster.bse as Record<string, number>)[upper];
  }
  if (companyIdx === undefined && normKey) {
    companyIdx = companyNameIndex[normKey];
  }
  if (companyIdx === undefined && cleanStock) {
    const normStock = cleanStock.toUpperCase().replace(/[^A-Z0-9]/g, '');
    companyIdx = companyNameIndex[normStock];
  }

  if (companyIdx !== undefined) {
    const company = companyMaster.companies[companyIdx] as CompanyTuple;
    // Tuple layout: [name, sector, mcaptype, mcap, industry, isin, bsegroup, shortname, NSEStatus, BSEStatus]
    if (company && company[0]) {
      const sector      = (company[1] as string | null) || 'Others';
      const mcapType    = (company[2] as MarketCap | null) || 'Mid';
      const mcapVal     = (company[3] as number | null) || 0;
      const industryName= (company[4] as string | null) || sector;
      const nseStatus   = ((company[8] as string | null) || '').trim().toLowerCase();
      const bseStatus   = ((company[9] as string | null) || '').trim().toLowerCase();

      let listingStatus: 'Active' | 'Delisted' | 'BSE Only' | 'Suspended' | 'Unlisted' = 'Active';
      let statusReason = 'Actively traded on exchange';

      if (nseStatus === 'active') {
        listingStatus = 'Active';
        statusReason  = 'Actively traded on NSE';
      } else if ((nseStatus === 'not listed' || nseStatus === 'delisted') && bseStatus === 'active') {
        listingStatus = 'BSE Only';
        statusReason  = nseStatus === 'delisted' ? 'Delisted from NSE (traded on BSE)' : 'Not listed on NSE (traded on BSE)';
      } else if (nseStatus === 'delisted' && (bseStatus === 'delisted' || bseStatus === 'not listed' || !bseStatus)) {
        listingStatus = 'Delisted';
        statusReason  = 'Delisted from exchange';
      } else if (nseStatus === 'suspended' || bseStatus === 'suspended') {
        listingStatus = 'Suspended';
        statusReason  = 'Trading temporarily suspended by exchange';
      } else if (nseStatus === 'not listed' && (bseStatus === 'not listed' || !bseStatus)) {
        listingStatus = 'Unlisted';
        statusReason  = 'Unlisted equity shares';
      }

      return {
        sector:        sector || 'Others',
        marketCap:     mcapType,
        assetClass:    'Equity',
        industry:      industryName,
        mcap:          mcapVal,
        companyName:   company[0] as string,
        listingStatus,
        statusReason,
      };
    }
  }

  // ── 3. Nothing found — return default ──────────────────────────────────────
  return DEFAULT_META;
}


export function getAllMeta(symbols: string[]): StockMeta[] {
  return symbols.map(s => getStockMeta(s));
}

export function resolvePriceTicker(
  nseSymbol: string | null | undefined,
  stockSymbol?: string | null | undefined,
  companyName?: string | null | undefined
): string[] {
  const symbol = (nseSymbol || stockSymbol || '')
    .trim()
    .toUpperCase()
    .replace(/-EQ$/, '')
    .replace(/\.NS$/, '')
    .replace(/\.BO$/, '');
  if (!symbol) return [];

  // Default candidates: try NSE first, then BSE symbol directly
  const candidates: string[] = [`${symbol}.NS`, `${symbol}.BO`];

  // 1. Check in companyMaster
  let companyIdx: number | undefined = (companyMaster as CompanyMaster).nse[symbol];
  
  // If not found by exact NSE symbol, search by company name or symbol in companyMaster
  if (companyIdx === undefined && companyName) {
    const cleanName = companyName.toLowerCase().trim();
    companyIdx = (companyMaster as CompanyMaster).companies.findIndex((c: CompanyTuple) => {
      if (!c) return false;
      const c0 = String(c[0] || '').toLowerCase();
      const c7 = String(c[7] || '').toLowerCase();
      return c0.includes(cleanName) || (c7 !== '' && c7.includes(cleanName));
    });
    if (companyIdx === -1) companyIdx = undefined;
  }

  // If still not found, check by shortname/similar symbol (Fuzzy search)
  if (companyIdx === undefined) {
    const symbolLower = symbol.toLowerCase();
    companyIdx = (companyMaster as CompanyMaster).companies.findIndex((c: CompanyTuple) => {
      if (!c) return false;
      const shortName = c[7] ? String(c[7]).toLowerCase().replace(/\s/g, '') : '';
      const compName = c[0] ? String(c[0]).toLowerCase().replace(/\s/g, '') : '';
      return (
        (shortName !== '' && shortName.includes(symbolLower)) || 
        (shortName !== '' && symbolLower.includes(shortName)) || 
        (compName !== '' && compName.includes(symbolLower))
      );
    });
    if (companyIdx === -1) companyIdx = undefined;
  }

  if (companyIdx !== undefined) {
    const company = (companyMaster as CompanyMaster).companies[companyIdx];
    if (company) {
      const nseStatus = String(company[8] || '');
      
      // Find BSE Code for this company index
      let bseCode = '';
      for (const [k, v] of Object.entries((companyMaster as CompanyMaster).bse)) {
        if (v === companyIdx) {
          bseCode = k;
          break;
        }
      }

      if (bseCode) {
        if (nseStatus === 'Not Listed' || nseStatus === 'Delisted' || nseStatus === 'Suspended') {
          // BSE is the active market! Put BSE candidate first!
          candidates.unshift(`${bseCode}.BO`);
        } else {
          // BSE as secondary fallback
          candidates.push(`${bseCode}.BO`);
        }
      }
    }
  }

  // Add BSE code directly if symbol is numeric (BSE code)
  if (/^\d+$/.test(symbol)) {
    candidates.unshift(`${symbol}.BO`);
  }

  // Add specific overrides
  if (symbol === 'NSDL') {
    candidates.unshift('NSDL.BO'); // FIXED: NSDL Yahoo Ticker is NSDL.BO
  }

  // Ensure unique candidates
  return Array.from(new Set(candidates));
}

// ─── Reverse Lookup for NSE Symbols ─────────────────────────────────────────
let reverseNseMap: Record<number, string> | null = null;

function getReverseNseMap() {
  if (!reverseNseMap) {
    reverseNseMap = {};
    const nseDict = companyMaster.nse as Record<string, number>;
    for (const [sym, idx] of Object.entries(nseDict)) {
      reverseNseMap[idx] = sym;
    }
  }
  return reverseNseMap;
}

function normalizeCompanyName(name: string): string {
  return name.toUpperCase()
    .replace(/LIMITED/g, '')
    .replace(/LTD\.?/g, '')
    .replace(/ ENTER\.? L/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Checks if a given string is a perfectly valid exact NSE symbol.
 */
export function isExactNSESymbol(symbol: string): boolean {
  if (!symbol) return false;
  const nseDict = companyMaster.nse as Record<string, number>;
  return nseDict[symbol.trim().toUpperCase()] !== undefined;
}

/**
 * Resolves an ISIN directly to an NSE symbol using companyMaster.json
 */
export function resolveISINToNSE(isin: string): string | null {
  if (!isin) return null;
  const isinDict = companyMaster.isin as Record<string, number>;
  const idx = isinDict[isin.trim().toUpperCase()];
  if (idx !== undefined) {
    const nseMap = getReverseNseMap();
    return nseMap[idx] || null;
  }
  return null;
}

/**
 * Attempts to find the exact NSE symbol by fuzzy matching a full company name
 * against the companyMaster.json database.
 */
export function resolveCompanyNameToNSE(companyName: string): string | null {
  if (!companyName) return null;
  const target = normalizeCompanyName(companyName);
  if (!target) return null;

  for (let i = 0; i < companyMaster.companies.length; i++) {
    const comp = companyMaster.companies[i];
    if (!comp) continue;
    const name = comp[0] as string;
    if (name && normalizeCompanyName(name) === target) {
      const nseMap = getReverseNseMap();
      return nseMap[i] || null;
    }
  }
  return null;
}

/**
 * Formats a stock/ETF ticker symbol for frontend display.
 * - Strips Yahoo Finance suffixes (.NS, .BO).
 * - Maps numeric BSE codes back to user-friendly text symbols using companyMaster or Firestore company_name.
 */
export function cleanSymbol(
  symbolOrObj: string | { nse_symbol?: string | null; stock_symbol?: string | null; company_name?: string | null } | null | undefined
): string {
  if (!symbolOrObj) return '';

  let sym: string;
  let companyName = '';

  if (typeof symbolOrObj === 'object') {
    sym = (symbolOrObj.nse_symbol || symbolOrObj.stock_symbol || '').trim();
    companyName = (symbolOrObj.company_name || '').trim();
  } else {
    sym = symbolOrObj.trim();
  }

  if (!sym) return '';

  // 1. Strip standard exchange suffixes
  const clean = sym.replace(/\.NS$/, '').replace(/\.BO$/, '');

  // 2. If it is numeric (a BSE code), resolve it to a text ticker
  if (/^\d+$/.test(clean)) {
    // If the database has a nice original symbol stored in company_name (e.g. 'TITANSEC'), use it!
    if (companyName && !/^\d+$/.test(companyName)) {
      return companyName.toUpperCase();
    }
    // Otherwise look up in companyMaster by BSE code
    const companyIdx = (companyMaster.bse as Record<string, number>)[clean];
    if (companyIdx !== undefined) {
      const company = companyMaster.companies[companyIdx];
      if (company) {
        const shortName = company[7] as string;
        const compName = company[0] as string;
        // Strip spaces and uppercase
        const targetName = (shortName || compName || '').replace(/\s/g, '').toUpperCase();
        if (targetName && !/^\d+$/.test(targetName)) {
          return targetName;
        }
      }
    }
  }

  return clean;
}

