#!/usr/bin/env python3
"""
Fetch NSE Bhavcopy for a given date and compare symbols with companyMaster.json
"""

import requests
import csv
import io
import json
from datetime import datetime, timedelta

# Load companyMaster
with open('src/lib/companyMaster.json', 'r') as f:
    company_master = json.load(f)

# Build reverse mapping: bhavcopy_symbol -> companyMaster_key
bhavcopy_to_master = {}
for key, idx in company_master['nse'].items():
    company = company_master['companies'][idx]
    if company and company[7]:  # short name
        short_name = company[7].replace(' ', '').upper()
        bhavcopy_to_master[short_name] = key

# Also add direct mappings
for key in company_master['nse'].keys():
    bhavcopy_to_master[key] = key

print(f"Total mappings in companyMaster: {len(bhavcopy_to_master)}")

# Fetch Bhavcopy for yesterday (or specified date)
def fetch_bhavcopy(date_str=None):
    """Fetch NSE Bhavcopy CSV for given date (DD-MM-YYYY)"""
    if date_str is None:
        # Yesterday in IST
        ist_now = datetime.utcnow() + timedelta(hours=5, minutes=30)
        target_date = ist_now - timedelta(days=1)
        date_str = target_date.strftime('%d-%m-%Y')
    
    compact = date_str.replace('-', '')
    url = f'https://archives.nseindia.com/products/content/sec_bhavdata_full_{compact}.csv'
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/csv,*/*',
        'Referer': 'https://www.nseindia.com/',
    }
    
    print(f"Fetching: {url}")
    response = requests.get(url, headers=headers, timeout=30)
    
    if response.status_code != 200:
        print(f"Failed to fetch: HTTP {response.status_code}")
        return None
    
    if not response.text.strip().startswith('SYMBOL'):
        print("Invalid CSV format")
        return None
    
    return response.text

def parse_bhavcopy(csv_text):
    """Parse Bhavcopy CSV and return dict of symbol -> close_price"""
    reader = csv.DictReader(io.StringIO(csv_text))
    prices = {}
    allowed_series = {'EQ', 'BE', 'BZ', 'SM', 'ST', 'GS'}
    
    for row in reader:
        symbol = row.get('SYMBOL', '').strip().upper()
        series = row.get('SERIES', '').strip().upper()
        close_str = row.get('CLOSE_PRICE', '').strip()
        
        if symbol and series in allowed_series and close_str:
            try:
                close = float(close_str)
                if close > 0:
                    prices[symbol] = close
            except ValueError:
                pass
    
    return prices

# Main
if __name__ == '__main__':
    import sys
    
    # Allow date override via command line
    date_str = sys.argv[1] if len(sys.argv) > 1 else None
    
    csv_text = fetch_bhavcopy(date_str)
    if not csv_text:
        sys.exit(1)
    
    bhavcopy_prices = parse_bhavcopy(csv_text)
    print(f"\nBhavcopy symbols found: {len(bhavcopy_prices)}")
    
    # Check problematic symbols
    problematic = [
        'ABDL', 'AWFIS', 'GOLDETF', 'GROWW', 'GRSE', 'GSFC', 'IRFC', 
        'JPPOWER', 'MAZDOCK', 'MTNL', 'OIL', 'PRIVISCL', 'RVNL', 
        'TITAGARH', 'TMPV', 'FEDERALBNK', 'RAJRATAN', 'JWL', 
        'KPITTECH', 'PRAJIND', 'CDSL'
    ]
    
    print("\n=== PROBLEMATIC SYMBOLS CHECK ===")
    print(f"{'companyMaster_key':<20} {'bhavcopy_symbol':<25} {'in_bhavcopy':<12} {'price':<10} {'mapped_key'}")
    print("-" * 90)
    
    for key in problematic:
        idx = company_master['nse'].get(key)
        if idx is not None:
            company = company_master['companies'][idx]
            short_name = company[7].replace(' ', '').upper() if company[7] else ''
            in_bhavcopy = short_name in bhavcopy_prices
            price = bhavcopy_prices.get(short_name, 'N/A')
            mapped_key = bhavcopy_to_master.get(short_name, 'NOT_MAPPED')
            print(f"{key:<20} {short_name:<25} {str(in_bhavcopy):<12} {str(price):<10} {mapped_key}")
        else:
            print(f"{key:<20} {'NOT_IN_MASTER':<25} {'N/A':<12} {'N/A':<10} {'N/A'}")
    
    # Show all bhavcopy symbols that DON'T map to companyMaster
    print("\n=== BHAVCOPY SYMBOLS NOT IN COMPANY MASTER ===")
    unmapped = []
    for sym in bhavcopy_prices.keys():
        if sym not in bhavcopy_to_master:
            unmapped.append(sym)
    
    print(f"Total unmapped: {len(unmapped)}")
    if unmapped:
        print("First 50:", unmapped[:50])
    
    # Save comparison for review
    output = {
        'date': date_str or 'yesterday',
        'bhavcopy_count': len(bhavcopy_prices),
        'master_count': len(bhavcopy_to_master),
        'problematic_check': {},
        'unmapped_bhavcopy_symbols': unmapped[:100]
    }
    
    for key in problematic:
        idx = company_master['nse'].get(key)
        if idx is not None:
            company = company_master['companies'][idx]
            short_name = company[7].replace(' ', '').upper() if company[7] else ''
            output['problematic_check'][key] = {
                'bhavcopy_symbol': short_name,
                'in_bhavcopy': short_name in bhavcopy_prices,
                'price': bhavcopy_prices.get(short_name),
                'mapped_key': bhavcopy_to_master.get(short_name)
            }
    
    with open('bhavcopy_comparison.json', 'w') as f:
        json.dump(output, f, indent=2)
    
    print("\n✅ Comparison saved to bhavcopy_comparison.json")