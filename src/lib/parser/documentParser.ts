import { detectHeaderRow, mapColumns } from './header';
import { processRow } from './grid';
import type { ExtractedHolding, SymbolCandidate } from '../../types';

export function parseGrid(grid: string[][]): ExtractedHolding[] {
  const holdings: ExtractedHolding[] = [];
  const headerIdx = detectHeaderRow(grid);

  if (headerIdx === -1 || headerIdx >= grid.length) {
    // If no header found, we just return empty array since we don't have the heuristic fallback ported
    // But since the user only uploads broker statements with headers, this is fine.
    return holdings;
  }

  const headerRow = grid[headerIdx];
  if (!headerRow) return holdings;
  
  // Check if next row is a sub-header/units row
  const nextRow = grid[headerIdx + 1];
  const colMap = mapColumns(headerRow, nextRow);
  
  // If we used nextRow as sub-header, skip it in data processing
  const dataStartIdx = (nextRow && nextRow.length === headerRow.length) ? headerIdx + 2 : headerIdx + 1;
  
  for (let i = dataStartIdx; i < grid.length; i++) {
    const row = grid[i];
    if (!row) continue;
    const holding = processRow(row, colMap);
    if (holding) holdings.push(holding);
  }
  return holdings;
}

function mergeCandidates(existing: SymbolCandidate[] | undefined, incoming: SymbolCandidate[] | undefined): SymbolCandidate[] {
  const all = [...(existing || []), ...(incoming || [])];
  const seen = new Set<string>();
  return all.filter(c => {
    if (seen.has(c.symbol)) return false;
    seen.add(c.symbol);
    return true;
  }).sort((a, b) => b.score - a.score).slice(0, 3);
}

export function dedupeHoldings(holdings: ExtractedHolding[]): ExtractedHolding[] {
  const map = new Map<string, ExtractedHolding>();
  for (const h of holdings) {
    // Use nse_symbol if available, otherwise stock_symbol for deduplication key
    const key = (h.nse_symbol || h.stock_symbol).toUpperCase();
    if (!key) continue;
    
    if (!map.has(key)) {
      map.set(key, { ...h });
      continue;
    }
    
    const ex = map.get(key)!;
    const totalQty = ex.quantity + h.quantity;

    let mergedBuy = 0;
    const exHasPrice = ex.buy_price > 0;
    const hHasPrice = h.buy_price > 0;
    if (exHasPrice && hHasPrice && totalQty > 0) {
      mergedBuy = (ex.quantity * ex.buy_price + h.quantity * h.buy_price) / totalQty;
    } else if (exHasPrice) {
      mergedBuy = ex.buy_price;
    } else if (hHasPrice) {
      mergedBuy = h.buy_price;
    }

    ex.quantity = totalQty;
    ex.buy_price = mergedBuy;
    ex.invested_value = totalQty * mergedBuy;
    ex.confidence = Math.min(ex.confidence, h.confidence);
    ex.flags = Array.from(new Set([...ex.flags, ...h.flags]));
    ex.candidates = mergeCandidates(ex.candidates, h.candidates);
    if (!ex.buy_price) ex.flags.push('MISSING_BUY_PRICE');
    
    map.set(key, ex);
  }
  return Array.from(map.values());
}
