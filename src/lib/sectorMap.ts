import companyMaster from './companyMaster.json';
import etfMaster from './etfMaster.json';

export type MarketCap = 'Large' | 'Mid' | 'Small';
export type AssetClass = 'Equity' | 'Commodity' | 'Debt' | 'ETF';

export interface StockMeta {
  sector: string;
  marketCap: MarketCap;
  assetClass: AssetClass;
  pe?: number;
  pb?: number;
  divYield?: number;
  industry?: string;
  mcap?: number;
  companyName?: string;
}

const DEFAULT_META: StockMeta = {
  sector: 'Others',
  marketCap: 'Mid',
  assetClass: 'Equity',
  pe: 20.0,
  pb: 2.5,
  divYield: 1.0,
};

// ─── Comprehensive NSE symbol → metadata map ──────────────────────────────────
const SECTOR_MAP: Record<string, StockMeta> = {
  // ── Large Cap — Banking & Financial Services ──────────────────────────────
  HDFCBANK:    { sector: 'Banking', marketCap: 'Large', assetClass: 'Equity' },
  ICICIBANK:   { sector: 'Banking', marketCap: 'Large', assetClass: 'Equity' },
  SBIN:        { sector: 'Banking', marketCap: 'Large', assetClass: 'Equity' },
  KOTAKBANK:   { sector: 'Banking', marketCap: 'Large', assetClass: 'Equity' },
  AXISBANK:    { sector: 'Banking', marketCap: 'Large', assetClass: 'Equity' },
  INDUSINDBK:  { sector: 'Banking', marketCap: 'Mid',   assetClass: 'Equity' },
  BANKBARODA:  { sector: 'Banking', marketCap: 'Mid',   assetClass: 'Equity' },
  PNB:         { sector: 'Banking', marketCap: 'Mid',   assetClass: 'Equity' },
  CANBK:       { sector: 'Banking', marketCap: 'Mid',   assetClass: 'Equity' },
  FEDERALBNK:  { sector: 'Banking', marketCap: 'Mid',   assetClass: 'Equity' },
  IDFCFIRSTB:  { sector: 'Banking', marketCap: 'Mid',   assetClass: 'Equity' },
  RBLBANK:     { sector: 'Banking', marketCap: 'Small',  assetClass: 'Equity' },
  YESBANK:     { sector: 'Banking', marketCap: 'Small',  assetClass: 'Equity' },

  // ── Large Cap — NBFC & Insurance ─────────────────────────────────────────
  BAJFINANCE:  { sector: 'Financial Services', marketCap: 'Large', assetClass: 'Equity' },
  BAJAJFINSV:  { sector: 'Financial Services', marketCap: 'Large', assetClass: 'Equity' },
  HDFCLIFE:    { sector: 'Financial Services', marketCap: 'Large', assetClass: 'Equity' },
  SBILIFE:     { sector: 'Financial Services', marketCap: 'Large', assetClass: 'Equity' },
  ICICIPRULI:  { sector: 'Financial Services', marketCap: 'Large', assetClass: 'Equity' },
  CHOLAFIN:    { sector: 'Financial Services', marketCap: 'Mid',   assetClass: 'Equity' },
  MUTHOOTFIN:  { sector: 'Financial Services', marketCap: 'Mid',   assetClass: 'Equity' },
  MANAPPURAM:  { sector: 'Financial Services', marketCap: 'Mid',   assetClass: 'Equity' },
  LICHSGFIN:   { sector: 'Financial Services', marketCap: 'Mid',   assetClass: 'Equity' },
  POONAWALLA:  { sector: 'Financial Services', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Large Cap — IT ────────────────────────────────────────────────────────
  TCS:         { sector: 'Information Technology', marketCap: 'Large', assetClass: 'Equity' },
  INFY:        { sector: 'Information Technology', marketCap: 'Large', assetClass: 'Equity' },
  WIPRO:       { sector: 'Information Technology', marketCap: 'Large', assetClass: 'Equity' },
  HCLTECH:     { sector: 'Information Technology', marketCap: 'Large', assetClass: 'Equity' },
  TECHM:       { sector: 'Information Technology', marketCap: 'Large', assetClass: 'Equity' },
  LTIM:        { sector: 'Information Technology', marketCap: 'Large', assetClass: 'Equity' },
  MPHASIS:     { sector: 'Information Technology', marketCap: 'Mid',   assetClass: 'Equity' },
  PERSISTENT:  { sector: 'Information Technology', marketCap: 'Mid',   assetClass: 'Equity' },
  COFORGE:     { sector: 'Information Technology', marketCap: 'Mid',   assetClass: 'Equity' },
  KPITTECH:    { sector: 'Information Technology', marketCap: 'Mid',   assetClass: 'Equity' },
  LTTS:        { sector: 'Information Technology', marketCap: 'Mid',   assetClass: 'Equity' },
  OFSS:        { sector: 'Information Technology', marketCap: 'Large', assetClass: 'Equity' },

  // ── Large Cap — Energy / Oil & Gas ───────────────────────────────────────
  RELIANCE:    { sector: 'Energy & Oil', marketCap: 'Large', assetClass: 'Equity' },
  ONGC:        { sector: 'Energy & Oil', marketCap: 'Large', assetClass: 'Equity' },
  IOC:         { sector: 'Energy & Oil', marketCap: 'Large', assetClass: 'Equity' },
  BPCL:        { sector: 'Energy & Oil', marketCap: 'Large', assetClass: 'Equity' },
  HINDPETRO:   { sector: 'Energy & Oil', marketCap: 'Mid',   assetClass: 'Equity' },
  PETRONET:    { sector: 'Energy & Oil', marketCap: 'Mid',   assetClass: 'Equity' },
  GAIL:        { sector: 'Energy & Oil', marketCap: 'Large', assetClass: 'Equity' },
  MGL:         { sector: 'Energy & Oil', marketCap: 'Mid',   assetClass: 'Equity' },
  IGL:         { sector: 'Energy & Oil', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Power & Renewables ────────────────────────────────────────────────────
  NTPC:        { sector: 'Power & Utilities', marketCap: 'Large', assetClass: 'Equity' },
  POWERGRID:   { sector: 'Power & Utilities', marketCap: 'Large', assetClass: 'Equity' },
  ADANIGREEN:  { sector: 'Power & Utilities', marketCap: 'Large', assetClass: 'Equity' },
  ADANIPOWER:  { sector: 'Power & Utilities', marketCap: 'Large', assetClass: 'Equity' },
  TATAPOWER:   { sector: 'Power & Utilities', marketCap: 'Mid',   assetClass: 'Equity' },
  CESC:        { sector: 'Power & Utilities', marketCap: 'Mid',   assetClass: 'Equity' },
  TORNTPOWER:  { sector: 'Power & Utilities', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Consumer / FMCG ──────────────────────────────────────────────────────
  HINDUNILVR:  { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  ITC:         { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  NESTLEIND:   { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  DABUR:       { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  MARICO:      { sector: 'FMCG', marketCap: 'Mid',   assetClass: 'Equity' },
  GODREJCP:    { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  COLPAL:      { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  EMAMILTD:    { sector: 'FMCG', marketCap: 'Mid',   assetClass: 'Equity' },
  TATACONSUM:  { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  BRITANNIA:   { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  VBL:         { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },

  // ── Automobile ───────────────────────────────────────────────────────────
  MARUTI:      { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  TATAMOTORS:  { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  M_M:         { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  'M&M':       { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  MM:          { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  BAJAJ_AUTO:  { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  BAJAJAUTO:   { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  HEROMOTOCO:  { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  EICHERMOT:   { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  TVS:         { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  TVSMOTOR:    { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  ASHOKLEY:    { sector: 'Automobiles', marketCap: 'Mid',   assetClass: 'Equity' },
  MOTHERSON:   { sector: 'Automobiles', marketCap: 'Mid',   assetClass: 'Equity' },
  BALKRISIND:  { sector: 'Automobiles', marketCap: 'Mid',   assetClass: 'Equity' },
  BOSCHLTD:    { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  TIINDIA:     { sector: 'Automobiles', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Pharma & Healthcare ───────────────────────────────────────────────────
  SUNPHARMA:   { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  DRREDDY:     { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  CIPLA:       { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  DIVISLAB:    { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  APOLLOHOSP:  { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  TORNTPHARM:  { sector: 'Pharma & Healthcare', marketCap: 'Mid',   assetClass: 'Equity' },
  AUROPHARMA:  { sector: 'Pharma & Healthcare', marketCap: 'Mid',   assetClass: 'Equity' },
  LUPIN:       { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  BIOCON:      { sector: 'Pharma & Healthcare', marketCap: 'Mid',   assetClass: 'Equity' },
  ALKEM:       { sector: 'Pharma & Healthcare', marketCap: 'Mid',   assetClass: 'Equity' },
  IPCALAB:     { sector: 'Pharma & Healthcare', marketCap: 'Mid',   assetClass: 'Equity' },
  MAXHEALTH:   { sector: 'Pharma & Healthcare', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Metals & Mining ───────────────────────────────────────────────────────
  TATASTEEL:   { sector: 'Metals & Mining', marketCap: 'Large', assetClass: 'Equity' },
  JSWSTEEL:    { sector: 'Metals & Mining', marketCap: 'Large', assetClass: 'Equity' },
  HINDALCO:    { sector: 'Metals & Mining', marketCap: 'Large', assetClass: 'Equity' },
  COALINDIA:   { sector: 'Metals & Mining', marketCap: 'Large', assetClass: 'Equity' },
  VEDL:        { sector: 'Metals & Mining', marketCap: 'Large', assetClass: 'Equity' },
  SAIL:        { sector: 'Metals & Mining', marketCap: 'Mid',   assetClass: 'Equity' },
  NMDC:        { sector: 'Metals & Mining', marketCap: 'Mid',   assetClass: 'Equity' },
  JINDALSTEL:  { sector: 'Metals & Mining', marketCap: 'Mid',   assetClass: 'Equity' },
  JSL:         { sector: 'Metals & Mining', marketCap: 'Mid',   assetClass: 'Equity' },
  NATIONALUM:  { sector: 'Metals & Mining', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Capital Goods & Infrastructure ───────────────────────────────────────
  LT:          { sector: 'Capital Goods', marketCap: 'Large', assetClass: 'Equity' },
  SIEMENS:     { sector: 'Capital Goods', marketCap: 'Large', assetClass: 'Equity' },
  ABB:         { sector: 'Capital Goods', marketCap: 'Large', assetClass: 'Equity' },
  BHEL:        { sector: 'Capital Goods', marketCap: 'Large', assetClass: 'Equity' },
  HAL:         { sector: 'Capital Goods', marketCap: 'Large', assetClass: 'Equity' },
  BEL:         { sector: 'Capital Goods', marketCap: 'Large', assetClass: 'Equity' },
  CUMMINSIND:  { sector: 'Capital Goods', marketCap: 'Mid',   assetClass: 'Equity' },
  THERMAX:     { sector: 'Capital Goods', marketCap: 'Mid',   assetClass: 'Equity' },
  GRINDWELL:   { sector: 'Capital Goods', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Cement ────────────────────────────────────────────────────────────────
  ULTRACEMCO:  { sector: 'Cement', marketCap: 'Large', assetClass: 'Equity' },
  SHREECEM:    { sector: 'Cement', marketCap: 'Large', assetClass: 'Equity' },
  AMBUJACEMENT:{ sector: 'Cement', marketCap: 'Large', assetClass: 'Equity' },
  ACCLTD:      { sector: 'Cement', marketCap: 'Large', assetClass: 'Equity' },
  JKCEMENT:    { sector: 'Cement', marketCap: 'Mid',   assetClass: 'Equity' },
  RAMCOCEM:    { sector: 'Cement', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Real Estate ───────────────────────────────────────────────────────────
  DLF:         { sector: 'Real Estate', marketCap: 'Large', assetClass: 'Equity' },
  GODREJPROP:  { sector: 'Real Estate', marketCap: 'Large', assetClass: 'Equity' },
  OBEROIRLTY:  { sector: 'Real Estate', marketCap: 'Mid',   assetClass: 'Equity' },
  PHOENIXLTD:  { sector: 'Real Estate', marketCap: 'Mid',   assetClass: 'Equity' },
  BRIGADE:     { sector: 'Real Estate', marketCap: 'Mid',   assetClass: 'Equity' },
  PRESTIGE:    { sector: 'Real Estate', marketCap: 'Mid',   assetClass: 'Equity' },
  SOBHA:       { sector: 'Real Estate', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Telecom ───────────────────────────────────────────────────────────────
  BHARTIARTL:  { sector: 'Telecom', marketCap: 'Large', assetClass: 'Equity' },
  IDEA:        { sector: 'Telecom', marketCap: 'Small',  assetClass: 'Equity' },
  TATACOMM:    { sector: 'Telecom', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Consumer Discretionary / Retail ──────────────────────────────────────
  TITAN:       { sector: 'Consumer Discretionary', marketCap: 'Large', assetClass: 'Equity' },
  TRENT:       { sector: 'Consumer Discretionary', marketCap: 'Large', assetClass: 'Equity' },
  DMART:       { sector: 'Consumer Discretionary', marketCap: 'Large', assetClass: 'Equity' },
  NYKAA:       { sector: 'Consumer Discretionary', marketCap: 'Mid',   assetClass: 'Equity' },
  ZOMATO:      { sector: 'Consumer Discretionary', marketCap: 'Large', assetClass: 'Equity' },
  PAYTM:       { sector: 'Consumer Discretionary', marketCap: 'Mid',   assetClass: 'Equity' },
  POLICYBZR:   { sector: 'Consumer Discretionary', marketCap: 'Mid',   assetClass: 'Equity' },
  JUBLFOOD:    { sector: 'Consumer Discretionary', marketCap: 'Mid',   assetClass: 'Equity' },
  DEVYANI:     { sector: 'Consumer Discretionary', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Chemicals ─────────────────────────────────────────────────────────────
  PIDILITIND:  { sector: 'Chemicals', marketCap: 'Large', assetClass: 'Equity' },
  ASIANPAINT:  { sector: 'Chemicals', marketCap: 'Large', assetClass: 'Equity' },
  BERGERPAINTS:{ sector: 'Chemicals', marketCap: 'Mid',   assetClass: 'Equity' },
  SRF:         { sector: 'Chemicals', marketCap: 'Mid',   assetClass: 'Equity' },
  DEEPAKNTR:   { sector: 'Chemicals', marketCap: 'Mid',   assetClass: 'Equity' },
  AARTIIND:    { sector: 'Chemicals', marketCap: 'Mid',   assetClass: 'Equity' },
  GALAXYSURF:  { sector: 'Chemicals', marketCap: 'Mid',   assetClass: 'Equity' },
  NAVINFLUOR:  { sector: 'Chemicals', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Commodity ETFs ────────────────────────────────────────────────────────
  GOLDBEES:    { sector: 'Gold ETF',     marketCap: 'Large', assetClass: 'Commodity' },
  GOLDIETF:    { sector: 'Gold ETF',     marketCap: 'Large', assetClass: 'Commodity' },
  ICICIGOLD:   { sector: 'Gold ETF',     marketCap: 'Large', assetClass: 'Commodity' },
  HDFCGOLD:    { sector: 'Gold ETF',     marketCap: 'Large', assetClass: 'Commodity' },
  AXISGOLD:    { sector: 'Gold ETF',     marketCap: 'Large', assetClass: 'Commodity' },
  SILVERBEES:  { sector: 'Silver ETF',   marketCap: 'Mid',   assetClass: 'Commodity' },
  SILVERETF:   { sector: 'Silver ETF',   marketCap: 'Mid',   assetClass: 'Commodity' },

  // ── Index ETFs ────────────────────────────────────────────────────────────
  NIFTYBEES:   { sector: 'Index ETF', marketCap: 'Large', assetClass: 'ETF' },
  JUNIORBEES:  { sector: 'Index ETF', marketCap: 'Mid',   assetClass: 'ETF' },
  SETFNIF50:   { sector: 'Index ETF', marketCap: 'Large', assetClass: 'ETF' },
  MOM100:      { sector: 'Index ETF', marketCap: 'Large', assetClass: 'ETF' },
  BANKBEES:    { sector: 'Index ETF', marketCap: 'Large', assetClass: 'ETF' },
  ITBEES:      { sector: 'Index ETF', marketCap: 'Large', assetClass: 'ETF' },
  CPSE:        { sector: 'Index ETF', marketCap: 'Mid',   assetClass: 'ETF' },
  LIQUIDBEES:  { sector: 'Liquid ETF', marketCap: 'Large', assetClass: 'Debt' },

  // ── Adani Group ───────────────────────────────────────────────────────────
  ADANIENT:    { sector: 'Conglomerate', marketCap: 'Large', assetClass: 'Equity' },
  ADANIPORTS:  { sector: 'Infrastructure', marketCap: 'Large', assetClass: 'Equity' },
  ADANITRANS:  { sector: 'Power & Utilities', marketCap: 'Large', assetClass: 'Equity' },
  ATGL:        { sector: 'Energy & Oil', marketCap: 'Large', assetClass: 'Equity' },

  // ── Tata Group (not already listed) ──────────────────────────────────────
  TATAELXSI:  { sector: 'Information Technology', marketCap: 'Mid',   assetClass: 'Equity' },
  TATATECH:   { sector: 'Information Technology', marketCap: 'Mid',   assetClass: 'Equity' },
  TATACHEM:   { sector: 'Chemicals',              marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Others ────────────────────────────────────────────────────────────────
  IRCTC:       { sector: 'Tourism & Travel',   marketCap: 'Large', assetClass: 'Equity' },
  INDIGO:      { sector: 'Aviation',           marketCap: 'Large', assetClass: 'Equity' },
  INTERGLOBE:  { sector: 'Aviation',           marketCap: 'Large', assetClass: 'Equity' },
  ZEEL:        { sector: 'Media',              marketCap: 'Mid',   assetClass: 'Equity' },
  SUNCLAYLTD:  { sector: 'Media',              marketCap: 'Small', assetClass: 'Equity' },
  DIXON:       { sector: 'Electronics',        marketCap: 'Mid',   assetClass: 'Equity' },
  DELHIVERY:   { sector: 'Logistics',          marketCap: 'Mid',   assetClass: 'Equity' },
  CONCOR:      { sector: 'Logistics',          marketCap: 'Mid',   assetClass: 'Equity' },
  APOLLOTYRE:  { sector: 'Automobiles',        marketCap: 'Mid',   assetClass: 'Equity' },
  CEAT:        { sector: 'Automobiles',        marketCap: 'Mid',   assetClass: 'Equity' },
  WHIRLPOOL:   { sector: 'Consumer Durables',  marketCap: 'Mid',   assetClass: 'Equity' },
  HAVELLS:     { sector: 'Consumer Durables',  marketCap: 'Large', assetClass: 'Equity' },
  CROMPTON:    { sector: 'Consumer Durables',  marketCap: 'Mid',   assetClass: 'Equity' },
  VOLTAS:      { sector: 'Consumer Durables',  marketCap: 'Mid',   assetClass: 'Equity' },
  BLUESTARCO:  { sector: 'Consumer Durables',  marketCap: 'Mid',   assetClass: 'Equity' },
  ATUL:        { sector: 'Chemicals',          marketCap: 'Mid',   assetClass: 'Equity' },
  PIIND:       { sector: 'Chemicals',          marketCap: 'Mid',   assetClass: 'Equity' },
  LINDEINDIA:  { sector: 'Chemicals',          marketCap: 'Mid',   assetClass: 'Equity' },
};

function standardizeSector(rawSector: string): string {
  if (!rawSector) return 'Others';
  const sector = rawSector.toLowerCase().trim();
  
  if (sector.includes('bank')) return 'Banking';
  if (sector.includes('information technology') || sector.includes('it - software') || sector.includes('it - hardware') || sector.includes('software')) return 'Information Technology';
  if (sector.includes('fmcg') || sector.includes('food') || sector.includes('dairy') || sector.includes('personal care') || sector.includes('beverages') || sector.includes('dry cells') || sector.includes('sugar') || sector.includes('tobacco') || sector.includes('restaurant')) return 'FMCG';
  
  // Financial Services (FIXED: added financial, insurance, broker, rating)
  if (sector.includes('finance') || sector.includes('financial') || sector.includes('nbfc') || sector.includes('leasing') || sector.includes('insurance') || sector.includes('broker') || sector.includes('rating')) return 'Financial Services';
  
  if (sector.includes('oil') || sector.includes('petro') || sector.includes('gas') || sector.includes('energy') || sector.includes('refin')) return 'Energy & Oil';
  if (sector.includes('pharma') || sector.includes('health') || sector.includes('drug') || sector.includes('hospital')) return 'Pharma & Healthcare';
  if (sector.includes('auto') || sector.includes('car') || sector.includes('tyre')) return 'Automobiles';
  if (sector.includes('metal') || sector.includes('mining') || sector.includes('steel') || sector.includes('iron') || sector.includes('ferro') || sector.includes('mineral')) return 'Metals & Mining';
  
  // Capital Goods (FIXED: added defence, aerospace, cables, bearings, forgings, castings, railways, refractories, packaging, ship, glass, ceramic, plywood)
  if (sector.includes('capital goods') || sector.includes('engineer') || sector.includes('machinery') || sector.includes('equipment') || sector.includes('defence') || sector.includes('aerospace') || sector.includes('cables') || sector.includes('bearings') || sector.includes('forgings') || sector.includes('castings') || sector.includes('railways') || sector.includes('refractories') || sector.includes('packaging') || sector.includes('ship') || sector.includes('glass') || sector.includes('ceramic') || sector.includes('plywood')) return 'Capital Goods';
  
  if (sector.includes('power') || sector.includes('utilit') || sector.includes('electric') || sector.includes('renew')) return 'Power & Utilities';
  if (sector.includes('cement')) return 'Cement';
  if (sector.includes('realty') || sector.includes('real estate') || sector.includes('construct')) return 'Real Estate';
  if (sector.includes('telecom')) return 'Telecom';
  
  // Consumer Discretionary (FIXED: added electronic, e-commerce, aggregator)
  if (sector.includes('retail') || sector.includes('consumer durable') || sector.includes('jeweller') || sector.includes('entertainment') || sector.includes('media') || sector.includes('hotel') || sector.includes('tourism') || sector.includes('electronic') || sector.includes('e-commerce') || sector.includes('aggregator')) return 'Consumer Discretionary';
  
  // Chemicals (FIXED: added fertilizer, paint, varnish)
  if (sector.includes('chemical') || sector.includes('dye') || sector.includes('plastic') || sector.includes('paint') || sector.includes('varnish') || sector.includes('fertilizer')) return 'Chemicals';
  
  // NEW: Logistics & Transportation
  if (sector.includes('logistics') || sector.includes('shipping') || sector.includes('transport') || sector.includes('aviation') || sector.includes('port')) return 'Logistics & Transportation';
  
  // NEW: Textiles & Apparel
  if (sector.includes('textile') || sector.includes('garment') || sector.includes('apparel')) return 'Textiles & Apparel';
  
  if (sector.includes('infrastructure')) return 'Infrastructure';
  if (sector.includes('diversified')) return 'Conglomerate';
  
  return 'Others';
}

function standardizeEtfCategory(category: string, etfName: string): { sector: string, assetClass: AssetClass } {
  const cat = (category || '').toLowerCase().trim();
  const name = (etfName || '').toLowerCase().trim();
  
  if (cat.includes('commodity')) {
    if (name.includes('silver')) {
      return { sector: 'Silver ETF', assetClass: 'Commodity' };
    }
    return { sector: 'Gold ETF', assetClass: 'Commodity' };
  }
  
  if (cat.includes('debt')) {
    return { sector: 'Liquid ETF', assetClass: 'Debt' };
  }
  
  // Default to standard Index ETF
  return { sector: 'Index ETF', assetClass: 'ETF' };
}

/**
 * Looks up metadata for a given NSE symbol.
 * Falls back to DEFAULT_META for unknown symbols.
 */
export function getStockMeta(symbolOrNse: string | null | undefined, stockSymbol?: string | null | undefined): StockMeta {
  const cleanNse = symbolOrNse && symbolOrNse !== 'null' && symbolOrNse !== 'undefined' ? symbolOrNse.trim() : '';
  const cleanStock = stockSymbol && stockSymbol !== 'null' && stockSymbol !== 'undefined' ? stockSymbol.trim() : '';
  
  const symbol = cleanNse || cleanStock;
  if (!symbol) return DEFAULT_META;

  const upper = symbol.toUpperCase().replace(/-EQ$/, '').replace(/\.NS$/, '');
  
  // 1. Check custom overrides SECTOR_MAP first (holds specialised ETF metadata)
  const customMeta = SECTOR_MAP[upper];
  
  let meta: StockMeta;
  
  if (customMeta) {
    meta = customMeta;
  } else {
    // 2. Query the comprehensive CMOTS ETF Master database
    let etfIdx = (etfMaster.isin as Record<string, number>)[upper];
    if (etfIdx === undefined) {
      etfIdx = (etfMaster.ticker as Record<string, number>)[upper];
    }
    
    if (etfIdx !== undefined) {
      const etf = etfMaster.etfs[etfIdx];
      const etfName = etf[0] as string;
      const etfCategory = etf[1] as string;
      const { sector, assetClass } = standardizeEtfCategory(etfCategory, etfName);
      meta = {
        sector,
        marketCap: 'Large',
        assetClass,
        industry: etfName,
        companyName: etfName
      };
    } else {
      // 3. Query the comprehensive CMOTS Company Master database
      let companyIdx = (companyMaster.nse as Record<string, number>)[upper];
      if (companyIdx === undefined) {
        companyIdx = (companyMaster.bse as Record<string, number>)[upper];
      }
      
      if (companyIdx !== undefined) {
        const company = companyMaster.companies[companyIdx];
        const rawSector = company[1] as string;
        const mcapType = company[2] as MarketCap;
        const mcapVal = company[3] as number;
        const industryname = company[4] as string;
        meta = {
          sector: standardizeSector(rawSector),
          marketCap: mcapType,
          assetClass: 'Equity',
          industry: industryname,
          mcap: mcapVal,
          companyName: company[0] as string
        };
      } else {
        // 4. Fallback to default
        meta = DEFAULT_META;
      }
    }
  }
  
  // Specific stock overrides for maximum real-world accuracy
  const stockOverrides: Record<string, { pe: number, pb: number, divYield: number }> = {
    RELIANCE: { pe: 26.5, pb: 2.4, divYield: 0.4 },
    TCS: { pe: 30.2, pb: 8.1, divYield: 2.4 },
    HDFCBANK: { pe: 17.5, pb: 2.6, divYield: 1.2 },
    ICICIBANK: { pe: 18.2, pb: 3.1, divYield: 0.8 },
    INFY: { pe: 25.3, pb: 6.2, divYield: 2.6 },
    COALINDIA: { pe: 9.2, pb: 2.1, divYield: 5.8 },
    ITC: { pe: 28.4, pb: 7.8, divYield: 3.65 },
    SBIN: { pe: 10.4, pb: 1.5, divYield: 1.8 },
  };

  // Sector-based realistic defaults
  const sectorDefaults: Record<string, { pe: number, pb: number, divYield: number }> = {
    'Banking': { pe: 15.5, pb: 2.0, divYield: 1.5 },
    'Information Technology': { pe: 27.2, pb: 7.0, divYield: 2.2 },
    'FMCG': { pe: 41.5, pb: 10.2, divYield: 1.9 },
    'Financial Services': { pe: 21.8, pb: 3.4, divYield: 0.7 },
    'Energy & Oil': { pe: 12.2, pb: 1.7, divYield: 3.3 },
    'Pharma & Healthcare': { pe: 30.5, pb: 4.6, divYield: 0.8 },
    'Automobiles': { pe: 23.5, pb: 3.5, divYield: 1.1 },
    'Metals & Mining': { pe: 11.2, pb: 1.5, divYield: 4.4 },
    'Capital Goods': { pe: 37.8, pb: 6.0, divYield: 0.6 },
    'Power & Utilities': { pe: 17.5, pb: 2.1, divYield: 2.4 },
    'Cement': { pe: 27.5, pb: 3.0, divYield: 0.9 },
    'Real Estate': { pe: 44.5, pb: 4.0, divYield: 0.2 },
    'Telecom': { pe: 34.5, pb: 5.2, divYield: 0.1 },
    'Consumer Discretionary': { pe: 47.5, pb: 8.2, divYield: 0.4 },
    'Chemicals': { pe: 35.8, pb: 5.6, divYield: 0.7 },
    'Gold ETF': { pe: 0, pb: 0, divYield: 0 },
    'Silver ETF': { pe: 0, pb: 0, divYield: 0 },
    'Index ETF': { pe: 22.0, pb: 3.5, divYield: 1.2 },
    'Liquid ETF': { pe: 0, pb: 0, divYield: 6.2 },
    'Others': { pe: 20.0, pb: 2.5, divYield: 1.0 },
  };

  const override = stockOverrides[upper];
  const defaults = sectorDefaults[meta.sector] ?? sectorDefaults['Others'];
  
  return {
    ...meta,
    pe: meta.pe ?? override?.pe ?? defaults.pe,
    pb: meta.pb ?? override?.pb ?? defaults.pb,
    divYield: meta.divYield ?? override?.divYield ?? defaults.divYield,
  };
}

export function getAllMeta(symbols: string[]): StockMeta[] {
  return symbols.map(s => getStockMeta(s));
}

export function resolvePriceTicker(
  nseSymbol: string | null | undefined,
  stockSymbol?: string | null | undefined,
  companyName?: string | null | undefined
): string[] {
  const symbol = (nseSymbol || stockSymbol || '')
    .trim()
    .toUpperCase()
    .replace(/-EQ$/, '')
    .replace(/\.NS$/, '')
    .replace(/\.BO$/, '');
  if (!symbol) return [];

  // Default candidates: try NSE first, then BSE symbol directly
  const candidates: string[] = [`${symbol}.NS`, `${symbol}.BO`];

  // 1. Check in companyMaster
  let companyIdx: number | undefined = (companyMaster as any).nse[symbol];
  
  // If not found by exact NSE symbol, search by company name or symbol in companyMaster
  if (companyIdx === undefined && companyName) {
    const cleanName = companyName.toLowerCase().trim();
    companyIdx = (companyMaster as any).companies.findIndex((c: any) => 
      c[0].toLowerCase().includes(cleanName) || 
      (c[7] && c[7].toLowerCase().includes(cleanName))
    );
    if (companyIdx === -1) companyIdx = undefined;
  }

  // If still not found, check by shortname/similar symbol (Fuzzy search)
  if (companyIdx === undefined) {
    const symbolLower = symbol.toLowerCase();
    companyIdx = (companyMaster as any).companies.findIndex((c: any) => {
      const shortName = c[7] ? c[7].toLowerCase().replace(/\s/g, '') : '';
      const compName = c[0] ? c[0].toLowerCase().replace(/\s/g, '') : '';
      return (
        shortName.includes(symbolLower) || 
        symbolLower.includes(shortName) || 
        compName.includes(symbolLower)
      );
    });
    if (companyIdx === -1) companyIdx = undefined;
  }

  if (companyIdx !== undefined) {
    const company = (companyMaster as any).companies[companyIdx];
    const nseStatus = company[8] as string;
    
    // Find BSE Code for this company index
    let bseCode = '';
    for (const [k, v] of Object.entries((companyMaster as any).bse)) {
      if (v === companyIdx) {
        bseCode = k;
        break;
      }
    }

    if (bseCode) {
      if (nseStatus === 'Not Listed' || nseStatus === 'Delisted' || nseStatus === 'Suspended') {
        // BSE is the active market! Put BSE candidate first!
        candidates.unshift(`${bseCode}.BO`);
      } else {
        // BSE as secondary fallback
        candidates.push(`${bseCode}.BO`);
      }
    }
  }

  // Add BSE code directly if symbol is numeric (BSE code)
  if (/^\d+$/.test(symbol)) {
    candidates.unshift(`${symbol}.BO`);
  }

  // Add specific overrides
  if (symbol === 'NSDL') {
    candidates.unshift('NSDL.BO'); // FIXED: NSDL Yahoo Ticker is NSDL.BO
  }

  // Ensure unique candidates
  return Array.from(new Set(candidates));
}

/**
 * Formats a stock/ETF ticker symbol for frontend display.
 * - Strips Yahoo Finance suffixes (.NS, .BO).
 * - Maps numeric BSE codes back to user-friendly text symbols using companyMaster or Firestore company_name.
 */
export function cleanSymbol(
  symbolOrObj: string | { nse_symbol?: string | null; stock_symbol?: string | null; company_name?: string | null } | null | undefined
): string {
  if (!symbolOrObj) return '';

  let sym = '';
  let companyName = '';

  if (typeof symbolOrObj === 'object') {
    sym = (symbolOrObj.nse_symbol || symbolOrObj.stock_symbol || '').trim();
    companyName = (symbolOrObj.company_name || '').trim();
  } else {
    sym = symbolOrObj.trim();
  }

  if (!sym) return '';

  // 1. Strip standard exchange suffixes
  const clean = sym.replace(/\.NS$/, '').replace(/\.BO$/, '');

  // 2. If it is numeric (a BSE code), resolve it to a text ticker
  if (/^\d+$/.test(clean)) {
    // If the database has a nice original symbol stored in company_name (e.g. 'TITANSEC'), use it!
    if (companyName && !/^\d+$/.test(companyName)) {
      return companyName.toUpperCase();
    }
    // Otherwise look up in companyMaster by BSE code
    const companyIdx = (companyMaster.bse as Record<string, number>)[clean];
    if (companyIdx !== undefined) {
      const company = companyMaster.companies[companyIdx];
      const shortName = company[7] as string;
      const compName = company[0] as string;
      // Strip spaces and uppercase
      const targetName = (shortName || compName || '').replace(/\s/g, '').toUpperCase();
      if (targetName && !/^\d+$/.test(targetName)) {
        return targetName;
      }
    }
  }

  return clean;
}

