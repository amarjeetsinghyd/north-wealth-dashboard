import {
  SYMBOL_SYNONYMS, NAME_SYNONYMS, QTY_SYNONYMS, PRICE_SYNONYMS, ISIN_SYNONYMS,
  VALUE_SYNONYMS, LTP_SYNONYMS, CURRVAL_SYNONYMS, PNL_SYNONYMS,
} from './dictionaries';
import { fuzzyScore } from './fuzzy';

function normHeader(cell: unknown): string {
  return String(cell ?? '').trim().toLowerCase();
}

function matchHeader(cellVal: string | undefined, synonym: string): boolean {
  if (!cellVal) return false;
  if (cellVal === synonym) return true;
  if (cellVal.includes(synonym) && synonym.length >= 3) return true;
  // Fuzzy match for better header detection
  if (fuzzyScore(cellVal, synonym) > 0.7) return true;
  return false;
}

export function scoreHeaderRow(row: unknown[]) {
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

export function detectHeaderRow(grid: unknown[][]): number {
  let bestIdx = -1, bestScore = 0;
  const maxScan = Math.min(grid.length, 40);
  for (let i = 0; i < maxScan; i++) {
    const row = grid[i];
    if (!row) continue;
    const { score, hasSymbol, hasQty } = scoreHeaderRow(row);
    if (score >= 4 && hasSymbol && hasQty && score > bestScore) {
      bestScore = score; bestIdx = i;
    }
  }
  return bestIdx;
}

function mergeHeaderRows(row1: unknown[], row2: unknown[]): string[] {
  // Merge two header rows (e.g., main header + units row)
  return row1.map((cell, i) => {
    const v1 = normHeader(cell);
    const v2 = normHeader(row2[i]);
    if (!v1) return v2;
    if (!v2) return v1;
    // If row2 looks like units (contains parentheses, %, etc.), append it
    if (/[()%]/.test(v2)) return `${v1} ${v2}`;
    return v1;
  });
}

export function mapColumns(headerRow: unknown[], nextRow?: unknown[]) {
  // If nextRow looks like a units/sub-header row, merge them
  let cols: string[];
  if (nextRow && nextRow.length === headerRow.length) {
    const merged = mergeHeaderRows(headerRow, nextRow);
    cols = merged;
  } else {
    cols = headerRow.map(normHeader);
  }
  
  const claimed = new Set<number>();
  const result: Record<string, number | undefined> = {
    isin: undefined, symbol: undefined, company_name: undefined, quantity: undefined, buy_price: undefined,
    current_price: undefined, invested_value: undefined, current_value: undefined, pnl: undefined,
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
      const col = cols[i];
      if (col && test(col)) { result[role] = i; claimed.add(i); break; }
    }
  }
  return result;
}
