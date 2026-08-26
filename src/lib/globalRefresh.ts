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
  const READ_BATCH_SIZE = 35;
  const priceMap = new Map<string, number>();

  for (let i = 0; i < uniqueSymbols.length; i += READ_BATCH_SIZE) {
    const batch = uniqueSymbols.slice(i, i + READ_BATCH_SIZE);
    const promises = batch.map(async sym => {
      try {
        const snap = await getDoc(doc(db, 'price_cache', sym));
        if (snap.exists()) {
          const data = snap.data();
          const close = Number(data?.close);
          if (close > 0) return { sym, close };
        }
      } catch (e) {
        console.warn(`[GlobalRefresh] Error reading price for ${sym}:`, e);
      }
      return null;
    });

    const results = await Promise.allSettled(promises);
    results.forEach(res => {
      if (res.status === 'fulfilled' && res.value) {
        priceMap.set(res.value.sym, res.value.close);
      }
    });

    log(`Loaded prices (${priceMap.size} found)…`);
  }

  log(`price_cache matched ${priceMap.size}/${uniqueSymbols.length} symbols.`);

  // ── 4. Read sync metadata for "prices as of" date ──────────────────────────
  let priceDate = '';
  try {
    const metaSnap = await getDoc(doc(db, 'price_cache', 'sync_meta'));
    if (metaSnap.exists()) {
      priceDate = metaSnap.data().bhavcopyDate || '';
    } else {
      const altMeta = await getDoc(doc(db, 'price_cache', '_sync_meta'));
      if (altMeta.exists()) priceDate = altMeta.data().bhavcopyDate || '';
    }
  } catch { /* non-fatal */ }

  if (!priceDate) {
    priceDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  // ── 5. Write updated prices using smaller Firestore batched writes ─────────
  // Safe chunk size for browser WebSocket/gRPC is 100 docs per batch
  const WRITE_BATCH_SIZE = 100;
  let updated = 0;

  const holdingsToUpdate = allHoldings.filter(h => {
    const sym = cleanSymbol(h);
    return sym && priceMap.has(sym);
  });

  log(`Updating ${holdingsToUpdate.length} holdings…`);

  for (let i = 0; i < holdingsToUpdate.length; i += WRITE_BATCH_SIZE) {
    const chunk = holdingsToUpdate.slice(i, i + WRITE_BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach(holding => {
      const sym = cleanSymbol(holding)!;
      const price = priceMap.get(sym)!;

      const qty = Number(holding.quantity) || 0;
      const invested = Number(holding.invested_amount) > 0
        ? Number(holding.invested_amount)
        : qty * (Number(holding.buy_price) || 0);

      const current_value      = qty * price;
      const unrealised_pnl     = current_value - invested;
      const unrealised_pnl_pct = invested > 0
        ? (unrealised_pnl / invested) * 100
        : 0;

      batch.update(doc(db, 'holdings', holding.id), {
        current_price:     price,
        current_value,
        unrealised_pnl,
        unrealised_pnl_pct,
        last_price_update: new Date().toISOString(),
      });
    });

    try {
      await batch.commit();
      updated += chunk.length;
      log(`Updated ${updated}/${holdingsToUpdate.length} holdings…`);
    } catch (batchErr) {
      console.error(`[GlobalRefresh] Batch commit error at chunk ${i}:`, batchErr);
    }
  }

  const skipped = total - updated;

  // ── 6. Persist price date to localStorage ──────────────────────────────────
  setPriceDate(priceDate);

  const durationMs = Date.now() - t0;
  log(`✓ Done. Updated ${updated}/${total} holdings in ${(durationMs / 1000).toFixed(1)}s.`);

  return { updated, total, skipped, priceDate, durationMs };
}
