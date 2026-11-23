export interface MarketRegime {
  regime: "Positive" | "Neutral" | "Defensive" | "High Risk";
  consensus_score: number;
  positive_pillars: number;
  trend_status: string;
  breadth_status: string;
  liquidity_status: string;
  vnindex_close: number;
  ma20: number;
  ma50: number;
  ad_ratio: number;
  pct_above_ma20: number;
  volume_pace: number;
  foreign_net_value: number;
  summary: string;
}

export interface VnindexPoint {
  date: string;
  close: number;
  ma20: number | null;
  ma50: number | null;
  volume: number;
}

export interface SectorSummaryItem {
  sector: string;
  stock_count: number;
  avg_alpha_score: number;
  pct_above_ma20: number;
  avg_rs_20d_pct: number;
  top_symbol: string;
  top_score: number;
}

export interface DiscoveryStock {
  symbol: string;
  sector: string;
  close_price: number;
  ma20?: number;
  ma50?: number;
  pct_change_1d: number;
  ret_5d_pct?: number;
  ret_20d_pct?: number;
  rs_20d: number;
  above_ma20: number;
  above_ma50?: number;
  adv_20_val: number;
  adv_20_vol: number;
  volume_pace: number;
  obi_3l: number | null;
  spread_pct?: number | null;
  foreign_net_ratio: number | null;
  alpha_score: number | null;
  trend_score: number | null;
  liquidity_score: number | null;
  foreign_score: number | null;
  fundamental_score: number | null;
  data_completeness: number;
  data_flag: string;
  reasons: string[];
}

export interface PortfolioHealth {
  total_nav_vnd: number;
  equity_value_vnd: number;
  cash_vnd: number;
  cash_weight: number;
  hhi_stock: number;
  n_effective_stock: number;
  hhi_sector: number;
  portfolio_beta: number;
  hist_var_95_pct: number;
  hist_var_95_vnd: number;
  hist_es_95_pct: number;
  hist_es_95_vnd: float;
  param_var_95_pct: number;
  annualized_vol_pct: number;
  health_score: number;
  sector_weights: Record<string, number>;
  correlation_matrix: Record<string, Record<string, number>>;
  days_to_liquidate: Record<string, number>;
  stress_tests: Record<string, number>;
  warnings: string[];
  daily_returns_series?: number[];
}

type float = number;

export interface WhatIfResult {
  candidate_symbol: string;
  add_amount_vnd: number;
  nav_before: number;
  nav_after: number;
  var_95_before_vnd: number;
  var_95_after_vnd: number;
  delta_var_vnd: number;
  delta_var_pct: number;
  hhi_stock_before: number;
  hhi_stock_after: number;
  delta_hhi_stock: number;
  hhi_sector_before: number;
  hhi_sector_after: number;
  avg_corr_with_portfolio: number;
  portfolio_fit_score: number;
  explanation: string;
}

export interface OrderBookSnapshot {
  source: string;
  bid_prices: number[];
  bid_vols: number[];
  ask_prices: number[];
  ask_vols: number[];
}

export interface StockSeriesItem {
  dates_60d: string[];
  closes_60d: number[];
  ma20_60d: (number | null)[];
  orderbook: OrderBookSnapshot;
}

export interface SnapshotBundle {
  generated_at: string;
  data_mode: string;
  latest_trading_date: string;
  sessions_count: number;
  breadth_scope: string;
  breadth_counts?: {
    advances: number;
    declines: number;
    no_change: number;
  };
  market_regime: MarketRegime;
  vnindex_history?: VnindexPoint[];
  sector_summary?: SectorSummaryItem[];
  discovery: DiscoveryStock[];
  default_portfolio: {
    positions: Record<string, number>;
    cash_vnd: number;
    health: PortfolioHealth;
    what_if_50m: Record<string, WhatIfResult>;
  };
  quant_client_data?: {
    dates_130d: string[];
    returns_130d: Record<string, number[]>;
    stock_series: Record<string, StockSeriesItem>;
  };
  validation: {
    signal_validation: Array<{
      horizon_days: number;
      sample_count: number;
      avg_excess_return_pct: number;
      median_excess_return_pct: number;
      win_rate_pct: number;
      note: string;
    }>;
    risk_model_validation: {
      window_days: number;
      test_days: number;
      exceptions: number;
      exception_rate: number;
      expected_rate: number;
      status: string;
    };
  };
  disclaimer: string;
}
