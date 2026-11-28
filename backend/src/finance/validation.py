from dataclasses import dataclass
from typing import Dict, List, Optional
import numpy as np
import pandas as pd

from src.finance.portfolio import compute_historical_var_es


@dataclass
class SignalValidationSummary:
    horizon_days: int
    sample_count: int
    avg_excess_return: float
    median_excess_return: float
    win_rate: float
    note: str


@dataclass
class VaRBacktestResult:
    window_days: int
    test_days: int
    exceptions: int
    exception_rate: float
    expected_rate: float
    status: str


def evaluate_signal_forward_returns(
    signals_df: pd.DataFrame,  # columns: signal_date, symbol
    prices_df: pd.DataFrame,   # index=date (sorted asc), columns=symbols + 'VNINDEX'
    horizons: List[int] = [3, 5, 10],
    fee_roundtrip_pct: float = 0.003,
) -> List[SignalValidationSummary]:
    """
    Signal Validation (No Look-Ahead Bias):
    - Uses next available trading day (T+1) close/open proxy as entry reference after signal_date T,
      or T+k relative to T+1 to avoid assuming trade at T close using EOD data.
    - Deduplicates consecutive signals on the same symbol within `horizon` days if needed,
      or reports raw observations clearly.
    """
    if signals_df.empty or prices_df.empty or "VNINDEX" not in prices_df.columns:
        return [
            SignalValidationSummary(h, 0, 0.0, 0.0, 0.0, "Chưa đủ dữ liệu tín hiệu hoặc giá.")
            for h in horizons
        ]

    dates = list(prices_df.index)
    date_to_idx = {d: i for i, d in enumerate(dates)}
    results: List[SignalValidationSummary] = []

    for h in horizons:
        excess_list: List[float] = []
        for _, row in signals_df.iterrows():
            s_date = str(row["signal_date"])
            sym = str(row["symbol"]).upper()
            if s_date not in date_to_idx or sym not in prices_df.columns:
                continue
            t_idx = date_to_idx[s_date]
            entry_idx = t_idx + 1  # Next session after signal becomes available
            exit_idx = entry_idx + h
            if exit_idx >= len(dates):
                continue

            p_entry = prices_df.iloc[entry_idx][sym]
            p_exit = prices_df.iloc[exit_idx][sym]
            m_entry = prices_df.iloc[entry_idx]["VNINDEX"]
            m_exit = prices_df.iloc[exit_idx]["VNINDEX"]

            if any(pd.isna(x) or x <= 0 for x in (p_entry, p_exit, m_entry, m_exit)):
                continue

            stock_ret = (float(p_exit) / float(p_entry)) - 1.0 - fee_roundtrip_pct
            mkt_ret = (float(m_exit) / float(m_entry)) - 1.0
            excess_list.append(stock_ret - mkt_ret)

        if not excess_list:
            results.append(
                SignalValidationSummary(h, 0, 0.0, 0.0, 0.0, "Chưa có quan sát đủ kỳ hạn T+k.")
            )
            continue

        arr = np.array(excess_list, dtype=float)
        win_rate = float(np.mean(arr > 0))
        results.append(
            SignalValidationSummary(
                horizon_days=h,
                sample_count=len(arr),
                avg_excess_return=round(float(np.mean(arr)), 5),
                median_excess_return=round(float(np.median(arr)), 5),
                win_rate=round(win_rate, 4),
                note=f"Đã trừ phí/thuế giả định {fee_roundtrip_pct:.2%}; so với VNINDEX.",
            )
        )
    return results


def backtest_historical_var(
    portfolio_returns: pd.Series,
    window: int = 120,
    confidence: float = 0.95,
) -> VaRBacktestResult:
    """
    Risk Model Validation (Rolling Out-of-Sample VaR Exception Test).
    """
    clean = portfolio_returns.dropna()
    if len(clean) <= window + 5:
        return VaRBacktestResult(
            window_days=window,
            test_days=0,
            exceptions=0,
            exception_rate=0.0,
            expected_rate=round(1.0 - confidence, 4),
            status="Chưa đủ chuỗi lợi suất (> window + 5 phiên) để kiểm định VaR.",
        )

    exceptions = 0
    test_days = 0
    for i in range(window, len(clean)):
        hist_slice = clean.iloc[i - window : i]
        var_loss, _ = compute_historical_var_es(hist_slice, confidence=confidence)
        realized_ret = float(clean.iloc[i])
        test_days += 1
        if realized_ret < -var_loss:
            exceptions += 1

    exc_rate = exceptions / test_days if test_days > 0 else 0.0
    exp_rate = 1.0 - confidence
    if abs(exc_rate - exp_rate) <= 0.03:
        status = "Đạt chuẩn (Tỷ lệ vượt ngưỡng gần mức kỳ vọng)"
    elif exc_rate > exp_rate + 0.03:
        status = "Cảnh báo: Mô hình VaR đang ước lượng rủi ro hơi thấp (over-optimistic)"
    else:
        status = "Thận trọng: Mô hình VaR đang ước lượng rủi ro bảo thủ (conservative)"

    return VaRBacktestResult(
        window_days=window,
        test_days=test_days,
        exceptions=exceptions,
        exception_rate=round(exc_rate, 4),
        expected_rate=round(exp_rate, 4),
        status=status,
    )


def evaluate_portfolio_rebalance_backtest(
    prices_df: pd.DataFrame,
    rebalance_picks: Dict[str, List[str]],  # signal_date -> top_k symbols
    regime_by_date: Dict[str, str],
    rebalance_every_n: int = 20,
    fee_roundtrip_pct: float = 0.003,
) -> Dict[str, object]:
    """
    Out-of-sample Strategy Rebalance Backtest (Weekly/Monthly Top-5 with Regime Cash Buffer)
    vs VNINDEX Buy & Hold (rebalanced next session T+1 to prevent look-ahead bias).
    """
    if prices_df.empty or "VNINDEX" not in prices_df.columns or not rebalance_picks:
        return {
            "rebalance_days": rebalance_every_n,
            "total_return_pct": 0.0,
            "vnindex_return_pct": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown_pct": 0.0,
            "vnindex_mdd_pct": 0.0,
            "equity_curve": [],
        }

    dates = list(prices_df.index)
    sorted_pick_dates = sorted(d for d in rebalance_picks.keys() if d in prices_df.index)
    if len(sorted_pick_dates) < 2:
        return {
            "rebalance_days": rebalance_every_n,
            "total_return_pct": 0.0,
            "vnindex_return_pct": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown_pct": 0.0,
            "vnindex_mdd_pct": 0.0,
            "equity_curve": [],
        }

    start_idx = dates.index(sorted_pick_dates[0]) + 1
    if start_idx >= len(dates) - 2:
        start_idx = max(1, len(dates) - 20)

    port_val = 100.0
    mkt_val = 100.0
    port_rets: List[float] = []
    curve: List[Dict[str, object]] = [{"date": str(dates[start_idx - 1]), "strategy": 100.0, "vnindex": 100.0}]

    current_weights: Dict[str, float] = {}
    pick_set = set(sorted_pick_dates)

    for idx in range(start_idx, len(dates)):
        prev_date = str(dates[idx - 1])
        curr_date = str(dates[idx])

        # Rebalance on session T+1 after signal at prev_date (T)
        if prev_date in pick_set:
            picks = [s for s in rebalance_picks.get(prev_date, []) if s in prices_df.columns]
            reg = regime_by_date.get(prev_date, "Neutral")
            # Regime Cash Buffer: invest 100% in Positive, 70% Neutral, 40% Defensive, 20% High Risk
            invest_ratio = 1.0 if reg == "Positive" else 0.70 if reg == "Neutral" else 0.40 if reg == "Defensive" else 0.20
            new_weights = {s: invest_ratio / len(picks) for s in picks} if picks else {}
            turnover = sum(abs(new_weights.get(s, 0.0) - current_weights.get(s, 0.0)) for s in set(new_weights) | set(current_weights))
            port_val *= max(0.0, 1.0 - turnover * (fee_roundtrip_pct / 2.0))
            current_weights = new_weights

        day_ret = 0.0
        for s, w in current_weights.items():
            p0 = prices_df.iloc[idx - 1][s]
            p1 = prices_df.iloc[idx][s]
            if pd.notna(p0) and pd.notna(p1) and float(p0) > 0:
                day_ret += w * (float(p1) / float(p0) - 1.0)

        m0 = prices_df.iloc[idx - 1]["VNINDEX"]
        m1 = prices_df.iloc[idx]["VNINDEX"]
        mkt_ret = (float(m1) / float(m0) - 1.0) if (pd.notna(m0) and pd.notna(m1) and float(m0) > 0) else 0.0

        port_val *= 1.0 + day_ret
        mkt_val *= 1.0 + mkt_ret
        port_rets.append(day_ret)
        curve.append({"date": curr_date, "strategy": round(port_val, 2), "vnindex": round(mkt_val, 2)})

    arr = np.array(port_rets, dtype=float)
    rf_daily = 0.04 / 252.0
    std = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
    sharpe = float(((np.mean(arr) - rf_daily) / std) * np.sqrt(252.0)) if std > 0 else 0.0

    strat_vals = np.array([pt["strategy"] for pt in curve], dtype=float)
    mkt_vals = np.array([pt["vnindex"] for pt in curve], dtype=float)
    strat_mdd = float(np.min(strat_vals / np.maximum.accumulate(strat_vals) - 1.0)) * 100.0
    mkt_mdd = float(np.min(mkt_vals / np.maximum.accumulate(mkt_vals) - 1.0)) * 100.0

    # Downsample curve to <= 90 points for compact JSON
    step = max(1, len(curve) // 90)
    compact_curve = curve[::step]
    if compact_curve[-1]["date"] != curve[-1]["date"]:
        compact_curve.append(curve[-1])

    return {
        "rebalance_days": rebalance_every_n,
        "total_return_pct": round(port_val - 100.0, 2),
        "vnindex_return_pct": round(mkt_val - 100.0, 2),
        "sharpe_ratio": round(sharpe, 2),
        "max_drawdown_pct": round(strat_mdd, 2),
        "vnindex_mdd_pct": round(mkt_mdd, 2),
        "equity_curve": compact_curve,
    }
