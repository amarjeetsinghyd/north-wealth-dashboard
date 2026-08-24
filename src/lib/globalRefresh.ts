/**
 * globalRefresh.ts
 *
 * A single utility that refreshes CMP prices for EVERY holding
 * across ALL clients in the Firestore database at once.
 *
 * Price source: Firebase `price_cache/{SYMBOL}` collection
 * (populated nightly by the GitHub Actions / Python NSE Bhavcopy sync).
 *
 * Usage:
 *   import { refreshAllPrices } from '../lib/globalRefresh';
 *   const result = await refreshAllPrices(msg => setStatus(msg));
 */

import { collection, getDocs, getDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { cleanSymbol } from './sectorMap';
import type { Holding } from '../types';

export interface GlobalRefreshResult {
  updated: number;
  total: number;
  skipped: number;
  priceDate: string;   // e.g. "21-Aug-2026"
  durationMs: number;
}

const PRICE_DATE_KEY = 'nw_price_as_of';

/** Read the stored "prices as of" date from localStorage (set after last refresh). */
export function getCachedPriceDate(): string {
  try { return localStorage.getItem(PRICE_DATE_KEY) || ''; } catch { return ''; }
}

/** Persist the "prices as of" date to localStorage so all pages can display it. */
function setPriceDate(date: string) {
  try { localStorage.setItem(PRICE_DATE_KEY, date); } catch { /* noop */ }
}

/**
 * Fetch ALL holdings from Firestore across ALL clients.
 * This is intentionally unbounded — we want every holding.
 */
async function fetchAllHoldings(): Promise<Holding[]> {
  const snap = await getDocs(collection(db, 'holdings'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Holding));
}

/**
 * Refresh current prices for every holding in the database.
 *
 * @param onProgress  Optional callback for status messages (for progress UI).
 */
export async function refreshAllPrices(
  onProgress?: (msg: string) => void,
): Promise<GlobalRefreshResult> {
  const t0 = Date.now();
  const log = (msg: string) => { console.log(`[GlobalRefresh] ${msg}`); onProgress?.(msg); };

  // ── 1. Load all holdings ────────────────────────────────────────────────────
  log('Loading all holdings…');
  const allHoldings = await fetchAllHoldings();
  const total = allHoldings.length;
  log(`Found ${total} holdings across all clients.`);

  if (total === 0) {
    return { updated: 0, total: 0, skipped: 0, priceDate: '', durationMs: Date.now() - t0 };
  }

  // ── 2. Collect unique symbols ───────────────────────────────────────────────
  const uniqueSymbols = Array.from(
    new Set(allHoldings.map(h => cleanSymbol(h)).filter(Boolean))
  ) as string[];
  log(`Fetching prices for ${uniqueSymbols.length} unique symbols…`);

  // ── 3. Batch-read price_cache (Firestore getDoc per symbol in parallel) ─────
  // Firestore doesn't support "get multiple docs by ID" in a single RPC via SDK,
  // so we use Promise.all with individual getDoc calls (same as the per-client refresh).
  const BATCH_SIZE = 30;
  const priceMap = new Map<string, number>();

  for (let i = 0; i < uniqueSymbols.length; i += BATCH_SIZE) {
    const batch = uniqueSymbols.slice(i, i + BATCH_SIZE);
    const snaps = await Promise.all(batch.map(sym => getDoc(doc(db, 'price_cache', sym))));
    snaps.forEach((snap, idx) => {
      if (snap.exists()) {
        const data = snap.data();
        const sym = batch[idx]!;
        if (data.close > 0) priceMap.set(sym, data.close);
      }
    });
    log(`Prices loaded: ${Math.min(i + BATCH_SIZE, uniqueSymbols.length)}/${uniqueSymbols.length}`);
  }

  log(`price_cache matched ${priceMap.size}/${uniqueSymbols.length} symbols.`);

  // ── 4. Read sync metadata for "prices as of" date ──────────────────────────
  let priceDate = '';
  try {
    const metaSnap = await getDoc(doc(db, 'price_cache', 'sync_meta'));
    if (metaSnap.exists()) {
      priceDate = metaSnap.data().bhavcopyDate || '';
    }
  } catch { /* non-fatal */ }

  if (!priceDate) {
    // Fallback: today's date in a readable format
    priceDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  // ── 5. Write updated prices using Firestore batched writes ──────────────────
  // Firestore batch limit = 500 operations per batch
  const WRITE_BATCH_SIZE = 400;
  let updated = 0;
  let skipped = 0;

  const holdingsToUpdate = allHoldings.filter(h => {
    const sym = cleanSymbol(h);
    return sym && priceMap.has(sym);
  });

  log(`Updating ${holdingsToUpdate.length} holdings with new prices…`);

  for (let i = 0; i < holdingsToUpdate.length; i += WRITE_BATCH_SIZE) {
    const chunk = holdingsToUpdate.slice(i, i + WRITE_BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach(holding => {
      const sym = cleanSymbol(holding)!;
      const price = priceMap.get(sym)!;
      const current_value       = holding.quantity * price;
      const invested_amount     = holding.quantity * holding.buy_price;
      const unrealised_pnl      = current_value - invested_amount;
      const unrealised_pnl_pct  = invested_amount > 0
        ? (unrealised_pnl / invested_amount) * 100
        : 0;

      batch.update(doc(db, 'holdings', holding.id), {
        current_price:      price,
        current_value,
        invested_amount,
        unrealised_pnl,
        unrealised_pnl_pct,
        last_price_update:  new Date().toISOString(),
      });
    });

    await batch.commit();
    updated += chunk.length;
    log(`Updated ${Math.min(i + WRITE_BATCH_SIZE, holdingsToUpdate.length)}/${holdingsToUpdate.length} holdings…`);
  }

  skipped = total - updated;

  // ── 6. Persist price date to localStorage so all pages can read it ──────────
  setPriceDate(priceDate);

  const durationMs = Date.now() - t0;
  log(`✓ Done. Updated ${updated}/${total} holdings in ${(durationMs / 1000).toFixed(1)}s. Prices as of ${priceDate}.`);

  return { updated, total, skipped, priceDate, durationMs };
}
