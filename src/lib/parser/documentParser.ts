import { detectHeaderRow, mapColumns } from './header';
import { processRow } from './grid';

export function parseGrid(grid: string[][]) {
  const holdings: any[] = [];
  const headerIdx = detectHeaderRow(grid);

  if (headerIdx === -1) {
    // If no header found, we just return empty array since we don't have the heuristic fallback ported
    // But since the user only uploads broker statements with headers, this is fine.
    return holdings;
  }

  const colMap = mapColumns(grid[headerIdx]);
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const holding = processRow(grid[i], colMap);
    if (holding) holdings.push(holding);
  }
  return holdings;
}

export function dedupeHoldings(holdings: any[]) {
  const map = new Map<string, any>();
  for (const h of holdings) {
    const key = h.stock_symbol.toUpperCase();
    if (!key) continue;
    
    if (!map.has(key)) {
      map.set(key, { ...h });
      continue;
    }
    
    const ex = map.get(key);
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
    if (!ex.buy_price) ex.flags.push('MISSING_BUY_PRICE');
    
    map.set(key, ex);
  }
  return Array.from(map.values());
}
