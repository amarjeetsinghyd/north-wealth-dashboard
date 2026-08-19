import { TOTAL_KEYWORDS, SECTION_KEYWORDS } from './dictionaries';
import { parseNumber, isValidQty, isValidPrice } from '../numberUtils';
import { resolveSymbol, ISIN_RE } from './resolver';
import type { ExtractedHolding } from '../../types';

function cellText(row: unknown[], idx: number | undefined): string {
  if (idx === undefined || idx < 0 || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}

function isTotalRow(row: unknown[]): boolean {
  const joined = row.map(c => String(c ?? '')).join(' ').toLowerCase();
  return TOTAL_KEYWORDS.some(k => joined.includes(k));
}

function isSectionHeader(row: unknown[], colMap: Record<string, number | undefined>): boolean {
  const joined = row.map(c => String(c ?? '')).join(' ').toLowerCase();
  const hasSectionWord = SECTION_KEYWORDS.some(k => joined.includes(k));
  const qtyVal = parseNumber(cellText(row, colMap.quantity));
  return hasSectionWord && !isValidQty(qtyVal);
}

export function processRow(row: unknown[], colMap: Record<string, number | undefined>): ExtractedHolding | null {
  if (!row || row.length === 0) return null;
  if (isTotalRow(row)) return null;
  if (isSectionHeader(row, colMap)) return null;

  const rawSymbol = cellText(row, colMap.symbol);
  const rawIsinCell = cellText(row, colMap.isin);
  const rawCompany = cellText(row, colMap.company_name);

  let isin = ISIN_RE.test(rawIsinCell) ? rawIsinCell.toUpperCase() : null;
  if (!isin && ISIN_RE.test(rawSymbol)) isin = rawSymbol.toUpperCase();

  const identifier = rawSymbol || rawCompany || isin;
  if (!identifier) return null;

  const quantity = parseNumber(cellText(row, colMap.quantity));
  if (!isValidQty(quantity) || quantity === null) return null;

  let buy_price = parseNumber(cellText(row, colMap.buy_price));
  let current_price = parseNumber(cellText(row, colMap.current_price));
  let invested_value = parseNumber(cellText(row, colMap.invested_value));
  let current_value = parseNumber(cellText(row, colMap.current_value));

  if (!isValidPrice(buy_price) && invested_value !== null && quantity !== null) {
    buy_price = invested_value / quantity;
  }
  if (!isValidPrice(current_price) && current_value !== null && quantity !== null) {
    current_price = current_value / quantity;
  }
  if (invested_value === null && isValidPrice(buy_price) && quantity !== null) {
    invested_value = (buy_price || 0) * quantity;
  }
  if (current_value === null && isValidPrice(current_price) && quantity !== null) {
    current_value = (current_price || 0) * quantity;
  }

  const resolved = resolveSymbol({ symbol: rawSymbol, isin, companyName: rawCompany || rawSymbol });

  const flags = [...resolved.flags];
  const missingBuyPrice = !isValidPrice(buy_price);
  if (missingBuyPrice) flags.push('MISSING_BUY_PRICE');

  const finalBuyPrice = isValidPrice(buy_price) ? (buy_price ?? 0) : 0;
  const finalCurrentPrice = isValidPrice(current_price) ? (current_price ?? 0) : 0;

  const rawDate = cellText(row, colMap.purchase_date);
  let purchaseDate: string | undefined = undefined;
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2100) {
      purchaseDate = d.toISOString().split('T')[0];
    } else {
      const parts = rawDate.split(/[-/.]/);
      if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
        if (parts[2].length === 4) {
          const d2 = new Date(`${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`);
          if (!isNaN(d2.getTime())) purchaseDate = d2.toISOString().split('T')[0];
        }
      }
    }
  }

  return {
    stock_symbol: (resolved.symbol || rawSymbol || '').toUpperCase().trim(),
    nse_symbol: (resolved.symbol || '').toUpperCase().trim(),
    company_name: rawCompany || rawSymbol,
    raw_isin: isin || null,
    quantity,
    buy_price: finalBuyPrice,
    current_price: finalCurrentPrice,
    invested_value: invested_value ?? 0,
    current_value: current_value ?? 0,
    confidence: resolved.confidence,
    flags,
    candidates: resolved.candidates,
    purchase_date: purchaseDate,
  };
}
