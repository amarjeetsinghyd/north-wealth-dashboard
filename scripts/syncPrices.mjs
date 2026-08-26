/**
 * syncPrices.mjs  –  NSE Bhavcopy → Firebase Firestore
 * -------------------------------------------------------
 * Run: node scripts/syncPrices.mjs
 *
 * Uses firebase-admin with serviceAccountKey.json for authentication.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, WriteBatch } from 'firebase-admin/firestore';

// Load Bhavcopy → companyMaster symbol mapping
const MAPPING_FILE = join(process.cwd(), 'bhavcopy_to_master_mapping.json');
const bhavcopyToMaster = JSON.parse(readFileSync(MAPPING_FILE, 'utf-8'));

// Initialize Firebase Admin SDK
function initFirebaseAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }
  
  const serviceAccountPath = join(process.cwd(), 'serviceAccountKey.json');
  if (!existsSync(serviceAccountPath)) {
    throw new Error('serviceAccountKey.json not found in project root');
  }
  
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
  
  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

// Get Firestore instance
const app = initFirebaseAdmin();
const db = getFirestore(app);

// ── Firestore Admin SDK: batchWrite ──────────────────────────────────────────
function makeDoc(sym, price) {
  // Use companyMaster key as document ID so frontend cleanSymbol() lookups work
  const masterKey = bhavcopyToMaster[sym] || sym;
  return {
    ref: db.collection('price_cache').doc(masterKey),
    data: {
      symbol: masterKey,
      close: price,
      lastUpdated: new Date().toISOString(),
    },
  };
}

async function firestoreBatchWrite(docs) {
  const batch = db.batch();
  for (const { ref, data } of docs) {
    batch.set(ref, data, { merge: true });
  }
  await batch.commit();
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
  console.log('\n🔑 Initializing Firebase Admin SDK...');
  console.log('✓ Firebase Admin initialized\n');

  // Find latest available Bhavcopy
  console.log('🔍 Finding latest NSE Bhavcopy...');
  let csv = null, usedDate = '';
  for (let d = 0; d <= 10; d++) {
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

  // Firestore Admin SDK batchWrite allows max 500 writes per batch
  const BATCH = 500;
  let done = 0;
  console.log(`\n📤 Writing to Firebase (${allDocs.length} symbols in batches of ${BATCH})...`);
  for (let i = 0; i < allDocs.length; i += BATCH) {
    await firestoreBatchWrite(allDocs.slice(i, i + BATCH));
    done += Math.min(BATCH, allDocs.length - i);
    if (done % 500 === 0 || done === allDocs.length)
      console.log(`  ✓ ${done}/${allDocs.length} written`);
  }

  // Write metadata doc (both sync_meta and _sync_meta for full compatibility)
  await firestoreBatchWrite([
    {
      ref: db.collection('price_cache').doc('sync_meta'),
      data: {
        bhavcopyDate: usedDate,
        recordCount: priceMap.size,
        updatedAt: new Date().toISOString(),
      }
    },
    {
      ref: db.collection('price_cache').doc('_sync_meta'),
      data: {
        bhavcopyDate: usedDate,
        recordCount: priceMap.size,
        updatedAt: new Date().toISOString(),
      }
    }
  ]);

  console.log(`\n✅ Done! ${priceMap.size} prices written to Firebase for ${usedDate}`);
  console.log('   Now click "Refresh Prices" on the website — it will work instantly!\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message || err);
  process.exit(1);
});
