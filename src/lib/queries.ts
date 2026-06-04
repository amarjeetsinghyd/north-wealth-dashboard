/**
 * queries.ts — Firestore data-access layer (drop-in replacement for Supabase queries)
 *
 * Collections:
 *   clients      — { id, name, onboarding_date, created_at }
 *   holdings     — { id, client_id, stock_symbol, nse_symbol, company_name,
 *                    buy_price, quantity, current_price, current_value,
 *                    invested_amount, unrealised_pnl, unrealised_pnl_pct,
 *                    realised_pnl, rebalancing_date, last_price_update, created_at }
 *   transactions — { id, client_id, date, action, stock_symbol, company_name,
 *                    quantity, price, total_value, created_at }
 */

import {
  collection, doc, getDocs, getDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy,
  Timestamp, setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Client, Holding, Transaction } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a Firestore doc snapshot to a typed object with `id`. */
function fromDoc<T>(snap: any): T {
  const data = snap.data();
  // Convert Timestamps → ISO strings for compatibility with existing UI
  const converted: any = { id: snap.id };
  for (const [key, val] of Object.entries(data)) {
    if (val instanceof Timestamp) {
      converted[key] = val.toDate().toISOString();
    } else {
      converted[key] = val;
    }
  }
  return converted as T;
}

const isoNow = () => new Date().toISOString();

// ─── Clients ─────────────────────────────────────────────────────────────────

export async function fetchClients(): Promise<Client[]> {
  const q = query(collection(db, 'clients'), orderBy('created_at', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => fromDoc<Client>(d));
}

export async function fetchClient(id: string): Promise<Client | null> {
  const snap = await getDoc(doc(db, 'clients', id));
  if (!snap.exists()) return null;
  return fromDoc<Client>(snap);
}

export async function createClient(name: string, onboarding_date: string): Promise<Client> {
  const payload = { name, onboarding_date, created_at: isoNow() };
  const ref = await addDoc(collection(db, 'clients'), payload);
  return { id: ref.id, ...payload };
}

export async function deleteClient(id: string): Promise<void> {
  // Delete client doc
  await deleteDoc(doc(db, 'clients', id));

  // Cascade-delete holdings
  const hSnap = await getDocs(query(collection(db, 'holdings'), where('client_id', '==', id)));
  await Promise.all(hSnap.docs.map(d => deleteDoc(d.ref)));

  // Cascade-delete transactions
  const tSnap = await getDocs(query(collection(db, 'transactions'), where('client_id', '==', id)));
  await Promise.all(tSnap.docs.map(d => deleteDoc(d.ref)));
}

// ─── Holdings ─────────────────────────────────────────────────────────────────

export async function fetchHoldings(clientId: string): Promise<Holding[]> {
  const q = query(
    collection(db, 'holdings'),
    where('client_id', '==', clientId)
  );
  const snap = await getDocs(q);
  const holdings = snap.docs.map(d => fromDoc<Holding>(d));
  return holdings.sort((a, b) => (a.stock_symbol || '').localeCompare(b.stock_symbol || ''));
}

export async function upsertHoldings(
  holdings: Omit<Holding, 'id' | 'created_at'>[],
): Promise<void> {
  await Promise.all(
    holdings.map(h => addDoc(collection(db, 'holdings'), { ...h, created_at: isoNow() })),
  );
}

export async function updateHoldingPrice(id: string, current_price: number): Promise<void> {
  const snap = await getDoc(doc(db, 'holdings', id));
  if (!snap.exists()) throw new Error('Holding not found');
  const h = snap.data() as Holding;

  const current_value     = h.quantity * current_price;
  const invested_amount   = h.quantity * h.buy_price;
  const unrealised_pnl    = current_value - invested_amount;
  const unrealised_pnl_pct =
    invested_amount !== 0 ? (unrealised_pnl / invested_amount) * 100 : 0;

  await updateDoc(doc(db, 'holdings', id), {
    current_price,
    current_value,
    invested_amount,
    unrealised_pnl,
    unrealised_pnl_pct,
    last_price_update: isoNow(),
  });
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function fetchTransactions(clientId: string): Promise<Transaction[]> {
  const q = query(
    collection(db, 'transactions'),
    where('client_id', '==', clientId)
  );
  const snap = await getDocs(q);
  const transactions = snap.docs.map(d => fromDoc<Transaction>(d));
  return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function insertTransaction(
  tx: Omit<Transaction, 'id' | 'created_at'>,
): Promise<void> {
  await addDoc(collection(db, 'transactions'), { ...tx, created_at: isoNow() });
}

// ─── Market Data Cache ───────────────────────────────────────────────────────

export async function fetchMarketDataCache(): Promise<any[]> {
  try {
    const snap = await getDocs(collection(db, 'market_data'));
    return snap.docs.map(d => ({ symbol: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Failed to fetch market data cache from Firestore', err);
    return [];
  }
}

export async function saveMarketDataCache(symbol: string, data: any): Promise<void> {
  try {
    const docRef = doc(db, 'market_data', symbol);
    await setDoc(docRef, {
      ...data,
      last_updated: isoNow()
    }, { merge: true });
  } catch (err) {
    console.warn(`Failed to save market data cache to Firestore for ${symbol}`, err);
  }
}

export async function saveBenchmarkCache(benchmarkData: any[]): Promise<void> {
  try {
    const docRef = doc(db, 'market_data', 'benchmark_^CRSLDX');
    await setDoc(docRef, {
      symbol: '^CRSLDX',
      returns: benchmarkData,
      last_updated: isoNow()
    }, { merge: true });
  } catch (err) {
    console.warn('Failed to save benchmark cache to Firestore', err);
  }
}
