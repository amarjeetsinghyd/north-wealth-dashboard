export const SYMBOL_SYNONYMS = [
  'symbol', 'stock name', 'nse symbol', 'bse symbol', 'scrip code', 'scrip name',
  'scrip', 'script', 'company', 'instrument', 'asset', 'security', 'stock', 'equity',
  'particulars', 'description', 'security name', 'instrument name', 'name of security',
  'nse code', 'bse code', 'ticker', 'name',
];

export const NAME_SYNONYMS = [
  'company name', 'name', 'full name', 'company', 'security name', 'description',
];

export const QTY_SYNONYMS = [
  'qty', 'qty.', 'quantity', 'shares', 'units', 'volume', 'no of shares',
  'no. of shares', 'nos', 'hold qty', 'balance qty', 'holding', 'holdings', 'net qty',
];

export const PRICE_SYNONYMS = [
  'avg', 'avg.', 'average', 'avg cost', 'avg. cost', 'average price', 'average cost',
  'buy price', 'buy avg', 'buy avg.', 'cost', 'cost price', 'purchase price',
  'purchase rate', 'acquisition price', 'acquisition cost', 'rate', 'price', 'avg price',
];

export const ISIN_SYNONYMS = ['isin', 'isin code', 'isin no', 'isin no.', 'isin number'];

export const VALUE_SYNONYMS = [
  'invested', 'invested value', 'invested amount', 'invested val', 'cost value',
  'purchase value', 'amount invested', 'investment', 'investment value', 'cost amount',
];

export const LTP_SYNONYMS = [
  'ltp', 'ltp.', 'last price', 'last traded', 'last traded price', 'close', 'closing price',
  'cmp', 'current price', 'market price', 'mkt price', 'prev close', 'previous close', 'close price',
];

export const CURRVAL_SYNONYMS = [
  'current value', 'mkt value', 'market value', 'present value', 'valuation', 'current val',
];

export const PNL_SYNONYMS = [
  'p&l', 'pnl', 'profit', 'gain', 'overall p&l', 'unrealised', 'unrealized',
  'unrealised p&l', 'p&l amount', 'net p&l', 'profit/loss',
];

export const SECTION_KEYWORDS = [
  'equity', 'mutual fund', 'mutual funds', 'debt', 'fixed deposit', 'fd', 'gold',
  'cash', 'summary', 'bonds', 'etf', 'derivative', 'futures', 'options', 'commodity',
];

export const TOTAL_KEYWORDS = ['total', 'grand total', 'subtotal', 'total value', 'net value', 'overall'];

export const ALIAS_MAP: Record<string, string> = {
  'APOLLO': 'APOLLOHOSP',
  'MOTHERSUMI': 'MOTHERSON',
  'MINDTREE': 'LTIM',
  'HDFC': 'HDFCBANK',
  'NSDL': 'NSDL',
  'SPTL': 'SPTL',
  'TITANSEC': 'TITANSEC',
  'VISHWARAJ': 'VISHWARAJ',
  'SHRINGAR': 'SHRINGARMS',
};

export const COMPANY_NAME_DIRECT: Record<string, string> = {
  'AAVAS FINANCIERS LIMITED': 'AAVAS',
  'APL APOLLO TUBES LTD': 'APLAPOLLO',
  'APOLLO HOSPITALS ENTER. L': 'APOLLOHOSP',
  'BAJAJ FINANCE LIMITED': 'BAJFINANCE',
  'BHARAT ELECTRONICS LTD': 'BEL',
  'BHARTI AIRTEL LIMITED': 'BHARTIARTL',
  'CEAT LIMITED': 'CEATLTD',
  'CENTRAL DEPO SER (I) LTD': 'CDSL',
  'HDB FINANCIAL SERVICES L': 'HDBFSL',
  'SUZLON ENERGY LIMITED': 'SUZLON',
  'TATA MOTORS PASS VEH LTD': 'TMPV',
  'TATAMOTORS': 'TMPV',
};

export const STRIP_SUFFIX_RE = /-(T|E|X|Z|GB|BE|BL|N|W|SM|MT|XT|BT|GS|IL|SG|EQ)$/i;
export const STRIP_DOT_RE = /\.(NS|BO|NSE|BSE)$/i;
