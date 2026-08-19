import { ALIAS_MAP, COMPANY_NAME_DIRECT, STRIP_SUFFIX_RE, STRIP_DOT_RE } from './dictionaries';
import { resolveISINToNSE, resolveCompanyNameToNSE, companyMaster, etfMaster } from '../sectorMap';
import { fuzzyScore, normalizeCompany } from './fuzzy';

export const ISIN_RE = /^IN[A-Z0-9]{10}$/i;

// Confidence threshold for auto-resolution
const CONFIDENCE_THRESHOLD = 0.75;
// Max candidates to return for manual review
const MAX_CANDIDATES = 3;

function cleanSymbol(raw: string) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(STRIP_DOT_RE, '')
    .replace(STRIP_SUFFIX_RE, '')
    .trim();
}

function isExactNSESymbol(sym: string) {
  return /^[A-Z][A-Z0-9-]{1,15}$/.test(sym) && !/^(EQUITY|TOTAL|SYMBOL)$/.test(sym);
}

interface ResolveResult {
  symbol: string;
  confidence: number;
  flags: string[];
  candidates: Array<{ symbol: string; companyName: string; score: number; source: 'company_master' | 'etf_master' | 'alias' | 'fuzzy' }>;
}

function findFuzzyCandidates(query: string, limit: number = MAX_CANDIDATES) {
  const candidates: Array<{ symbol: string; companyName: string; score: number; source: 'company_master' | 'etf_master' }> = [];
  const normalizedQuery = normalizeCompany(query);
  
  if (!normalizedQuery) return candidates;

  // Search companyMaster
  for (let i = 0; i < companyMaster.companies.length; i++) {
    const comp = companyMaster.companies[i];
    if (!comp) continue;
    const name = comp[0] as string;
    const nseSymbol = (comp[7] as string) || (comp[1] as string); // short name or symbol
    if (!name || !nseSymbol) continue;
    
    const score = fuzzyScore(normalizedQuery, normalizeCompany(name));
    if (score > 0) {
      candidates.push({ symbol: nseSymbol.toUpperCase(), companyName: name, score, source: 'company_master' });
    }
  }

  // Search etfMaster
  for (let i = 0; i < etfMaster.etfs.length; i++) {
    const etf = etfMaster.etfs[i];
    if (!etf) continue;
    const name = etf[0] as string;
    const nseSymbol = (etf[1] as string) || (etf[2] as string); // symbol or isin
    if (!name || !nseSymbol) continue;
    
    const score = fuzzyScore(normalizedQuery, normalizeCompany(name));
    if (score > 0) {
      candidates.push({ symbol: nseSymbol.toUpperCase(), companyName: name, score, source: 'etf_master' });
    }
  }

  // Sort by score descending and take top N
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function resolveSymbol({ symbol, isin, companyName }: { symbol?: string; isin?: string | null; companyName?: string }): ResolveResult {
  const flags: string[] = [];

  // 1. Existing sectorMap ISIN lookup
  if (isin) {
    const isinResolved = resolveISINToNSE(isin);
    if (isinResolved) return { symbol: isinResolved, confidence: 1.0, flags: ['RESOLVED_BY_ISIN'], candidates: [] };
  }

  const cleaned = cleanSymbol(symbol || companyName || isin || '');
  const rawInput = String(companyName || symbol || '').trim();

  // 2. Exact NSE symbol
  if (cleaned && isExactNSESymbol(cleaned)) {
    return { symbol: cleaned, confidence: 1.0, flags: ['EXACT_SYMBOL'], candidates: [] };
  }

  // 3. Alias map
  if (cleaned && ALIAS_MAP[cleaned]) {
    return { symbol: ALIAS_MAP[cleaned], confidence: 0.9, flags: ['ALIAS_MATCH'], candidates: [] };
  }

  // 4. Direct company-name map
  const upperName = rawInput.toUpperCase();
  if (COMPANY_NAME_DIRECT[upperName]) {
    return { symbol: COMPANY_NAME_DIRECT[upperName], confidence: 0.95, flags: ['COMPANY_DIRECT'], candidates: [] };
  }

  // 5. sectorMap Company Name Match (exact match)
  const resolved = resolveCompanyNameToNSE(companyName || symbol || '');
  if (resolved) {
    return { symbol: resolved, confidence: 0.85, flags: ['COMPANY_MASTER_MATCH'], candidates: [] };
  }

  // 6. Fuzzy matching against Company Master & ETF Master
  const fuzzyCandidates = findFuzzyCandidates(rawInput);
  if (fuzzyCandidates.length > 0) {
    const best = fuzzyCandidates[0];
    if (best && best.score >= CONFIDENCE_THRESHOLD) {
      return { 
        symbol: best.symbol, 
        confidence: best.score, 
        flags: [`FUZZY_${best.source.toUpperCase()}_MATCH`], 
        candidates: fuzzyCandidates.map(c => ({ ...c, source: c.source })) 
      };
    }
    // Below threshold - return unresolved with candidates for manual review
    flags.push('UNRESOLVED_SYMBOL');
    return { 
      symbol: '', // Empty nse_symbol for unresolved
      confidence: best?.score ?? 0.1, 
      flags, 
      candidates: fuzzyCandidates.map(c => ({ ...c, source: c.source })) 
    };
  }

  // 7. No match found at all - could be MF, unlisted, or garbage
  flags.push('UNRESOLVED_SYMBOL');
  flags.push('ASSET_CLASS_OTHER'); // Tag for MF/Other assets
  return { 
    symbol: '', 
    confidence: 0.1, 
    flags, 
    candidates: [] 
  };
}
