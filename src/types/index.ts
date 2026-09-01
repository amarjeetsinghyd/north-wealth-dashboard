export interface Client {
  id: string;
  name: string;
  onboarding_date: string;
  total_capital?: number;
  total_aua?: number;
  mutual_funds?: number;
  rm_name?: string;
  phone?: string;
  email?: string;
  billed_amount?: number;
  amount_paid?: number;
  risk_profile?: string;
  asset_equity?: number;
  asset_mutual_funds?: number;
  asset_free_cash?: number;
  aua_breach_reason?: string;
  cash_difference_reason?: string;
  client_portfolio_date?: string;
  client_cash_base_date?: string;
  client_cash_base_amount?: number;
  cash_parked_liquid?: number;
  cash_reported_date?: string;
  cash_reported_amount?: number;
  cash_differ_reason?: string;
  client_momentum_cash?: number;
  client_long_cash?: number;
  cash_history?: Array<{
    id: string;
    base_date: string;
    cash: number;
    liquid: number;
    total: number;
    created_at: string;
  }>;
  created_at: string;
}

export interface Holding {
  id: string;
  client_id: string;
  stock_symbol: string;
  nse_symbol: string | null;
  company_name: string;
  buy_price: number;
  quantity: number;
  current_price: number;
  current_value: number;
  invested_amount: number;
  unrealised_pnl: number;
  unrealised_pnl_pct: number;
  realised_pnl: number;
  rebalancing_date: string | null;
  last_price_update: string | null;
  purchase_date?: string;
  source?: 'Fresh' | 'Existing';
  holding_tier?: 'client' | 'working';
  created_at: string;
}

export interface Transaction {
  id: string;
  client_id: string;
  date: string;
  action: 'BUY' | 'SELL';
  stock_symbol: string;
  company_name: string;
  quantity: number;
  price: number;
  total_value: number;
  buy_price?: number;
  sell_price?: number;
  realised_pnl?: number;
  price_range?: string | null;
  price_range_min?: number;
  price_range_max?: number;
  reco_price?: number;
  status?: 'Executed' | 'Avoid';
  call_status?: 'Open' | 'Closed';
  bucket?: 'Long-Term' | 'Momentum';
  created_at: string;
}

export interface SymbolCandidate {
  symbol: string;
  companyName: string;
  score: number;
  source: 'company_master' | 'etf_master' | 'alias' | 'fuzzy';
}

export interface ExtractedHolding {
  stock_symbol: string;
  nse_symbol: string;
  company_name: string;
  raw_isin: string | null;
  quantity: number;
  buy_price: number;
  confidence: number;
  flags: string[];
  candidates?: SymbolCandidate[] | undefined;
  purchase_date?: string | undefined;
  // Optional reference fields (not for DB storage)
  current_price?: number | undefined;
  invested_value?: number | undefined;
  current_value?: number | undefined;
}

export interface PortfolioSummary {
  totalInvested: number;
  currentValue: number;
  unrealisedPnL: number;
  realisedPnL: number;
  unrealisedPnLPct: number;
}
