import {
  SYMBOL_SYNONYMS, NAME_SYNONYMS, QTY_SYNONYMS, PRICE_SYNONYMS, ISIN_SYNONYMS,
  VALUE_SYNONYMS, LTP_SYNONYMS, CURRVAL_SYNONYMS, PNL_SYNONYMS,
} from './dictionaries';

function normHeader(cell: any) {
  return String(cell ?? '').trim().toLowerCase();
}

function matchHeader(cellVal: string, synonym: string) {
  if (!cellVal) return false;
  if (cellVal === synonym) return true;
  if (cellVal.includes(synonym) && synonym.length >= 3) return true;
  return false;
}

export function scoreHeaderRow(row: any[]) {
  let score = 0, hasSymbol = false, hasQty = false;
  for (const cell of row) {
    const v = normHeader(cell);
    if (!v) continue;
    if (SYMBOL_SYNONYMS.includes(v) || SYMBOL_SYNONYMS.some(s => matchHeader(v, s))) { score += 3; hasSymbol = true; }
    else if (QTY_SYNONYMS.some(s => matchHeader(v, s))) { score += 3; hasQty = true; }
    else if (PRICE_SYNONYMS.some(s => matchHeader(v, s))) { score += 2; }
    else if (ISIN_SYNONYMS.includes(v)) { score += 2; }
    else if (VALUE_SYNONYMS.some(s => matchHeader(v, s))) { score += 1; }
    else if (LTP_SYNONYMS.some(s => matchHeader(v, s))) { score += 1; }
    else if (PNL_SYNONYMS.some(s => matchHeader(v, s))) { score += 1; }
  }
  return { score, hasSymbol, hasQty };
}

export function detectHeaderRow(grid: any[][]) {
  let bestIdx = -1, bestScore = 0;
  const maxScan = Math.min(grid.length, 40);
  for (let i = 0; i < maxScan; i++) {
    const { score, hasSymbol, hasQty } = scoreHeaderRow(grid[i]);
    if (score >= 4 && hasSymbol && hasQty && score > bestScore) {
      bestScore = score; bestIdx = i;
    }
  }
  return bestIdx;
}

export function mapColumns(headerRow: any[]) {
  const cols = headerRow.map(normHeader);
  const claimed = new Set();
  const result: Record<string, number> = {
    isin: -1, symbol: -1, company_name: -1, quantity: -1, buy_price: -1,
    current_price: -1, invested_value: -1, current_value: -1, pnl: -1,
  };

  const roleDefs = [
    { role: 'isin',           test: (v: string) => ISIN_SYNONYMS.includes(v) },
    { role: 'symbol',         test: (v: string) => SYMBOL_SYNONYMS.includes(v) || SYMBOL_SYNONYMS.some(s => matchHeader(v, s)) },
    { role: 'company_name',   test: (v: string) => NAME_SYNONYMS.includes(v) },
    { role: 'quantity',       test: (v: string) => QTY_SYNONYMS.some(s => matchHeader(v, s)) },
    { role: 'buy_price',      test: (v: string) => PRICE_SYNONYMS.some(s => matchHeader(v, s)) },
    { role: 'current_price',  test: (v: string) => LTP_SYNONYMS.some(s => matchHeader(v, s)) },
    { role: 'invested_value', test: (v: string) => VALUE_SYNONYMS.some(s => matchHeader(v, s)) && !LTP_SYNONYMS.some(s => matchHeader(v, s)) },
    { role: 'current_value',  test: (v: string) => CURRVAL_SYNONYMS.some(s => matchHeader(v, s)) },
    { role: 'pnl',            test: (v: string) => PNL_SYNONYMS.some(s => matchHeader(v, s)) },
  ];

  for (const { role, test } of roleDefs) {
    for (let i = 0; i < cols.length; i++) {
      if (claimed.has(i)) continue;
      if (test(cols[i])) { result[role] = i; claimed.add(i); break; }
    }
  }
  return result;
}
