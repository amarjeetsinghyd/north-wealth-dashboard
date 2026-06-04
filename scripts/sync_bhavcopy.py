"""
sync_bhavcopy.py  –  NSE EOD Price Sync via nsepython → Firebase Firestore
-----------------------------------------------------------------------------
Runs as a GitHub Actions job every weekday at 4:30 PM IST (11:00 UTC).
Also runs on manual trigger from the GitHub Actions UI.

Logic:
  1. Try today's date. If the file isn't published yet, fall back up to 10 days.
  2. Parse the CSV, keep EQ / BE / BZ / SM / ST series (covers equity + ETFs).
  3. Overwrite the price_cache collection in Firestore (set, not merge).
  4. Write a metadata doc price_cache/__sync_meta__ so the UI knows when it last synced.
"""

import os
import sys
import datetime
import json
import math
import firebase_admin
from firebase_admin import credentials, firestore
import nsepython

# ── 1. Authenticate with Firebase ────────────────────────────────────────────
# The service-account JSON is injected via a GitHub Actions secret called
# FIREBASE_SERVICE_ACCOUNT.  It is stored as the full JSON string.
svc_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
if not svc_json:
    print("ERROR: FIREBASE_SERVICE_ACCOUNT env variable not set.")
    sys.exit(1)

svc_dict = json.loads(svc_json)
cred = credentials.Certificate(svc_dict)
firebase_admin.initialize_app(cred)
db = firestore.client()

# ── 2. Date fallback – try today, walk back up to 10 trading days ─────────────
def get_ist_date(delta_days=0):
    """Return a date string in DD-MM-YYYY for IST (UTC+5:30), with optional offset."""
    utcnow = datetime.datetime.utcnow()
    ist = utcnow + datetime.timedelta(hours=5, minutes=30)
    target = ist - datetime.timedelta(days=delta_days)
    return target.strftime("%d-%m-%Y")

def today_ist_str():
    """DDMMYYYY for comparing with the sync-meta document."""
    utcnow = datetime.datetime.utcnow()
    ist = utcnow + datetime.timedelta(hours=5, minutes=30)
    return ist.strftime("%d%m%Y")

df = None
target_date_str = ""

print("Looking for latest NSE Bhavcopy...")
for offset in range(10):
    date_str = get_ist_date(offset)
    print(f"  Trying {date_str} ...", end=" ")
    try:
        result = nsepython.get_bhavcopy(date_str)
        if result is not None and len(result) > 0:
            df = result
            target_date_str = date_str
            print(f"✓  {len(df)} rows")
            break
        else:
            print("empty")
    except Exception as e:
        print(f"not found ({e})")

if df is None:
    print("ERROR: Could not find bhavcopy in last 10 days. Exiting without changes.")
    sys.exit(1)

# ── 3. Parse and write to Firestore ───────────────────────────────────────────
# Allowed series – covers all equity and ETF trading categories on NSE
ALLOWED_SERIES = {"EQ", "BE", "BZ", "SM", "ST"}

print(f"\nProcessing {len(df)} rows from {target_date_str}...")

# Batch writes – Firestore allows max 500 ops per batch
BATCH_SIZE = 400
batch = db.batch()
count = 0
batch_count = 0

price_ref = db.collection("price_cache")

for _, row in df.iterrows():
    try:
        symbol = str(row.get("SYMBOL", "") or "").strip().upper()
        series = str(row.get("SERIES", "") or "").strip().upper()
        close  = float(row.get("CLOSE_PRICE", 0) or 0)
        high   = float(row.get("HIGH_PRICE",  0) or 0)
        low    = float(row.get("LOW_PRICE",   0) or 0)

        if not symbol or close <= 0:
            continue
        # Strip leading spaces from series (NSE CSV has space prefix on columns)
        if series not in ALLOWED_SERIES:
            continue

        # Replace NaN/inf with 0 so Firestore won't reject
        if math.isnan(close) or math.isinf(close):
            continue

        doc_ref = price_ref.document(symbol)
        batch.set(doc_ref, {
            "symbol":      symbol,
            "close":       close,
            "high":        high,
            "low":         low,
            "series":      series,
            "lastUpdated": datetime.datetime.utcnow().isoformat() + "Z",
        })
        count += 1

        if count % BATCH_SIZE == 0:
            batch.commit()
            batch_count += 1
            print(f"  Committed batch {batch_count}  ({count} symbols so far)")
            batch = db.batch()
    except Exception as e:
        print(f"  Warning: skipping row {row.get('SYMBOL', '?')}: {e}")

# Commit remaining
if count % BATCH_SIZE != 0:
    batch.commit()
    batch_count += 1

# ── 4. Write sync metadata ────────────────────────────────────────────────────
meta_ref = price_ref.document("__sync_meta__")
meta_ref.set({
    "lastSyncDate":  today_ist_str(),
    "bhavcopyDate":  target_date_str,
    "recordCount":   count,
    "updatedAt":     datetime.datetime.utcnow().isoformat() + "Z",
})

print(f"\n✅ Done! Synced {count} symbols across {batch_count} Firestore batches.")
print(f"   Bhavcopy date : {target_date_str}")
print(f"   Metadata doc  : price_cache/__sync_meta__")
