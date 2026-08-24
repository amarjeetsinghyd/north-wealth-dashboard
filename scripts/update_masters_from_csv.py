#!/usr/bin/env python3
"""
Convert CSV master files to JSON format for the North Wealth Portfolio Dashboard.
Reads:
- ETF Master_Sector Updated.csv
- Company Master_Sector Updated.csv

Writes:
- src/lib/etfMaster.json
- src/lib/companyMaster.json
- src/lib/isinMap.json
"""

import os
import json
import csv

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

ETF_CSV = os.path.join(PROJECT_ROOT, 'ETF Master_Sector Updated.csv')
COMPANY_CSV = os.path.join(PROJECT_ROOT, 'Company Master_Sector Updated.csv')

LIB_DIR = os.path.join(PROJECT_ROOT, 'src', 'lib')
ETF_MASTER_OUT = os.path.join(LIB_DIR, 'etfMaster.json')
COMPANY_MASTER_OUT = os.path.join(LIB_DIR, 'companyMaster.json')
ISIN_MAP_OUT = os.path.join(LIB_DIR, 'isinMap.json')


def update_etf_master():
    """Parse ETF CSV and write etfMaster.json with sector field."""
    print(f"Reading ETF master from: {ETF_CSV}")
    
    etfs = []
    etf_isin_index = {}
    ticker_index = {}
    
    with open(ETF_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            etf_name = str(row.get('ETFName') or '').strip()
            category = str(row.get('ETFCategory') or '').strip()
            amc_name = str(row.get('AMCName') or '').strip()
            isin = str(row.get('ISIN') or '').strip().upper()
            sector = str(row.get('Sector') or '').strip()
            
            if not isin or isin == 'UNDEFINED':
                continue
            
            # Tuple structure: [0]name, [1]category, [2]amc, [3]sector
            tuple_row = [etf_name, category, amc_name, sector]
            idx = len(etfs)
            etfs.append(tuple_row)
            etf_isin_index[isin] = idx
            
            # Common Ticker Mapping
            name_lower = etf_name.lower()
            if 'gold bees' in name_lower or 'goldbees' in name_lower:
                ticker_index['GOLDBEES'] = idx
            elif 'silver bees' in name_lower or 'silverbees' in name_lower:
                ticker_index['SILVERBEES'] = idx
            elif 'junior bees' in name_lower or 'juniorbees' in name_lower or 'next 50 junior' in name_lower:
                ticker_index['JUNIORBEES'] = idx
            elif 'liquid bees' in name_lower or 'liquidbees' in name_lower or '1d rate liquid' in name_lower:
                ticker_index['LIQUIDBEES'] = idx
            elif 'nifty 50 bees' in name_lower or 'nifty bees' in name_lower:
                ticker_index['NIFTYBEES'] = idx
            elif 'bank bees' in name_lower or 'bankbees' in name_lower or 'nifty bank bees' in name_lower:
                ticker_index['BANKBEES'] = idx
            elif 'it bees' in name_lower or 'itbees' in name_lower:
                ticker_index['ITBEES'] = idx
            elif 'hang seng bees' in name_lower or 'hangsengbees' in name_lower:
                ticker_index['HANGSENGBEES'] = idx
            elif 'pharma bees' in name_lower or 'pharmabees' in name_lower:
                ticker_index['PHARMABEES'] = idx
            elif 'infra bees' in name_lower or 'infrabees' in name_lower:
                ticker_index['INFRABEES'] = idx
            elif 'consumption bees' in name_lower or 'consumptionbees' in name_lower:
                ticker_index['CONSUMPTIONBEES'] = idx
            elif 'monifty50' in name_lower:
                ticker_index['MONIFTY50'] = idx
            elif 'nifty100' in name_lower:
                ticker_index['NIFTY100'] = idx
            elif 'midcap100' in name_lower:
                ticker_index['MIDCAP100'] = idx
            elif 'nasdaq 100' in name_lower or 'nasdaq100' in name_lower:
                ticker_index['MONASDAQ100'] = idx
    
    etf_master_dict = {
        'etfs': etfs,
        'isin': etf_isin_index,
        'ticker': ticker_index
    }
    
    with open(ETF_MASTER_OUT, 'w', encoding='utf-8') as f:
        json.dump(etf_master_dict, f, separators=(',', ':'))
    
    print(f"Updated {ETF_MASTER_OUT} with {len(etfs)} ETFs.")
    return etf_isin_index


def update_company_master():
    """Parse Company CSV and write companyMaster.json and isinMap.json."""
    print(f"Reading Company master from: {COMPANY_CSV}")
    
    companies = []
    nse_index = {}
    bse_index = {}
    isin_index = {}
    isin_to_nse = {}
    
    with open(COMPANY_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            comp_name = str(row.get('companyname') or '').strip()
            sector = str(row.get('sectorname') or '').strip()
            mcap_raw = str(row.get('mcaptype') or '').strip()
            industry = str(row.get('industryname') or '').strip()
            isin = str(row.get('isin') or '').strip().upper()
            bse_group = str(row.get('bsegroup') or '').strip()
            short_name = str(row.get('companyshortname') or '').strip()
            nse_status = str(row.get('NSEStatus') or '').strip()
            bse_status = str(row.get('BSEStatus') or '').strip()
            
            # Standardize market cap category
            mcap_type = 'Mid'
            if 'large' in mcap_raw.lower():
                mcap_type = 'Large'
            elif 'small' in mcap_raw.lower():
                mcap_type = 'Small'
            
            mcap_str = str(row.get('mcap') or '0').strip().lower()
            mcap_val = 0.0
            if mcap_str and mcap_str != 'undefined':
                try:
                    mcap_val = float(mcap_str)
                except ValueError:
                    mcap_val = 0.0
            
            # Tuple structure matching sectorMap.ts:
            # [0]name, [1]sector, [2]mcaptype, [3]mcapVal, [4]industry, [5]isin, [6]bsegroup, [7]shortname, [8]nseStatus, [9]bseStatus
            tuple_row = [
                comp_name,
                sector,
                mcap_type,
                round(mcap_val, 2),
                industry,
                isin,
                bse_group,
                short_name,
                nse_status,
                bse_status
            ]
            
            idx = len(companies)
            companies.append(tuple_row)
            
            nse_sym = str(row.get('nsesymbol') or '').strip().upper()
            bse_code = str(row.get('bsecode') or '').strip()
            
            if nse_sym and nse_sym != 'UNDEFINED':
                nse_index[nse_sym] = idx
                if isin:
                    isin_to_nse[isin] = nse_sym
            
            if bse_code and bse_code != 'UNDEFINED':
                bse_index[bse_code] = idx
            
            if isin and isin != 'UNDEFINED':
                isin_index[isin] = idx
    
    company_master_dict = {
        'nse': nse_index,
        'bse': bse_index,
        'isin': isin_index,
        'companies': companies
    }
    
    with open(COMPANY_MASTER_OUT, 'w', encoding='utf-8') as f:
        json.dump(company_master_dict, f, separators=(',', ':'))
    
    print(f"Updated {COMPANY_MASTER_OUT} with {len(companies)} companies.")
    
    # Write isinMap.json
    with open(ISIN_MAP_OUT, 'w', encoding='utf-8') as f:
        json.dump(isin_to_nse, f, separators=(',', ':'))
    
    print(f"Updated {ISIN_MAP_OUT} with {len(isin_to_nse)} ISIN-to-NSE mappings.")
    return isin_to_nse


def main():
    print("=" * 60)
    print("Updating Master Data from CSV Files")
    print("=" * 60)
    
    # Update ETF Master
    update_etf_master()
    print()
    
    # Update Company Master
    update_company_master()
    print()
    
    print("=" * 60)
    print("Master JSON datasets updated successfully!")
    print("=" * 60)


if __name__ == '__main__':
    main()