# -*- coding: utf-8 -*-
"""
sync_bhavcopy.py  -  NSE Bhavcopy -> Firebase Firestore via REST API
----------------------------------------------------------------------
Run: python scripts/sync_bhavcopy.py

Uses:
  - nsepython.get_bhavcopy(date)  -> pandas DataFrame
  - Firebase Firestore REST API   -> no firebase-admin / service account needed

Requirements:
  pip install nsepython requests pandas
"""

import sys
import datetime
import requests
import nsepython

# Config
API_KEY    = "AIzaSyBoxq1i_hEFJBgaIMsAWnrFabAjmDgLaF4"
PROJECT    = "north-wealth"
# Firestore REST base (full URL for the API endpoint)
FS_API     = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
# Firestore document name prefix (relative, used inside request body)
FS_DOC_PFX = f"projects/{PROJECT}/databases/(default)/documents"

ALLOWED_SERIES = {"EQ", "BE", "BZ", "SM", "ST", "GS"}

# Date helper: returns DD-MM-YYYY in IST
def get_ist_date(days_back=0):
    now    = datetime.datetime.now(datetime.timezone.utc)
    ist    = now + datetime.timedelta(hours=5, minutes=30)
    target = ist - datetime.timedelta(days=days_back)
    return target.strftime("%d-%m-%Y")

# Download Bhavcopy with fallback for holidays
def download_bhavcopy():
    print("\n[SEARCH] Finding latest NSE Bhavcopy...")
    for offset in range(1, 11):
        date_str = get_ist_date(offset)
        print(f"  Trying {date_str} ...", end=" ", flush=True)
        try:
            df = nsepython.get_bhavcopy(date_str)
            if df is not None and len(df) > 10:
                # Strip whitespace from all column names
                df.columns = [c.strip() for c in df.columns]
                print(f"OK  {len(df)} rows | columns: {list(df.columns[:5])}")
                return df, date_str
            else:
                print("empty")
        except Exception as e:
            print(f"not found ({e})")
    return None, None

# Firestore individual document write via REST PATCH
def write_doc(symbol, close, session):
    url = f"{FS_API}/price_cache/{symbol}?key={API_KEY}"
    body = {
        "fields": {
            "symbol":      {"stringValue":  symbol},
            "close":       {"doubleValue":  float(close)},
            "lastUpdated": {"stringValue":  datetime.datetime.now(datetime.timezone.utc).isoformat()},
        }
    }
    resp = session.patch(url, json=body, timeout=15)
    if resp.status_code not in (200, 204):
        raise RuntimeError(f"{symbol}: {resp.status_code} {resp.text[:200]}")
    return symbol

def write_meta(date_str, count, session):
    url = f"{FS_API}/price_cache/__sync_meta__?key={API_KEY}"
    body = {
        "fields": {
            "bhavcopyDate": {"stringValue":  date_str},
            "recordCount":  {"integerValue": str(count)},
            "updatedAt":    {"stringValue":  datetime.datetime.now(datetime.timezone.utc).isoformat()},
        }
    }
    session.patch(url, json=body, timeout=15)

def main():
    df, date_str = download_bhavcopy()
    if df is None:
        print("\n[ERROR] No bhavcopy found in last 10 days. Exiting.")
        sys.exit(1)

    print("\n[DATA] Filtering symbols...")

    # Show actual column names for debugging
    print(f"  Columns: {list(df.columns)}")

    docs    = []
    skipped = 0
    for _, row in df.iterrows():
        try:
            symbol = str(row["SYMBOL"]).strip().upper()
            series = str(row["SERIES"]).strip().upper()
            close  = float(row["CLOSE_PRICE"])
            if not symbol or series not in ALLOWED_SERIES or close <= 0:
                skipped += 1
                continue
            docs.append((symbol, close))
        except Exception as e:
            skipped += 1

    print(f"  Valid  : {len(docs)}")
    print(f"  Skipped: {skipped}\n")

    if len(docs) == 0:
        print("[ERROR] No valid symbols found. Check column names above.")
        sys.exit(1)

    # Write to Firestore in parallel (20 threads for speed)
    from concurrent.futures import ThreadPoolExecutor, as_completed
    print(f"[WRITE] Writing {len(docs)} prices to Firebase (20 parallel threads)...")

    session  = requests.Session()
    errors   = []
    done     = 0

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {
            executor.submit(write_doc, sym, price, session): sym
            for sym, price in docs
        }
        for future in as_completed(futures):
            try:
                future.result()
                done += 1
                if done % 500 == 0 or done == len(docs):
                    print(f"  Written {done}/{len(docs)}")
            except Exception as e:
                errors.append(str(e))

    if errors:
        print(f"  Errors ({len(errors)}): {errors[:3]}")

    write_meta(date_str, done, session)
    session.close()

    print(f"\n[DONE] {done} prices written for {date_str}")
    print("Now click 'Refresh Prices' on the website!\n")

if __name__ == "__main__":
    main()
