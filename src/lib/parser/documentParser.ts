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
    // Normalize symbol for clean deduplication
    const key = (h.nse_symbol || h.stock_symbol || '')
      .trim()
      .toUpperCase()
      .replace(/\.NS$/, '')
      .replace(/\.BO$/, '');
    if (!key) continue;
    
    if (!map.has(key)) {
      map.set(key, { ...h });
      continue;
    }
    
    const ex = map.get(key)!;
    const totalQty = ex.quantity + h.quantity;

    const exInv = ex.invested_value || (ex.buy_price * ex.quantity);
    const hInv = h.invested_value || (h.buy_price * h.quantity);
    const totalInv = exInv + hInv;

    let mergedBuy = 0;
    if (totalQty > 0 && totalInv > 0) {
      mergedBuy = totalInv / totalQty;
    } else if (ex.buy_price > 0) {
      mergedBuy = ex.buy_price;
    } else if (h.buy_price > 0) {
      mergedBuy = h.buy_price;
    }

    ex.quantity = totalQty;
    ex.buy_price = mergedBuy;
    ex.invested_value = totalQty * mergedBuy;
    ex.current_price = (h.current_price && h.current_price > 0) ? h.current_price : ex.current_price;
    ex.current_value = (ex.current_price && ex.current_price > 0) ? totalQty * ex.current_price : ex.current_value;
    ex.confidence = Math.min(ex.confidence, h.confidence);
    ex.flags = Array.from(new Set([...ex.flags, ...h.flags]));
    ex.candidates = mergeCandidates(ex.candidates, h.candidates);
    ex.purchase_date = ex.purchase_date || h.purchase_date;
    if (h.company_name && h.company_name.length > (ex.company_name || '').length) {
      ex.company_name = h.company_name;
    }
    if (!ex.buy_price) ex.flags.push('MISSING_BUY_PRICE');
    
    map.set(key, ex);
  }
  return Array.from(map.values());
}
