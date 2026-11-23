from dataclasses import dataclass
from typing import Dict, List, Optional
import numpy as np
import pandas as pd


@dataclass
class PortfolioHealthResult:
    total_nav_vnd: float
    equity_value_vnd: float
    cash_vnd: float
    cash_weight: float
    hhi_stock: float
    n_effective_stock: float
    hhi_sector: float
    portfolio_beta: float
    hist_var_95_pct: float
    hist_var_95_vnd: float
    hist_es_95_pct: float
    hist_es_95_vnd: float
    param_var_95_pct: float
    annualized_vol_pct: float
    health_score: float
    sector_weights: Dict[str, float]
    correlation_matrix: Dict[str, Dict[str, float]]
    days_to_liquidate: Dict[str, float]
    stress_tests: Dict[str, float]
    warnings: List[str]


@dataclass
class WhatIfResult:
    candidate_symbol: str
    add_amount_vnd: float
    nav_before: float
    nav_after: float
    var_95_before_vnd: float
    var_95_after_vnd: float
    delta_var_vnd: float
    delta_var_pct: float
    hhi_stock_before: float
    hhi_stock_after: float
    delta_hhi_stock: float
    hhi_sector_before: float
    hhi_sector_after: float
    avg_corr_with_portfolio: float
    portfolio_fit_score: float
    explanation: str


def compute_hhi(weights: List[float]) -> tuple[float, float]:
    """Compute Herfindahl-Hirschman Index and effective number of positions."""
    clean = [max(0.0, float(w)) for w in weights if w > 0]
    total = sum(clean)
    if total <= 0:
        return 0.0, 0.0
    norm = [w / total for w in clean]
    hhi = sum(w * w for w in norm)
    n_eff = (1.0 / hhi) if hhi > 0 else 0.0
    return hhi, n_eff


def compute_historical_var_es(
    portfolio_returns: pd.Series,
    confidence: float = 0.95,
) -> tuple[float, float]:
    """
    Compute 1-day Historical VaR and Expected Shortfall (positive loss magnitudes).
    """
    clean = portfolio_returns.dropna().to_numpy(dtype=float)
    if len(clean) == 0:
        return 0.0, 0.0
    alpha = 1.0 - confidence
    q = float(np.quantile(clean, alpha))
    var_loss = max(0.0, -q)
    tail = clean[clean <= q]
    es_loss = max(0.0, float(-np.mean(tail))) if len(tail) > 0 else var_loss
    return var_loss, es_loss


def compute_days_to_liquidate(
    position_shares: float,
    adv_20_shares: float,
    participation_rate: float = 0.10,
) -> float:
    """Scenario-based Days-to-Liquidate = Q / (ADV_20 * participation_rate)."""
    if position_shares <= 0:
        return 0.0
    if adv_20_shares <= 0 or participation_rate <= 0:
        return 999.0
    return float(position_shares) / (float(adv_20_shares) * float(participation_rate))


def analyze_portfolio_health(
    positions: Dict[str, float],  # symbol -> market_value_vnd
    cash_vnd: float,
    returns_df: pd.DataFrame,  # index=date, columns=symbols + 'VNINDEX' (log or simple returns)
    sector_map: Dict[str, str],
    shares_map: Optional[Dict[str, float]] = None,
    adv20_map: Optional[Dict[str, float]] = None,
    participation_rate: float = 0.10,
) -> PortfolioHealthResult:
    """Compute comprehensive quantitative health metrics for a stock portfolio."""
    clean_pos = {k.upper(): max(0.0, float(v)) for k, v in positions.items() if v > 0}
    equity_val = sum(clean_pos.values())
    cash_val = max(0.0, float(cash_vnd))
    total_nav = equity_val + cash_val
    if total_nav <= 0 or not clean_pos:
        raise ValueError("Portfolio must have positive total NAV and at least one equity position.")

    symbols = [s for s in clean_pos.keys() if s in returns_df.columns]
    if not symbols:
        raise ValueError("None of the portfolio symbols exist in historical returns_df.")

    # Weights relative to total NAV (cash has 0 market return)
    w_nav = {s: clean_pos[s] / total_nav for s in symbols}
    w_eq = {s: clean_pos[s] / equity_val for s in symbols}
    cash_weight = cash_val / total_nav

    hhi_stock, n_eff_stock = compute_hhi(list(w_eq.values()))

    sector_weights: Dict[str, float] = {}
    for s, w in w_eq.items():
        sec = sector_map.get(s, "Other")
        sector_weights[sec] = sector_weights.get(sec, 0.0) + w
    hhi_sector, _ = compute_hhi(list(sector_weights.values()))

    sub_ret = returns_df[symbols].dropna()
    w_vec = np.array([w_nav[s] for s in symbols], dtype=float)
    port_ret = pd.Series(sub_ret.to_numpy(dtype=float) @ w_vec, index=sub_ret.index)

    hist_var_95, hist_es_95 = compute_historical_var_es(port_ret, 0.95)
    sigma_daily = float(port_ret.std(ddof=1)) if len(port_ret) > 1 else 0.0
    param_var_95 = max(0.0, 1.64485 * sigma_daily - float(port_ret.mean()))
    ann_vol = sigma_daily * np.sqrt(252.0)

    # Beta vs VNINDEX
    port_beta = 1.0
    if "VNINDEX" in returns_df.columns:
        aligned = returns_df[symbols + ["VNINDEX"]].dropna()
        if len(aligned) > 10:
            mkt = aligned["VNINDEX"].to_numpy(dtype=float)
            mkt_var = float(np.var(mkt, ddof=1))
            if mkt_var > 0:
                port_aligned = aligned[symbols].to_numpy(dtype=float) @ w_vec
                cov = float(np.cov(port_aligned, mkt, ddof=1)[0, 1])
                port_beta = cov / mkt_var

    corr_df = sub_ret.corr().round(3)
    corr_dict = {
        r: {c: float(corr_df.loc[r, c]) for c in corr_df.columns}
        for r in corr_df.index
    }

    dtl_map: Dict[str, float] = {}
    if shares_map and adv20_map:
        for s in symbols:
            dtl_map[s] = round(
                compute_days_to_liquidate(
                    shares_map.get(s, 0.0),
                    adv20_map.get(s, 0.0),
                    participation_rate,
                ),
                2,
            )

    stress_tests = {
        "VNINDEX -3%": round(-0.03 * port_beta * total_nav, 0),
        "VNINDEX -5%": round(-0.05 * port_beta * total_nav, 0),
        "VNINDEX -7%": round(-0.07 * port_beta * total_nav, 0),
    }

    warnings: List[str] = []
    if hhi_stock > 0.25:
        warnings.append(f"Tập trung cổ phiếu cao (HHI={hhi_stock:.2f}, N_eff={n_eff_stock:.1f}).")
    max_sec, max_sec_w = max(sector_weights.items(), key=lambda x: x[1])
    if max_sec_w > 0.45:
        warnings.append(f"Tập trung ngành {max_sec} chiếm {max_sec_w:.0%} tỷ trọng cổ phiếu.")
    if hist_var_95 > 0.03:
        warnings.append(f"VaR 95% 1 ngày ở mức cao ({hist_var_95:.2%} ~ {hist_var_95*total_nav:,.0f} đ).")
    for s, dtl in dtl_map.items():
        if dtl > 3.0:
            warnings.append(f"{s} cần ~{dtl:.1f} ngày để thoát vị thế ở mức tham gia {participation_rate:.0%}.")

    # Composite Health Score (0-100)
    div_score = max(0.0, min(100.0, 100.0 * (1.0 - (hhi_stock - 0.10) / 0.40)))
    risk_score = max(0.0, min(100.0, 100.0 * (1.0 - (hist_var_95 - 0.01) / 0.035)))
    cash_score = max(0.0, min(100.0, (cash_weight / 0.20) * 100.0))
    max_dtl = max(dtl_map.values()) if dtl_map else 0.5
    liq_score = max(0.0, min(100.0, 100.0 * (1.0 - max(0.0, max_dtl - 1.0) / 5.0)))
    health_score = 0.30 * div_score + 0.35 * risk_score + 0.20 * liq_score + 0.15 * cash_score

    return PortfolioHealthResult(
        total_nav_vnd=round(total_nav, 0),
        equity_value_vnd=round(equity_val, 0),
        cash_vnd=round(cash_val, 0),
        cash_weight=round(cash_weight, 4),
        hhi_stock=round(hhi_stock, 4),
        n_effective_stock=round(n_eff_stock, 2),
        hhi_sector=round(hhi_sector, 4),
        portfolio_beta=round(port_beta, 3),
        hist_var_95_pct=round(hist_var_95, 5),
        hist_var_95_vnd=round(hist_var_95 * total_nav, 0),
        hist_es_95_pct=round(hist_es_95, 5),
        hist_es_95_vnd=round(hist_es_95 * total_nav, 0),
        param_var_95_pct=round(param_var_95, 5),
        annualized_vol_pct=round(ann_vol, 4),
        health_score=round(health_score, 1),
        sector_weights={k: round(v, 4) for k, v in sector_weights.items()},
        correlation_matrix=corr_dict,
        days_to_liquidate=dtl_map,
        stress_tests=stress_tests,
        warnings=warnings,
    )


def simulate_what_if_addition(
    positions: Dict[str, float],
    cash_vnd: float,
    candidate_symbol: str,
    add_amount_vnd: float,
    returns_df: pd.DataFrame,
    sector_map: Dict[str, str],
    use_existing_cash: bool = False,
) -> WhatIfResult:
    """
    What-If Portfolio Impact: simulate adding `add_amount_vnd` into `candidate_symbol`
    and measure delta VaR, delta HHI (stock & sector), and average correlation.
    """
    sym = candidate_symbol.upper()
    if sym not in returns_df.columns:
        raise ValueError(f"{sym} not found in historical returns_df.")
    if add_amount_vnd <= 0:
        raise ValueError("add_amount_vnd must be positive.")

    before = analyze_portfolio_health(positions, cash_vnd, returns_df, sector_map)

    new_positions = {k.upper(): float(v) for k, v in positions.items()}
    new_positions[sym] = new_positions.get(sym, 0.0) + float(add_amount_vnd)
    new_cash = max(0.0, float(cash_vnd) - float(add_amount_vnd)) if use_existing_cash else float(cash_vnd)

    after = analyze_portfolio_health(new_positions, new_cash, returns_df, sector_map)

    # Compute average correlation between candidate and existing holdings
    existing_syms = [s.upper() for s in positions.keys() if s.upper() in returns_df.columns and s.upper() != sym]
    if existing_syms:
        corr_series = returns_df[existing_syms].corrwith(returns_df[sym]).dropna()
        avg_corr = float(corr_series.mean()) if len(corr_series) > 0 else 0.0
    else:
        avg_corr = 1.0

    delta_var_vnd = after.hist_var_95_vnd - before.hist_var_95_vnd
    delta_var_pct = after.hist_var_95_pct - before.hist_var_95_pct
    delta_hhi_stock = after.hhi_stock - before.hhi_stock

    # Portfolio Fit Score (0-100): rewards lower correlation, VaR reduction, and diversification
    corr_component = max(0.0, min(100.0, (1.0 - avg_corr) * 100.0))
    var_component = max(0.0, min(100.0, 50.0 - (delta_var_pct / 0.005) * 25.0))
    hhi_component = max(0.0, min(100.0, 50.0 - (delta_hhi_stock / 0.05) * 25.0))
    fit_score = 0.45 * var_component + 0.35 * corr_component + 0.20 * hhi_component

    var_dir = "giảm" if delta_var_vnd < 0 else "tăng"
    hhi_dir = "giảm tập trung" if delta_hhi_stock < 0 else "tăng tập trung"
    explanation = (
        f"Thêm {add_amount_vnd:,.0f} đ vào {sym} ({sector_map.get(sym, 'N/A')}): "
        f"VaR 95% {var_dir} {abs(delta_var_vnd):,.0f} đ "
        f"({before.hist_var_95_pct:.2%} → {after.hist_var_95_pct:.2%}), "
        f"HHI cổ phiếu {hhi_dir} ({before.hhi_stock:.3f} → {after.hhi_stock:.3f}), "
        f"tương quan TB với danh mục = {avg_corr:.2f}."
    )

    return WhatIfResult(
        candidate_symbol=sym,
        add_amount_vnd=round(add_amount_vnd, 0),
        nav_before=before.total_nav_vnd,
        nav_after=after.total_nav_vnd,
        var_95_before_vnd=before.hist_var_95_vnd,
        var_95_after_vnd=after.hist_var_95_vnd,
        delta_var_vnd=round(delta_var_vnd, 0),
        delta_var_pct=round(delta_var_pct, 5),
        hhi_stock_before=before.hhi_stock,
        hhi_stock_after=after.hhi_stock,
        delta_hhi_stock=round(delta_hhi_stock, 4),
        hhi_sector_before=before.hhi_sector,
        hhi_sector_after=after.hhi_sector,
        avg_corr_with_portfolio=round(avg_corr, 3),
        portfolio_fit_score=round(fit_score, 1),
        explanation=explanation,
    )
