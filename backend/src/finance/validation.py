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
