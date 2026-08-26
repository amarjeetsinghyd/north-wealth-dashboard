# -*- coding: utf-8 -*-
"""
sync_bhavcopy.py  -  NSE Bhavcopy -> Firebase Firestore
----------------------------------------------------------------------
Run: python scripts/sync_bhavcopy.py

Uses:
  - Direct NSE Bhavcopy CSV download with proper headers
  - Firebase Admin SDK with Service Account (from FIREBASE_SERVICE_ACCOUNT env var)
  - bhavcopy_to_master_mapping.json for symbol normalization (matches syncPrices.mjs)

Requirements:
  pip install nsepythonserver firebase-admin pandas requests
"""

import sys
import os
import datetime
import requests
import json
import math
import pandas as pd
import numpy as np
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import StringIO

# Initialize Firebase Admin SDK
def init_firebase():
    """Initialize Firebase Admin SDK from service account JSON in env var."""
    import firebase_admin
    from firebase_admin import credentials, firestore
    
    if firebase_admin._apps:
        return firestore.client()
    
    service_account_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
    if not service_account_json:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT environment variable not set")
    
    try:
        service_account = json.loads(service_account_json)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Invalid FIREBASE_SERVICE_ACCOUNT JSON: {e}")
    
    cred = credentials.Certificate(service_account)
    firebase_admin.initialize_app(cred, {
        'projectId': service_account.get('project_id', 'north-wealth')
    })
    return firestore.client()

# Initialize Firestore client
db = init_firebase()

# Load bhavcopy to master symbol mapping (same as syncPrices.mjs)
MAPPING_FILE = os.path.join(os.path.dirname(__file__), '..', 'bhavcopy_to_master_mapping.json')
with open(MAPPING_FILE, 'r') as f:
    BHAVCOPY_TO_MASTER = json.load(f)

# Config
PROJECT = "north-wealth"
ALLOWED_SERIES = {"EQ", "BE", "BZ", "SM", "ST", "GS"}

# NSE Headers to prevent 403 blocks in GitHub Actions
NSE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/csv,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    'Referer': 'https://www.nseindia.com/',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
}

# Date helper: returns DD-MM-YYYY in IST
def get_ist_date(days_back=0):
    now    = datetime.datetime.now(datetime.timezone.utc)
    ist    = now + datetime.timedelta(hours=5, minutes=30)
    target = ist - datetime.timedelta(days=days_back)
    return target.strftime("%d-%m-%Y")

# Map NSE symbol to master key (same logic as syncPrices.mjs)
def get_master_key(nse_symbol: str) -> str:
    """Convert NSE symbol to master key using bhavcopy_to_master_mapping.json"""
    return BHAVCOPY_TO_MASTER.get(nse_symbol, nse_symbol)

# Download Bhavcopy with fallback for holidays - using direct HTTP with proper headers
def download_bhavcopy():
    print("\n[SEARCH] Finding latest NSE Bhavcopy...")
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    
    # First, visit NSE homepage to get cookies
    try:
        session.get('https://www.nseindia.com/', timeout=10)
    except Exception as e:
        print(f"  [WARN] Failed to get NSE cookies: {e}")
    
    for offset in range(0, 11):
        date_str = get_ist_date(offset)
        compact = date_str.replace('-', '')
        url = f"https://archives.nseindia.com/products/content/sec_bhavdata_full_{compact}.csv"
        print(f"  Trying {date_str} ...", end=" ", flush=True)
        try:
            resp = session.get(url, timeout=30)
            if resp.status_code == 200 and resp.text.strip().startswith('SYMBOL'):
                # Parse CSV
                df = pd.read_csv(StringIO(resp.text))
                # Strip whitespace from all column names
                df.columns = [c.strip() for c in df.columns]
                print(f"OK  {len(df)} rows | columns: {list(df.columns[:5])}")
                return df, date_str
            else:
                print(f"empty (HTTP {resp.status_code})")
        except Exception as e:
            print(f"not found ({e})")
    return None, None

# Firestore write using Admin SDK - uses master key for document ID
def write_doc(nse_symbol, close):
    master_key = get_master_key(nse_symbol)
    doc_ref = db.collection('price_cache').document(master_key)
    doc_ref.set({
        'symbol': master_key,
        'close': float(close),
        'lastUpdated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }, merge=True)
    return master_key

def write_meta(date_str, count):
    meta_data = {
        'bhavcopyDate': date_str,
        'recordCount': count,
        'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    db.collection('price_cache').document('sync_meta').set(meta_data, merge=True)
    db.collection('price_cache').document('_sync_meta').set(meta_data, merge=True)

def get_unique_holdings_symbols(session):
    symbols = set()
    url = f"{FS_API}/holdings?key={API_KEY}&pageSize=300"
    while url:
        resp = session.get(url, timeout=15)
        if resp.status_code != 200:
            print(f"    [WARN] Failed to fetch holdings: {resp.status_code}")
            break
        data = resp.json()
        documents = data.get("documents", [])
        for doc in documents:
            fields = doc.get("fields", {})
            stock_symbol = fields.get("stock_symbol", {}).get("stringValue", "")
            nse_symbol = fields.get("nse_symbol", {}).get("stringValue", "")
            if nse_symbol:
                symbols.add(nse_symbol.strip().upper())
            elif stock_symbol:
                symbols.add(stock_symbol.strip().upper())
                
        next_token = data.get("nextPageToken")
        if next_token:
            url = f"{FS_API}/holdings?key={API_KEY}&pageSize=300&pageToken={next_token}"
        else:
            url = None
    return list(symbols)

def get_closest_row_index(df, target_date):
    diffs = (df['Date'] - pd.to_datetime(target_date)).abs()
    return diffs.idxmin()

def get_ytd_index(df, start_of_year):
    matching = df[df['Date'] >= pd.to_datetime(start_of_year)]
    if not matching.empty:
        return matching.index[0]
    return 0

def get_nifty_period_return(df_nifty, months_ago=None, is_ytd=False):
    if df_nifty.empty:
        return 0.0, 0.0, 0.0
    end_price = df_nifty['CLOSE'].iloc[-1]
    
    if is_ytd:
        now = datetime.datetime.now()
        start_of_year = datetime.datetime(now.year, 1, 1)
        idx = get_ytd_index(df_nifty, start_of_year)
    else:
        now = datetime.datetime.now()
        target_date = now - datetime.timedelta(days=months_ago * 30.44)
        idx = get_closest_row_index(df_nifty, target_date)
        
    start_price = df_nifty['CLOSE'].iloc[idx]
    ret = ((end_price - start_price) / start_price) * 100 if start_price > 0 else 0.0
    return float(ret), float(start_price), float(end_price)

def get_stock_history_yahoo(symbol):
    query_sym = symbol
    if not query_sym.endswith(".NS") and not query_sym.endswith(".BO") and not query_sym.startswith("^") and "=" not in query_sym:
        query_sym = f"{query_sym}.NS"
        
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{query_sym}?range=1y&interval=1d"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    resp = requests.get(url, headers=headers, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(f"Yahoo fetch returned {resp.status_code}")
        
    data = resp.json()
    result = data.get("chart", {}).get("result", [None])[0]
    if not result:
        raise RuntimeError("Empty result in Yahoo chart data")
        
    timestamps = result.get("timestamp")
    closes = result.get("indicators", {}).get("quote", [{}])[0].get("close")
    volumes = result.get("indicators", {}).get("quote", [{}])[0].get("volume")
    
    if not timestamps or not closes:
        raise RuntimeError("Missing timestamp or close data")
        
    rows = []
    for t, c, v in zip(timestamps, closes, volumes):
        if t is not None and c is not None and c > 0:
            rows.append({
                'Timestamp': t,
                'Close': float(c),
                'Volume': float(v) if v is not None else 0.0
            })
            
    if not rows:
        raise RuntimeError("No valid rows after filtering null closes")
        
    df = pd.DataFrame(rows)
    df['Date'] = pd.to_datetime(df['Timestamp'], unit='s')
    df = df.sort_values('Date').reset_index(drop=True)
    return df

def calculate_period_return(df, months_ago=None, is_ytd=False):
    if df.empty:
        return 0.0
    end_price = df['Close'].iloc[-1]
    
    if is_ytd:
        now = datetime.datetime.now()
        start_of_year = datetime.datetime(now.year, 1, 1)
        idx = get_ytd_index(df, start_of_year)
    else:
        now = datetime.datetime.now()
        target_date = now - datetime.timedelta(days=months_ago * 30.44)
        idx = get_closest_row_index(df, target_date)
        
    start_price = df['Close'].iloc[idx]
    if start_price > 0:
        return ((end_price - start_price) / start_price) * 100
    return 0.0

def sync_market_data(session, bhavcopy_prices):
    print("\n[MARKET DATA] Starting market data calculations sync...")
    
    # 1. Fetch Nifty 500 Index History
    print("  Fetching Nifty 500 history from niftyindices.com...")
    try:
        url_idx = 'https://niftyindices.com/Backpage.aspx/getHistoricaldatatabletoString'
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Content-Type': 'application/json; charset=UTF-8',
            'Origin': 'https://niftyindices.com',
            'Referer': 'https://niftyindices.com/reports/historical-data',
        }
        start_date = (datetime.datetime.now() - datetime.timedelta(days=400)).strftime("%d-%b-%Y")
        end_date = datetime.datetime.now().strftime("%d-%b-%Y")
        data = {
            'cinfo': f"{{'name':'NIFTY 500','startDate':'{start_date}','endDate':'{end_date}','indexName':'NIFTY 500'}}"
        }
        resp = session.post(url_idx, headers=headers, json=data, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"Nifty 500 indices fetch failed: {resp.status_code}")
        
        parsed = json.loads(resp.json()["d"])
        df_nifty = pd.DataFrame(parsed)
        df_nifty['CLOSE'] = df_nifty['CLOSE'].astype(float)
        df_nifty['Date'] = pd.to_datetime(df_nifty['HistoricalDate'], format='%d %b %Y')
        df_nifty = df_nifty.sort_values('Date').reset_index(drop=True)
        print(f"  [OK] Fetched Nifty 500 Index history ({len(df_nifty)} rows)")
    except Exception as e:
        print(f"  [ERROR] Failed to fetch Nifty 500 index history: {e}")
        return

    # 2. Calculate Nifty 500 Returns and Daily Returns
    df_nifty['Return'] = df_nifty['CLOSE'].pct_change()
    nifty_returns = df_nifty['Return'].dropna().tolist()
    
    periods_def = [
        {"period": "1M", "label": "1 Month", "months_ago": 1, "is_ytd": False},
        {"period": "3M", "label": "3 Months", "months_ago": 3, "is_ytd": False},
        {"period": "6M", "label": "6 Months", "months_ago": 6, "is_ytd": False},
        {"period": "YTD", "label": "Year to Date", "months_ago": None, "is_ytd": True},
        {"period": "1Y", "label": "1 Year", "months_ago": 12, "is_ytd": False}
    ]
    
    nifty_returns_list = []
    for p in periods_def:
        ret, start_p, end_p = get_nifty_period_return(df_nifty, months_ago=p["months_ago"], is_ytd=p["is_ytd"])
        nifty_returns_list.append({
            "period": p["period"],
            "label": p["label"],
            "niftyStartPrice": float(start_p),
            "niftyEndPrice": float(end_p),
            "niftyReturn": float(ret)
        })
        
    # Write benchmark to Firestore
    benchmark_data = {
        "symbol": "^CRSLDX",
        "returns": nifty_returns_list,
        "niftyDailyReturns": nifty_returns
    }
    
    try:
        write_market_data("benchmark_^CRSLDX", benchmark_data, session)
        print("  [OK] Saved benchmark_^CRSLDX to Firestore")
    except Exception as e:
        print(f"  [ERROR] Failed to save benchmark_^CRSLDX: {e}")
        return

    # 3. Retrieve all unique stock symbols from holdings
    print("  Fetching unique holdings symbols from Firestore...")
    symbols = get_unique_holdings_symbols(session)
    print(f"  [OK] Found {len(symbols)} unique holdings symbols to sync")
    
    nifty_var = df_nifty['Return'].dropna().var(ddof=0)
    done_count = 0
    errors_count = 0
    
    # Helper to process and calculate stock stats
    def process_symbol(symbol):
        symbol_cleaned = symbol.strip().upper()
        if symbol_cleaned == "CASH" or symbol_cleaned == "GOLD ETF" or symbol_cleaned.startswith("SGB"):
            close_price = bhavcopy_prices.get(symbol_cleaned, 0.0)
            return {
                "symbol": symbol_cleaned,
                "high52W": float(close_price),
                "low52W": float(close_price),
                "currentPrice": float(close_price),
                "pctFromHigh": 0.0,
                "pctFromLow": 0.0,
                "return1Y": 0.0,
                "returnYTD": 0.0,
                "return6M": 0.0,
                "return3M": 0.0,
                "return1M": 0.0,
                "trueBeta": 0.0,
                "volatility": 0.0,
                "liquidity": "Medium"
            }
            
        try:
            df_stock = get_stock_history_yahoo(symbol_cleaned)
            current_price = bhavcopy_prices.get(symbol_cleaned)
            if not current_price or current_price <= 0:
                current_price = df_stock['Close'].iloc[-1]
                
            high52W = df_stock['Close'].max()
            low52W = df_stock['Close'].min()
            
            pctFromHigh = ((current_price - high52W) / high52W) * 100 if high52W > 0 else 0.0
            pctFromLow = ((current_price - low52W) / low52W) * 100 if low52W > 0 else 0.0
            
            return1M = calculate_period_return(df_stock, months_ago=1)
            return3M = calculate_period_return(df_stock, months_ago=3)
            return6M = calculate_period_return(df_stock, months_ago=6)
            returnYTD = calculate_period_return(df_stock, is_ytd=True)
            return1Y = calculate_period_return(df_stock, months_ago=12)
            
            # Volatility
            df_stock['Return'] = df_stock['Close'].pct_change()
            stock_var = df_stock['Return'].dropna().var(ddof=0)
            volatility = math.sqrt(stock_var) * math.sqrt(252) * 100 if stock_var > 0 else 0.0
            
            # Beta
            df_stock['DateOnly'] = df_stock['Date'].dt.date
            df_nifty['DateOnly'] = df_nifty['Date'].dt.date
            merged = pd.merge(df_stock, df_nifty, on='DateOnly', suffixes=('_stock', '_nifty'))
            merged = merged.dropna(subset=['Return_stock', 'Return_nifty'])
            
            if len(merged) > 10 and nifty_var > 0:
                cov = np.cov(merged['Return_stock'], merged['Return_nifty'], ddof=0)[0][1]
                beta = cov / nifty_var
            else:
                beta = 1.0
                
            # Liquidity
            avg_volume = df_stock['Volume'].mean()
            daily_turnover = avg_volume * current_price
            if daily_turnover > 500000000.0:  # 50 Cr
                liquidity = 'High'
            elif daily_turnover > 100000000.0:  # 10 Cr
                liquidity = 'Medium'
            else:
                liquidity = 'Low'
                
            return {
                "symbol": symbol_cleaned,
                "high52W": float(high52W),
                "low52W": float(low52W),
                "currentPrice": float(current_price),
                "pctFromHigh": float(pctFromHigh),
                "pctFromLow": float(pctFromLow),
                "return1Y": float(return1Y),
                "returnYTD": float(returnYTD),
                "return6M": float(return6M),
                "return3M": float(return3M),
                "return1M": float(return1M),
                "trueBeta": float(beta),
                "volatility": float(volatility),
                "liquidity": liquidity
            }
            
        except Exception as e:
            close_price = bhavcopy_prices.get(symbol_cleaned, 0.0)
            print(f"  [WARN] Yahoo fetch failed for {symbol_cleaned}: {e}. Writing fallback record.")
            return {
                "symbol": symbol_cleaned,
                "high52W": float(close_price),
                "low52W": float(close_price),
                "currentPrice": float(close_price),
                "pctFromHigh": 0.0,
                "pctFromLow": 0.0,
                "return1Y": 0.0,
                "returnYTD": 0.0,
                "return6M": 0.0,
                "return3M": 0.0,
                "return1M": 0.0,
                "trueBeta": 1.0,
                "volatility": 0.0,
                "liquidity": "Medium"
            }

    print(f"  Running calculations and writing to Firestore for {len(symbols)} symbols...")
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(process_symbol, sym): sym for sym in symbols}
        for future in as_completed(futures):
            sym = futures[future]
            try:
                data_obj = future.result()
                write_market_data(sym, data_obj, session)
                
                # If the symbol has a .NS suffix or doesn't have it, write under both forms so frontend is 100% covered
                if sym.endswith(".NS"):
                    sym_alt = sym.replace(".NS", "")
                    write_market_data(sym_alt, {**data_obj, "symbol": sym_alt}, session)
                elif not sym.endswith(".BO") and not sym.startswith("^"):
                    sym_alt = f"{sym}.NS"
                    write_market_data(sym_alt, {**data_obj, "symbol": sym_alt}, session)
                    
                done_count += 1
                if done_count % 50 == 0 or done_count == len(symbols):
                    print(f"    Synced {done_count}/{len(symbols)} market data docs")
            except Exception as e:
                errors_count += 1
                print(f"    [ERROR] Failed to write market data for {sym}: {e}")
                
    print(f"  [OK] Market data sync complete! {done_count} succeeded, {errors_count} failed.")


def get_closest_row_index(df, target_date):
    diffs = (df['Date'] - pd.to_datetime(target_date)).abs()
    return diffs.idxmin()

def get_ytd_index(df, start_of_year):
    matching = df[df['Date'] >= pd.to_datetime(start_of_year)]
    if not matching.empty:
        return matching.index[0]
    return 0

def get_nifty_period_return(df_nifty, months_ago=None, is_ytd=False):
    if df_nifty.empty:
        return 0.0, 0.0, 0.0
    end_price = df_nifty['CLOSE'].iloc[-1]
    
    if is_ytd:
        now = datetime.datetime.now()
        start_of_year = datetime.datetime(now.year, 1, 1)
        idx = get_ytd_index(df_nifty, start_of_year)
    else:
        now = datetime.datetime.now()
        target_date = now - datetime.timedelta(days=months_ago * 30.44)
        idx = get_closest_row_index(df_nifty, target_date)
        
    start_price = df_nifty['CLOSE'].iloc[idx]
    ret = ((end_price - start_price) / start_price) * 100 if start_price > 0 else 0.0
    return float(ret), float(start_price), float(end_price)

def get_stock_history_yahoo(symbol):
    query_sym = symbol
    if not query_sym.endswith(".NS") and not query_sym.endswith(".BO") and not query_sym.startswith("^") and "=" not in query_sym:
        query_sym = f"{query_sym}.NS"
        
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{query_sym}?range=1y&interval=1d"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    resp = requests.get(url, headers=headers, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(f"Yahoo fetch returned {resp.status_code}")
        
    data = resp.json()
    result = data.get("chart", {}).get("result", [None])[0]
    if not result:
        raise RuntimeError("Empty result in Yahoo chart data")
        
    timestamps = result.get("timestamp")
    closes = result.get("indicators", {}).get("quote", [{}])[0].get("close")
    volumes = result.get("indicators", {}).get("quote", [{}])[0].get("volume")
    
    if not timestamps or not closes:
        raise RuntimeError("Missing timestamp or close data")
        
    rows = []
    for t, c, v in zip(timestamps, closes, volumes):
        if t is not None and c is not None and c > 0:
            rows.append({
                'Timestamp': t,
                'Close': float(c),
                'Volume': float(v) if v is not None else 0.0
            })
            
    if not rows:
        raise RuntimeError("No valid rows after filtering null closes")
        
    df = pd.DataFrame(rows)
    df['Date'] = pd.to_datetime(df['Timestamp'], unit='s')
    df = df.sort_values('Date').reset_index(drop=True)
    return df

def calculate_period_return(df, months_ago=None, is_ytd=False):
    if df.empty:
        return 0.0
    end_price = df['Close'].iloc[-1]
    
    if is_ytd:
        now = datetime.datetime.now()
        start_of_year = datetime.datetime(now.year, 1, 1)
        idx = get_ytd_index(df, start_of_year)
    else:
        now = datetime.datetime.now()
        target_date = now - datetime.timedelta(days=months_ago * 30.44)
        idx = get_closest_row_index(df, target_date)
        
    start_price = df['Close'].iloc[idx]
    if start_price > 0:
        return ((end_price - start_price) / start_price) * 100
    return 0.0

def write_market_data(doc_id, data):
    doc_ref = db.collection('market_data').document(doc_id)
    data_to_write = {**data, "last_updated": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    doc_ref.set(data_to_write, merge=True)

def get_unique_holdings_symbols():
    symbols = set()
    holdings_ref = db.collection('holdings')
    docs = holdings_ref.stream()
    for doc in docs:
        data = doc.to_dict()
        stock_symbol = data.get('stock_symbol', '')
        nse_symbol = data.get('nse_symbol', '')
        if nse_symbol:
            symbols.add(nse_symbol.strip().upper())
        elif stock_symbol:
            symbols.add(stock_symbol.strip().upper())
    return list(symbols)

def sync_market_data(bhavcopy_prices):
    print("\n[MARKET DATA] Starting market data calculations sync...")
    
    # 1. Fetch Nifty 500 Index History
    print("  Fetching Nifty 500 history from niftyindices.com...")
    try:
        url_idx = 'https://niftyindices.com/Backpage.aspx/getHistoricaldatatabletoString'
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Content-Type': 'application/json; charset=UTF-8',
            'Origin': 'https://niftyindices.com',
            'Referer': 'https://niftyindices.com/reports/historical-data',
        }
        start_date = (datetime.datetime.now() - datetime.timedelta(days=400)).strftime("%d-%b-%Y")
        end_date = datetime.datetime.now().strftime("%d-%b-%Y")
        data = {
            'cinfo': f"{{'name':'NIFTY 500','startDate':'{start_date}','endDate':'{end_date}','indexName':'NIFTY 500'}}"
        }
        resp = requests.post(url_idx, headers=headers, json=data, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"Nifty 500 indices fetch failed: {resp.status_code}")
        
        parsed = json.loads(resp.json()["d"])
        df_nifty = pd.DataFrame(parsed)
        df_nifty['CLOSE'] = df_nifty['CLOSE'].astype(float)
        df_nifty['Date'] = pd.to_datetime(df_nifty['HistoricalDate'], format='%d %b %Y')
        df_nifty = df_nifty.sort_values('Date').reset_index(drop=True)
        print(f"  [OK] Fetched Nifty 500 Index history ({len(df_nifty)} rows)")
    except Exception as e:
        print(f"  [ERROR] Failed to fetch Nifty 500 index history: {e}")
        return

    # 2. Calculate Nifty 500 Returns and Daily Returns
    df_nifty['Return'] = df_nifty['CLOSE'].pct_change()
    nifty_returns = df_nifty['Return'].dropna().tolist()
    
    periods_def = [
        {"period": "1M", "label": "1 Month", "months_ago": 1, "is_ytd": False},
        {"period": "3M", "label": "3 Months", "months_ago": 3, "is_ytd": False},
        {"period": "6M", "label": "6 Months", "months_ago": 6, "is_ytd": False},
        {"period": "YTD", "label": "Year to Date", "months_ago": None, "is_ytd": True},
        {"period": "1Y", "label": "1 Year", "months_ago": 12, "is_ytd": False}
    ]
    
    nifty_returns_list = []
    for p in periods_def:
        ret, start_p, end_p = get_nifty_period_return(df_nifty, months_ago=p["months_ago"], is_ytd=p["is_ytd"])
        nifty_returns_list.append({
            "period": p["period"],
            "label": p["label"],
            "niftyStartPrice": float(start_p),
            "niftyEndPrice": float(end_p),
            "niftyReturn": float(ret)
        })
        
    # Write benchmark to Firestore
    benchmark_data = {
        "symbol": "^CRSLDX",
        "returns": nifty_returns_list,
        "niftyDailyReturns": nifty_returns
    }
    
    try:
        write_market_data("benchmark_^CRSLDX", benchmark_data)
        print("  [OK] Saved benchmark_^CRSLDX to Firestore")
    except Exception as e:
        print(f"  [ERROR] Failed to save benchmark_^CRSLDX: {e}")
        return

    # 3. Retrieve all unique stock symbols from holdings
    print("  Fetching unique holdings symbols from Firestore...")
    symbols = get_unique_holdings_symbols()
    print(f"  [OK] Found {len(symbols)} unique holdings symbols to sync")
    
    nifty_var = df_nifty['Return'].dropna().var(ddof=0)
    done_count = 0
    errors_count = 0
    
    # Helper to process and calculate stock stats
    def process_symbol(symbol):
        symbol_cleaned = symbol.strip().upper()
        if symbol_cleaned == "CASH" or symbol_cleaned == "GOLD ETF" or symbol_cleaned.startswith("SGB"):
            close_price = bhavcopy_prices.get(symbol_cleaned, 0.0)
            return {
                "symbol": symbol_cleaned,
                "high52W": float(close_price),
                "low52W": float(close_price),
                "currentPrice": float(close_price),
                "pctFromHigh": 0.0,
                "pctFromLow": 0.0,
                "return1Y": 0.0,
                "returnYTD": 0.0,
                "return6M": 0.0,
                "return3M": 0.0,
                "return1M": 0.0,
                "trueBeta": 0.0,
                "volatility": 0.0,
                "liquidity": "Medium"
            }
            
        try:
            df_stock = get_stock_history_yahoo(symbol_cleaned)
            current_price = bhavcopy_prices.get(symbol_cleaned)
            if not current_price or current_price <= 0:
                current_price = df_stock['Close'].iloc[-1]
                
            high52W = df_stock['Close'].max()
            low52W = df_stock['Close'].min()
            
            pctFromHigh = ((current_price - high52W) / high52W) * 100 if high52W > 0 else 0.0
            pctFromLow = ((current_price - low52W) / low52W) * 100 if low52W > 0 else 0.0
            
            return1M = calculate_period_return(df_stock, months_ago=1)
            return3M = calculate_period_return(df_stock, months_ago=3)
            return6M = calculate_period_return(df_stock, months_ago=6)
            returnYTD = calculate_period_return(df_stock, is_ytd=True)
            return1Y = calculate_period_return(df_stock, months_ago=12)
            
            # Volatility
            df_stock['Return'] = df_stock['Close'].pct_change()
            stock_var = df_stock['Return'].dropna().var(ddof=0)
            volatility = math.sqrt(stock_var) * math.sqrt(252) * 100 if stock_var > 0 else 0.0
            
            # Beta
            df_stock['DateOnly'] = df_stock['Date'].dt.date
            df_nifty['DateOnly'] = df_nifty['Date'].dt.date
            merged = pd.merge(df_stock, df_nifty, on='DateOnly', suffixes=('_stock', '_nifty'))
            merged = merged.dropna(subset=['Return_stock', 'Return_nifty'])
            
            if len(merged) > 10 and nifty_var > 0:
                cov = np.cov(merged['Return_stock'], merged['Return_nifty'], ddof=0)[0][1]
                beta = cov / nifty_var
            else:
                beta = 1.0
                
            # Liquidity
            avg_volume = df_stock['Volume'].mean()
            daily_turnover = avg_volume * current_price
            if daily_turnover > 500000000.0:  # 50 Cr
                liquidity = 'High'
            elif daily_turnover > 100000000.0:  # 10 Cr
                liquidity = 'Medium'
            else:
                liquidity = 'Low'
                
            return {
                "symbol": symbol_cleaned,
                "high52W": float(high52W),
                "low52W": float(low52W),
                "currentPrice": float(current_price),
                "pctFromHigh": float(pctFromHigh),
                "pctFromLow": float(pctFromLow),
                "return1Y": float(return1Y),
                "returnYTD": float(returnYTD),
                "return6M": float(return6M),
                "return3M": float(return3M),
                "return1M": float(return1M),
                "trueBeta": float(beta),
                "volatility": float(volatility),
                "liquidity": liquidity
            }
            
        except Exception as e:
            close_price = bhavcopy_prices.get(symbol_cleaned, 0.0)
            print(f"  [WARN] Yahoo fetch failed for {symbol_cleaned}: {e}. Writing fallback record.")
            return {
                "symbol": symbol_cleaned,
                "high52W": float(close_price),
                "low52W": float(close_price),
                "currentPrice": float(close_price),
                "pctFromHigh": 0.0,
                "pctFromLow": 0.0,
                "return1Y": 0.0,
                "returnYTD": 0.0,
                "return6M": 0.0,
                "return3M": 0.0,
                "return1M": 0.0,
                "trueBeta": 1.0,
                "volatility": 0.0,
                "liquidity": "Medium"
            }

    print(f"  Running calculations and writing to Firestore for {len(symbols)} symbols...")
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(process_symbol, sym): sym for sym in symbols}
        for future in as_completed(futures):
            sym = futures[future]
            try:
                data_obj = future.result()
                write_market_data(sym, data_obj)
                
                # If the symbol has a .NS suffix or doesn't have it, write under both forms so frontend is 100% covered
                if sym.endswith(".NS"):
                    sym_alt = sym.replace(".NS", "")
                    write_market_data(sym_alt, {**data_obj, "symbol": sym_alt})
                elif not sym.endswith(".BO") and not sym.startswith("^"):
                    sym_alt = f"{sym}.NS"
                    write_market_data(sym_alt, {**data_obj, "symbol": sym_alt})
                    
                done_count += 1
                if done_count % 50 == 0 or done_count == len(symbols):
                    print(f"    Synced {done_count}/{len(symbols)} market data docs")
            except Exception as e:
                errors_count += 1
                print(f"    [ERROR] Failed to write market data for {sym}: {e}")
                
    print(f"  [OK] Market data sync complete! {done_count} succeeded, {errors_count} failed.")


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
            if symbol == 'TMPV':
                docs.append(('TATAMOTORS', close))
        except Exception as e:
            skipped += 1

    print(f"  Valid  : {len(docs)}")
    print(f"  Skipped: {skipped}\n")

    if len(docs) == 0:
        print("[ERROR] No valid symbols found. Check column names above.")
        sys.exit(1)

    tata = [d for d in docs if d[0] == 'TATAMOTORS']
    print(f"DEBUG: TATAMOTORS in docs? {tata}")

    # Write to Firestore in parallel (20 threads for speed)
    print(f"[WRITE] Writing {len(docs)} prices to Firebase (20 parallel threads)...")

    errors   = []
    done     = 0

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {
            executor.submit(write_doc, sym, price): sym
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

    write_meta(date_str, done)
    
    # Run market data calculations and sync
    try:
        sync_market_data(dict(docs))
    except Exception as e:
        print(f"\n[ERROR] Market data sync failed: {e}")
        
    print(f"\n[DONE] {done} prices written for {date_str}")
    print("Now click 'Refresh Prices' on the website!\n")

if __name__ == "__main__":
    main()
