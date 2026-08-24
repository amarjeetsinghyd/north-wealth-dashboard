import companyMaster from './companyMaster.json';
import etfMaster from './etfMaster.json';

export type CompanyTuple = (string | number | null)[];

export interface CompanyMaster {
  nse: Record<string, number>;
  bse: Record<string, number>;
  isin: Record<string, number>;
  companies: CompanyTuple[];
}

export { companyMaster, etfMaster };

export type MarketCap = 'Large' | 'Mid' | 'Small';
export type AssetClass = 'Equity' | 'Commodity' | 'Debt' | 'ETF' | 'Mutual Fund';

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
  listingStatus?: 'Active' | 'Delisted' | 'BSE Only' | 'Suspended' | 'Unlisted';
  statusReason?: string;
}

const DEFAULT_META: StockMeta = {
  sector: 'Others',
  marketCap: 'Mid',
  assetClass: 'Equity',
  pe: 20.0,
  pb: 2.5,
  divYield: 1.0,
  listingStatus: 'Active',
  statusReason: 'Standard active listing',
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
  HDBFSL:      { sector: 'Financial Services', marketCap: 'Mid',   assetClass: 'Equity' },

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
  TATAPOWER:   { sector: 'Power & Utilities', marketCap: 'Large', assetClass: 'Equity' },
  JSWENERGY:   { sector: 'Power & Utilities', marketCap: 'Large', assetClass: 'Equity' },
  NHPC:        { sector: 'Power & Utilities', marketCap: 'Mid',   assetClass: 'Equity' },
  SJVN:        { sector: 'Power & Utilities', marketCap: 'Mid',   assetClass: 'Equity' },
  SUZLON:      { sector: 'Power & Utilities', marketCap: 'Mid',   assetClass: 'Equity' },
  TORNTPOWER:  { sector: 'Power & Utilities', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── FMCG & Retail ─────────────────────────────────────────────────────────
  HINDUNILVR:  { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  ITC:         { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  NESTLEIND:   { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  BRITANNIA:   { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  TATACONSUM:  { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  DABUR:       { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  MARICO:      { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  GODREJCP:    { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  COLPAL:      { sector: 'FMCG', marketCap: 'Mid',   assetClass: 'Equity' },
  VARUN:       { sector: 'FMCG', marketCap: 'Large', assetClass: 'Equity' },
  EMAMILTD:    { sector: 'FMCG', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Automobiles & Auto Ancillaries ────────────────────────────────────────
  MARUTI:      { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  'M&M':       { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  TATAMOTORS:  { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  BAJAJ_AUTO:  { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  EICHERMOT:   { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  HEROMOTOCO:  { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  TVSMOTOR:    { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  BHARATFORG:  { sector: 'Automobiles', marketCap: 'Mid',   assetClass: 'Equity' },
  MOTHERSON:   { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  BOSCHLTD:    { sector: 'Automobiles', marketCap: 'Large', assetClass: 'Equity' },
  MRF:         { sector: 'Automobiles', marketCap: 'Mid',   assetClass: 'Equity' },
  BALKRISIND:  { sector: 'Automobiles', marketCap: 'Mid',   assetClass: 'Equity' },
  SONACOMS:    { sector: 'Automobiles', marketCap: 'Mid',   assetClass: 'Equity' },

  // ── Pharmaceuticals & Healthcare ──────────────────────────────────────────
  SUNPHARMA:   { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  CIPLA:       { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  DRREDDY:     { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  DIVISLAB:    { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  APOLLOHOSP:  { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  LUPIN:       { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  TORNTPHARM:  { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  ZYDUSLIFE:   { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  AUROPHARMA:  { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  MANKIND:     { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'Equity' },
  ALKEM:       { sector: 'Pharma & Healthcare', marketCap: 'Mid',   assetClass: 'Equity' },
  FORTIS:      { sector: 'Pharma & Healthcare', marketCap: 'Mid',   assetClass: 'Equity' },
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

  // ── Commodity & Sector ETFs ──────────────────────────────────────────────
  GOLDBEES:    { sector: 'Precious Metals', marketCap: 'Large', assetClass: 'Commodity' },
  GOLDIETF:    { sector: 'Precious Metals', marketCap: 'Large', assetClass: 'Commodity' },
  ICICIGOLD:   { sector: 'Precious Metals', marketCap: 'Large', assetClass: 'Commodity' },
  HDFCGOLD:    { sector: 'Precious Metals', marketCap: 'Large', assetClass: 'Commodity' },
  AXISGOLD:    { sector: 'Precious Metals', marketCap: 'Large', assetClass: 'Commodity' },
  SILVERBEES:  { sector: 'Precious Metals', marketCap: 'Mid',   assetClass: 'Commodity' },
  SILVERETF:   { sector: 'Precious Metals', marketCap: 'Mid',   assetClass: 'Commodity' },
  SILVERIETF:  { sector: 'Precious Metals', marketCap: 'Mid',   assetClass: 'Commodity' },
  HDFCSILVER:  { sector: 'Precious Metals', marketCap: 'Mid',   assetClass: 'Commodity' },
  METALIETF:   { sector: 'Metals & Mining', marketCap: 'Mid',   assetClass: 'ETF' },
  HDFCMETAL:   { sector: 'Metals & Mining', marketCap: 'Mid',   assetClass: 'ETF' },
  AUTOBEES:    { sector: 'Automobiles',     marketCap: 'Large', assetClass: 'ETF' },
  PHARMABEES:  { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'ETF' },
  HEALTHY:     { sector: 'Pharma & Healthcare', marketCap: 'Large', assetClass: 'ETF' },
  CONSUMBEES:  { sector: 'FMCG',            marketCap: 'Large', assetClass: 'ETF' },
  INFRABEES:   { sector: 'Infrastructure',  marketCap: 'Large', assetClass: 'ETF' },

  // ── Index ETFs ────────────────────────────────────────────────────────────
  NIFTYBEES:    { sector: 'Broad Market Index', marketCap: 'Large', assetClass: 'ETF' },
  JUNIORBEES:   { sector: 'Broad Market Index', marketCap: 'Mid',   assetClass: 'ETF' },
  SETFNIF50:    { sector: 'Broad Market Index', marketCap: 'Large', assetClass: 'ETF' },
  MOM100:       { sector: 'Broad Market Index', marketCap: 'Large', assetClass: 'ETF' },
  BANKBEES:     { sector: 'Banking',            marketCap: 'Large', assetClass: 'ETF' },
  ITBEES:       { sector: 'Information Technology', marketCap: 'Large', assetClass: 'ETF' },
  CPSE:         { sector: 'Broad Market Index', marketCap: 'Mid',   assetClass: 'ETF' },
  CPSEETF:      { sector: 'Broad Market Index', marketCap: 'Mid',   assetClass: 'ETF' },
  MID150BEES:   { sector: 'Broad Market Index', marketCap: 'Mid',   assetClass: 'ETF' },
  HDFCSML250:   { sector: 'Broad Market Index', marketCap: 'Small', assetClass: 'ETF' },
  MON100:       { sector: 'Broad Market Index', marketCap: 'Large', assetClass: 'ETF' },
  MAFANG:       { sector: 'Global Markets',     marketCap: 'Large', assetClass: 'ETF' },
  // ── Midcap ETFs
  MIDCAPETF:    { sector: 'Broad Market Index', marketCap: 'Mid',   assetClass: 'ETF' },
  MIDCAP150:    { sector: 'Broad Market Index', marketCap: 'Mid',   assetClass: 'ETF' },
  MID150IETF:   { sector: 'Broad Market Index', marketCap: 'Mid',   assetClass: 'ETF' },
  MON150:       { sector: 'Broad Market Index', marketCap: 'Mid',   assetClass: 'ETF' },
  SBIETFMID150: { sector: 'Broad Market Index', marketCap: 'Mid',   assetClass: 'ETF' },
  // ── Next 50 ETFs
  NEXT50IETF:   { sector: 'Broad Market Index', marketCap: 'Large', assetClass: 'ETF' },
  GROWWNEXT50:  { sector: 'Broad Market Index', marketCap: 'Large', assetClass: 'ETF' },
  DSPNXT50:     { sector: 'Broad Market Index', marketCap: 'Large', assetClass: 'ETF' },
  KOTAKNXT50:   { sector: 'Broad Market Index', marketCap: 'Large', assetClass: 'ETF' },
  // ── Groww Sector ETFs
  GROWWHOSPI:   { sector: 'Healthcare',         marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWPSU:     { sector: 'Public Sector',      marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWPSUBK:   { sector: 'Banking',            marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWPVTBK:   { sector: 'Banking',            marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWMETAL:   { sector: 'Metals & Mining',    marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWCHEM:    { sector: 'Chemicals',          marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWREALTY:  { sector: 'Realty',             marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWCAPMKT:  { sector: 'Financial Services', marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWSML250:  { sector: 'Broad Market Index', marketCap: 'Small', assetClass: 'ETF' },
  GROWWDEF:     { sector: 'Aerospace & Defence',marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWEV:      { sector: 'Automobiles',        marketCap: 'Mid',   assetClass: 'ETF' },
  GROWWGOLD:    { sector: 'Precious Metals',    marketCap: 'Mid',   assetClass: 'Commodity' },
  GROWWSILVER:  { sector: 'Precious Metals',    marketCap: 'Mid',   assetClass: 'Commodity' },
  GROWWNIFTY50: { sector: 'Broad Market Index', marketCap: 'Large', assetClass: 'ETF' },

  // ── Liquid & Debt ETFs ───────────────────────────────────────────────────
  LIQUIDBEES:  { sector: 'Liquid Funds / Debt', marketCap: 'Large', assetClass: 'Debt' },
  LIQUIDCASE:  { sector: 'Liquid Funds / Debt', marketCap: 'Large', assetClass: 'Debt' },
  LIQUIDETF:   { sector: 'Liquid Funds / Debt', marketCap: 'Large', assetClass: 'Debt' },
  HDFCLIQUID:  { sector: 'Liquid Funds / Debt', marketCap: 'Large', assetClass: 'Debt' },
  ICICILIQ:    { sector: 'Liquid Funds / Debt', marketCap: 'Large', assetClass: 'Debt' },
  BHARATBOND:  { sector: 'Debt',                marketCap: 'Large', assetClass: 'Debt' },

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
  
  if (name.includes('silver') || name.includes('gold')) return { sector: 'Precious Metals', assetClass: 'Commodity' };
  if (name.includes('metal')) return { sector: 'Metals & Mining', assetClass: 'ETF' };
  if (name.includes('bank')) return { sector: 'Banking', assetClass: 'ETF' };
  if (name.includes('it ') || name.includes(' it') || name.includes('tech') || name.includes('software')) return { sector: 'Information Technology', assetClass: 'ETF' };
  if (name.includes('pharma') || name.includes('health')) return { sector: 'Pharma & Healthcare', assetClass: 'ETF' };
  if (name.includes('auto')) return { sector: 'Automobiles', assetClass: 'ETF' };
  if (name.includes('infra')) return { sector: 'Infrastructure', assetClass: 'ETF' };
  if (name.includes('fmcg') || name.includes('consum')) return { sector: 'FMCG', assetClass: 'ETF' };
  if (name.includes('commodity')) return { sector: 'Metals & Mining', assetClass: 'Commodity' };
  
  if (cat.includes('debt') || name.includes('liquid') || name.includes('gilt') || name.includes('overnight') || name.includes('money market')) {
    return { sector: 'Liquid Funds / Debt', assetClass: 'Debt' };
  }
  
  // Default for Nifty 50, Next 50, 100, 200, 500, etc.
  return { sector: 'Broad Market Index', assetClass: 'ETF' };
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
  
  let meta: StockMeta = DEFAULT_META;
  
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
      if (etf && etf[0] && etf[1]) {
        const etfName = etf[0] as string;
        const etfCategory = etf[1] as string;
        // etf[3] is the explicit Sector column from the CSV master — prefer it over the name heuristic
        const explicitSector = (etf[3] as string | undefined)?.trim();
        const { sector: heuristicSector, assetClass } = standardizeEtfCategory(etfCategory, etfName);
        const sector = explicitSector || heuristicSector;
        meta = {
          sector,
          marketCap: 'Large',
          assetClass,
          industry: etfName,
          companyName: etfName,
          listingStatus: 'Active',
          statusReason: 'Active ETF trading on exchange'
        };
      }
    } else {
      // 3. Query the comprehensive CMOTS Company Master database
      let companyIdx = (companyMaster.nse as Record<string, number>)[upper];
      if (companyIdx === undefined) {
        companyIdx = (companyMaster.bse as Record<string, number>)[upper];
      }
      
      if (companyIdx !== undefined) {
        const company = companyMaster.companies[companyIdx] as CompanyTuple;
        if (company && company[0] && company[1] && company[2] && company[3] && company[4]) {
          const rawSector = company[1] as string;
          const mcapType = company[2] as MarketCap;
          const mcapVal = company[3] as number;
          const industryname = company[4] as string;
          
          const nseStatus = (company[8] as string || '').trim();
          const bseStatus = (company[9] as string || '').trim();

          let listingStatus: 'Active' | 'Delisted' | 'BSE Only' | 'Suspended' | 'Unlisted' = 'Active';
          let statusReason = 'Actively traded on exchange';

          if (nseStatus.toLowerCase() === 'delisted' && bseStatus.toLowerCase() === 'delisted') {
            listingStatus = 'Delisted';
            statusReason = 'Delisted from both NSE and BSE';
          } else if (nseStatus.toLowerCase() === 'suspended' || bseStatus.toLowerCase() === 'suspended') {
            listingStatus = 'Suspended';
            statusReason = 'Trading temporarily suspended by exchange';
          } else if (nseStatus.toLowerCase() === 'not listed' && bseStatus.toLowerCase() === 'active') {
            listingStatus = 'BSE Only';
            statusReason = 'Not listed on NSE (traded on BSE)';
          } else if (nseStatus.toLowerCase() === 'not listed' && (bseStatus.toLowerCase() === 'not listed' || !bseStatus)) {
            listingStatus = 'Unlisted';
            statusReason = 'Unlisted equity shares';
          }
          
          const rawSectorClean = rawSector ? standardizeSector(rawSector) : 'Others';
          const finalSector = rawSectorClean !== 'Inactive' && rawSectorClean !== '' ? rawSectorClean : 'Others';
                              
          meta = {
            sector: finalSector,
            marketCap: mcapType || 'Mid',
            assetClass: 'Equity',
            industry: industryname || finalSector,
            mcap: mcapVal,
            companyName: company[0] as string,
            listingStatus,
            statusReason
          };
        }
      } else {
        // 4. Fallback to Mutual Fund (assuming unknown entries in statements are Mutual Funds)
        meta = {
          ...DEFAULT_META,
          sector: 'Mutual Fund',
          assetClass: 'Mutual Fund',
          listingStatus: 'Active',
          statusReason: 'Mutual Fund Scheme'
        };
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
    'Mutual Fund': { pe: 0, pb: 0, divYield: 0 },
    'Active': { pe: 20.0, pb: 2.5, divYield: 1.0 },
    'Inactive': { pe: 0, pb: 0, divYield: 0 },
    'Others': { pe: 20.0, pb: 2.5, divYield: 1.0 },
  };

  const override = stockOverrides[upper];
  const defaults = sectorDefaults[meta.sector] ?? sectorDefaults['Others'] ?? { pe: 20.0, pb: 2.5, divYield: 1.0 };
  
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
  let companyIdx: number | undefined = (companyMaster as CompanyMaster).nse[symbol];
  
  // If not found by exact NSE symbol, search by company name or symbol in companyMaster
  if (companyIdx === undefined && companyName) {
    const cleanName = companyName.toLowerCase().trim();
    companyIdx = (companyMaster as CompanyMaster).companies.findIndex((c: CompanyTuple) => {
      if (!c) return false;
      const c0 = String(c[0] || '').toLowerCase();
      const c7 = String(c[7] || '').toLowerCase();
      return c0.includes(cleanName) || (c7 !== '' && c7.includes(cleanName));
    });
    if (companyIdx === -1) companyIdx = undefined;
  }

  // If still not found, check by shortname/similar symbol (Fuzzy search)
  if (companyIdx === undefined) {
    const symbolLower = symbol.toLowerCase();
    companyIdx = (companyMaster as CompanyMaster).companies.findIndex((c: CompanyTuple) => {
      if (!c) return false;
      const shortName = c[7] ? String(c[7]).toLowerCase().replace(/\s/g, '') : '';
      const compName = c[0] ? String(c[0]).toLowerCase().replace(/\s/g, '') : '';
      return (
        (shortName !== '' && shortName.includes(symbolLower)) || 
        (shortName !== '' && symbolLower.includes(shortName)) || 
        (compName !== '' && compName.includes(symbolLower))
      );
    });
    if (companyIdx === -1) companyIdx = undefined;
  }

  if (companyIdx !== undefined) {
    const company = (companyMaster as CompanyMaster).companies[companyIdx];
    if (company) {
      const nseStatus = String(company[8] || '');
      
      // Find BSE Code for this company index
      let bseCode = '';
      for (const [k, v] of Object.entries((companyMaster as CompanyMaster).bse)) {
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

// ─── Reverse Lookup for NSE Symbols ─────────────────────────────────────────
let reverseNseMap: Record<number, string> | null = null;

function getReverseNseMap() {
  if (!reverseNseMap) {
    reverseNseMap = {};
    const nseDict = companyMaster.nse as Record<string, number>;
    for (const [sym, idx] of Object.entries(nseDict)) {
      reverseNseMap[idx] = sym;
    }
  }
  return reverseNseMap;
}

function normalizeCompanyName(name: string): string {
  return name.toUpperCase()
    .replace(/LIMITED/g, '')
    .replace(/LTD\.?/g, '')
    .replace(/ ENTER\.? L/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Checks if a given string is a perfectly valid exact NSE symbol.
 */
export function isExactNSESymbol(symbol: string): boolean {
  if (!symbol) return false;
  const nseDict = companyMaster.nse as Record<string, number>;
  return nseDict[symbol.trim().toUpperCase()] !== undefined;
}

/**
 * Resolves an ISIN directly to an NSE symbol using companyMaster.json
 */
export function resolveISINToNSE(isin: string): string | null {
  if (!isin) return null;
  const isinDict = companyMaster.isin as Record<string, number>;
  const idx = isinDict[isin.trim().toUpperCase()];
  if (idx !== undefined) {
    const nseMap = getReverseNseMap();
    return nseMap[idx] || null;
  }
  return null;
}

/**
 * Attempts to find the exact NSE symbol by fuzzy matching a full company name
 * against the companyMaster.json database.
 */
export function resolveCompanyNameToNSE(companyName: string): string | null {
  if (!companyName) return null;
  const target = normalizeCompanyName(companyName);
  if (!target) return null;

  for (let i = 0; i < companyMaster.companies.length; i++) {
    const comp = companyMaster.companies[i];
    if (!comp) continue;
    const name = comp[0] as string;
    if (name && normalizeCompanyName(name) === target) {
      const nseMap = getReverseNseMap();
      return nseMap[i] || null;
    }
  }
  return null;
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

  let sym: string;
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
      if (company) {
        const shortName = company[7] as string;
        const compName = company[0] as string;
        // Strip spaces and uppercase
        const targetName = (shortName || compName || '').replace(/\s/g, '').toUpperCase();
        if (targetName && !/^\d+$/.test(targetName)) {
          return targetName;
        }
      }
    }
  }

  return clean;
}

