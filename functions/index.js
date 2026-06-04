const { onRequest, onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require('firebase-admin');
const Papa = require('papaparse');

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

exports.proxyFinance = onRequest(
  { cors: true, maxInstances: 10 },
  async (req, res) => {
    try {
      const targetUrl = req.query.url;
      if (!targetUrl || !targetUrl.startsWith('https://query1.finance.yahoo.com/')) {
        return res.status(400).send("Invalid target URL. Only Yahoo Finance is allowed.");
      }
      
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const data = await response.text();
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Content-Type', response.headers.get('content-type') || 'application/json');
      res.status(response.status).send(data);
    } catch (error) {
      logger.error("Proxy error:", error);
      res.status(500).send({ error: "Proxy fetch failed" });
    }
  }
);

exports.syncBhavcopy = onCall(
  { cors: true, maxInstances: 2, timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    try {
      // 1. Check if already synced today
      const metaRef = db.collection('price_cache').doc('__sync_meta__');
      const snap = await metaRef.get();
      
      // Date formatting helper (IST)
      const getISTDateStr = (dateObj) => {
        const istDate = new Date(dateObj.getTime() + (5.5 * 60 * 60 * 1000));
        const dd = String(istDate.getUTCDate()).padStart(2, '0');
        const mm = String(istDate.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = istDate.getUTCFullYear();
        return `${dd}${mm}${yyyy}`;
      };

      const now = new Date();
      const todayStr = getISTDateStr(now);

      // We allow a force flag for testing, otherwise skip if already done
      if (!request.data?.force && snap.exists && snap.data().lastSyncDate === todayStr) {
        logger.info(`Already synced today: ${todayStr}`);
        return { success: true, message: 'Already synced today', date: todayStr };
      }

      // 2. Date fallback loop to find latest NSE Bhavcopy
      let foundCsv = null;
      let targetDateStr = '';
      let attemptDate = new Date(now.getTime());

      // Loop back up to 10 days to find a valid trading day (handles long weekends/holidays)
      for (let i = 0; i < 10; i++) {
        targetDateStr = getISTDateStr(attemptDate);
        const url = `https://archives.nseindia.com/products/content/sec_bhavdata_full_${targetDateStr}.csv`;
        logger.info(`Trying to fetch bhavcopy for: ${targetDateStr}`);
        
        try {
          const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(10000)
          });

          if (response.status === 200) {
            foundCsv = await response.text();
            break;
          }
        } catch(e) {
          logger.info(`Fetch failed for ${targetDateStr}: ${e.message}`);
        }
        
        // Subtract 1 day
        attemptDate.setDate(attemptDate.getDate() - 1);
      }

      if (!foundCsv) {
        throw new Error('Could not find bhavcopy in the last 10 days.');
      }

      // 3. Parse CSV
      const parsed = Papa.parse(foundCsv, { header: true, skipEmptyLines: true });
      const records = parsed.data;
      
      let count = 0;
      const batches = [];
      let currentBatch = db.batch();

      for (const row of records) {
        // Strip out whitespace from NSE headers and data
        const getField = (key) => row[key] ? row[key].trim() : (row[` ${key}`] ? row[` ${key}`].trim() : '');
        
        const symbol = getField('SYMBOL').toUpperCase();
        const series = getField('SERIES');
        const close = parseFloat(getField('CLOSE_PRICE')) || 0;
        const high = parseFloat(getField('HIGH_PRICE')) || 0;
        const low = parseFloat(getField('LOW_PRICE')) || 0;

        if (!symbol || close <= 0) continue;
        
        // Include common Equity and ETF series (EQ, BE, BZ, SM, ST, GS - Govt Sec)
        if (['EQ', 'BE', 'BZ', 'SM', 'ST'].includes(series) || series.length >= 2) {
          const docRef = db.collection('price_cache').doc(symbol);
          currentBatch.set(docRef, { close, high, low, symbol, lastUpdated: new Date().toISOString() });
          count++;

          if (count % 400 === 0) {
            batches.push(currentBatch);
            currentBatch = db.batch();
          }
        }
      }
      
      if (count % 400 !== 0) {
        batches.push(currentBatch);
      }

      // 4. Write to Firestore in batches
      logger.info(`Committing ${batches.length} batches for ${count} symbols.`);
      for (const batch of batches) {
        await batch.commit();
      }

      // 5. Mark today as synced
      await metaRef.set({
        lastSyncDate: todayStr,
        bhavcopyDate: targetDateStr,
        recordCount: count,
        updatedAt: new Date().toISOString()
      });

      logger.info(`Successfully synced ${count} symbols for date ${targetDateStr}`);
      return { success: true, message: `Synced ${count} symbols for date ${targetDateStr}` };
      
    } catch (error) {
      logger.error("Sync error:", error);
      throw new Error(error.message || "Bhavcopy sync failed");
    }
  }
);
