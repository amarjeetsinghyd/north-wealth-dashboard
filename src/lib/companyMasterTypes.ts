// Types for companyMaster.json
export interface CompanyTuple {
  companyName: string;
  sector: string;
  marketCap: string; // Actually 'Large' | 'Mid' | 'Small' but we keep string for flexibility
  mcap: number;
  industry: string;
  isin: string;
  exchange: string; // e.g., 'A', 'B'
  shortName: string;
  nseStatus: string; // 'Active', 'Not Listed', 'Delisted', 'Suspended'
  bseStatus: string; // 'Active', etc.
}

export interface CompanyMaster {
  nse: Record<string, number>; // symbol -> index in companies array
  bse: Record<string, number>; // bseCode -> index in companies array
  companies: CompanyTuple[];
}