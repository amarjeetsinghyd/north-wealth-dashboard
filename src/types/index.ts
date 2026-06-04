export interface Client {
  id: string;
  name: string;
  onboarding_date: string;
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
  created_at: string;
}

export interface ExtractedHolding {
  stock_symbol: string;
  company_name: string;
  buy_price: number;
  quantity: number;
}

export interface PortfolioSummary {
  totalInvested: number;
  currentValue: number;
  unrealisedPnL: number;
  realisedPnL: number;
  unrealisedPnLPct: number;
}
