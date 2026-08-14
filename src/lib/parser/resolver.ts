import { ALIAS_MAP, COMPANY_NAME_DIRECT, STRIP_SUFFIX_RE, STRIP_DOT_RE } from './dictionaries';
import { resolveISINToNSE, resolveCompanyNameToNSE } from '../sectorMap';

export const ISIN_RE = /^IN[A-Z0-9]{10}$/i;

function cleanSymbol(raw: string) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(STRIP_DOT_RE, '')
    .replace(STRIP_SUFFIX_RE, '')
    .trim();
}

function isExactNSESymbol(sym: string) {
  return /^[A-Z][A-Z0-9\-]{1,15}$/.test(sym) && !/^(EQUITY|TOTAL|SYMBOL)$/.test(sym);
}

export function resolveSymbol({ symbol, isin, companyName }: { symbol?: string; isin?: string | null; companyName?: string }) {
  const flags: string[] = [];

  // 1. Existing sectorMap ISIN lookup
  if (isin) {
    const isinResolved = resolveISINToNSE(isin);
    if (isinResolved) return { symbol: isinResolved, confidence: 1.0, flags: ['RESOLVED_BY_ISIN'], candidates: [] };
  }

  const cleaned = cleanSymbol(symbol || companyName || isin || '');

  // 2. Exact NSE symbol
  if (cleaned && isExactNSESymbol(cleaned)) {
    return { symbol: cleaned, confidence: 1.0, flags: ['EXACT_SYMBOL'], candidates: [] };
  }

  // 3. Alias map
  if (cleaned && ALIAS_MAP[cleaned]) {
    return { symbol: ALIAS_MAP[cleaned], confidence: 0.9, flags: ['ALIAS_MATCH'], candidates: [] };
  }

  // 4. Direct company-name map
  const upperName = String(companyName || symbol || '').trim().toUpperCase();
  if (COMPANY_NAME_DIRECT[upperName]) {
    return { symbol: COMPANY_NAME_DIRECT[upperName], confidence: 0.95, flags: ['COMPANY_DIRECT'], candidates: [] };
  }

  // 5. sectorMap Company Name Match (this is our existing robust company matching)
  const resolved = resolveCompanyNameToNSE(companyName || symbol || '');
  if (resolved) {
     return { symbol: resolved, confidence: 0.85, flags: ['COMPANY_MASTER_MATCH'], candidates: [] };
  }

  flags.push('UNRESOLVED_SYMBOL');
  return { symbol: cleaned || companyName || '', confidence: 0.2, flags, candidates: [] };
}
