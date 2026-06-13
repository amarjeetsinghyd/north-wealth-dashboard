/**
 * syncPrices.mjs  –  NSE Bhavcopy → Firebase Firestore
 * -------------------------------------------------------
 * Run: node scripts/syncPrices.mjs
 *
 * Uses the Firebase CLI OAuth token already stored on this machine.
 * No email, no password, no service account needed.
 */

import { readFileSync, existsSync } from 'fs';
import { homedir }  from 'os';
import { join }     from 'path';

const PROJECT   = 'north-wealth';
const DB_PREFIX = `projects/${PROJECT}/databases/(default)/documents`;

const API_KEY = 'AIzaSyBoxq1i_hEFJBgaIMsAWnrFabAjmDgLaF4';

// ── Firestore REST: batchWrite (no auth — rules are open for price_cache) ─────
function makeDoc(sym, price) {
  return {
    name:   `${DB_PREFIX}/price_cache/${sym}`,
    fields: {
      symbol:      { stringValue:  sym },
      close:       { doubleValue:  price },
      lastUpdated: { stringValue:  new Date().toISOString() },
    },
  };
}

async function firestoreBatchWrite(docs) {
  const url = `https://firestore.googleapis.com/v1/${DB_PREFIX}:batchWrite?key=${API_KEY}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ writes: docs.map(d => ({ update: d })) }),
    signal:  AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Firestore error ${res.status}: ${err.slice(0, 300)}`);
  }
}

// ── Date helper ───────────────────────────────────────────────────────────────
function getISTDate(daysBack) {
  const ist = new Date(Date.now() + 5.5 * 3600000 - daysBack * 86400000);
  const dd  = String(ist.getUTCDate()).padStart(2, '0');
  const mm  = String(ist.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${ist.getUTCFullYear()}`;   // DD-MM-YYYY
}

// ── Download NSE Bhavcopy CSV ─────────────────────────────────────────────────
async function fetchBhavcopy(dateStr) {
  const compact = dateStr.replace(/-/g, '');
  const url = `https://archives.nseindia.com/products/content/sec_bhavdata_full_${compact}.csv`;
  console.log(`  → ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':     'text/csv,*/*',
      'Referer':    'https://www.nseindia.com/',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── Parse CSV → Map<SYMBOL, closePrice> ──────────────────────────────────────
const ALLOWED = new Set(['EQ', 'BE', 'BZ', 'SM', 'ST', 'GS']);
function parseCSV(csv) {
  const lines  = csv.trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim());
  const si = header.indexOf('SYMBOL');
  const ri = header.indexOf('SERIES');
  const ci = header.indexOf('CLOSE_PRICE');
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols   = lines[i].split(',').map(c => c.trim());
    const symbol = cols[si]?.toUpperCase();
    const series = (cols[ri] || '').trim().toUpperCase();
    const close  = parseFloat(cols[ci]);
    if (symbol && ALLOWED.has(series) && close > 0 && !isNaN(close))
      map.set(symbol, close);
  }
  return map;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔑 Reading Firebase CLI credentials...');
  const token = getAccessToken();
  console.log('✓ OAuth token found\n');

  // Find latest available Bhavcopy
  console.log('🔍 Finding latest NSE Bhavcopy...');
  let csv = null, usedDate = '';
  for (let d = 1; d <= 10; d++) {
    const dateStr = getISTDate(d);
    process.stdout.write(`  Trying ${dateStr} ... `);
    try {
      const text = await fetchBhavcopy(dateStr);
      if (text && text.trimStart().startsWith('SYMBOL')) {
        csv = text; usedDate = dateStr;
        console.log('✓ Got data');
        break;
      }
      console.log('✗ Empty');
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
  if (!csv) throw new Error('No Bhavcopy found in last 10 days.');

  const priceMap = parseCSV(csv);
  console.log(`\n📊 Parsed ${priceMap.size} symbols for ${usedDate}`);

  // Build all Firestore docs
  const allDocs = [];
  priceMap.forEach((price, sym) => allDocs.push(makeDoc(sym, price)));

  // Firestore REST batchWrite allows max 20 writes per call
  const BATCH = 20;
  let done = 0;
  console.log(`\n📤 Writing to Firebase (${allDocs.length} symbols in batches of ${BATCH})...`);
  for (let i = 0; i < allDocs.length; i += BATCH) {
    await firestoreBatchWrite(token, allDocs.slice(i, i + BATCH));
    done += Math.min(BATCH, allDocs.length - i);
    if (done % 500 === 0 || done === allDocs.length)
      console.log(`  ✓ ${done}/${allDocs.length} written`);
  }

  // Write metadata doc
  await firestoreBatchWrite(token, [{
    name:   `${DB_PREFIX}/price_cache/__sync_meta__`,
    fields: {
      bhavcopyDate: { stringValue:  usedDate },
      recordCount:  { integerValue: String(priceMap.size) },
      updatedAt:    { stringValue:  new Date().toISOString() },
    }
  }]);

  console.log(`\n✅ Done! ${priceMap.size} prices written to Firebase for ${usedDate}`);
  console.log('   Now click "Refresh Prices" on the website — it will work instantly!\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message || err);
  process.exit(1);
});
