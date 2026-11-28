import numpy as np
import pandas as pd
import pytest

from src.finance.discovery import compute_alpha_scores
from src.finance.orderbook import compute_obi_3_levels, estimate_execution_cost, parse_neo_price
from src.finance.portfolio import (
    analyze_portfolio_health,
    compute_days_to_liquidate,
    compute_hhi,
    compute_historical_var_es,
    simulate_what_if_addition,
)
from src.finance.regime import classify_market_regime
from src.finance.validation import backtest_historical_var, evaluate_signal_forward_returns


def test_hhi_and_effective_n():
    hhi, n_eff = compute_hhi([0.5, 0.5])
    assert pytest.approx(hhi, rel=1e-6) == 0.5
    assert pytest.approx(n_eff, rel=1e-6) == 2.0

    hhi_single, n_single = compute_hhi([100.0])
    assert hhi_single == 1.0
    assert n_single == 1.0


def test_historical_var_and_es():
    # 20 returns: worst two are -0.05 and -0.04, rest 0.01
    rets = pd.Series([-0.05, -0.04] + [0.01] * 18)
    var95, es95 = compute_historical_var_es(rets, confidence=0.95)
    assert var95 > 0.03
    assert es95 >= var95


def test_days_to_liquidate():
    dtl = compute_days_to_liquidate(position_shares=100_000, adv_20_shares=500_000, participation_rate=0.10)
    assert pytest.approx(dtl, rel=1e-6) == 2.0
    assert compute_days_to_liquidate(1000, 0) == 999.0


def test_parse_neo_price_handles_ato_atc():
    assert parse_neo_price("ATO") is None
    assert parse_neo_price("ATC") is None
    assert parse_neo_price("29750.0") == 29750.0
    assert parse_neo_price(30000) == 30000.0
    assert parse_neo_price(None) is None


def test_orderbook_obi_and_depth_limit():
    obi = compute_obi_3_levels([3000, 2000, 1000], [1000, 1000, 1000])
    assert pytest.approx(obi, rel=1e-4) == (6000 - 3000) / 9000

    # Order larger than total 3-level ask depth -> must flag sufficient_depth=False
    res = estimate_execution_cost(
        bid_prices=["29750", 29700, 29650],
        bid_vols=[1000, 1000, 1000],
        ask_prices=["29800", 29850, 29900],
        ask_vols=[1000, 1000, 1000],
        order_value_vnd=500_000_000,
        side="buy",
    )
    assert res.sufficient_depth is False
    assert "vượt quá tổng độ sâu 3 bước giá" in res.note

    # Small order fits inside Ask 1
    res_ok = estimate_execution_cost(
        bid_prices=["29750", 29700, 29650],
        bid_vols=[10000, 10000, 10000],
        ask_prices=["29800", 29850, 29900],
        ask_vols=[10000, 10000, 10000],
        order_value_vnd=50_000_000,
        side="buy",
    )
    assert res_ok.sufficient_depth is True
    assert res_ok.estimated_avg_price == 29800.0


def test_market_regime_classification():
    closes = pd.Series(np.linspace(1200, 1300, 60))
    res = classify_market_regime(
        index_closes=closes,
        advances=260,
        declines=120,
        pct_above_ma20=0.68,
        volume_pace=1.20,
        foreign_net_value=150e9,
    )
    assert res.regime == "Positive"
    assert res.positive_pillars == 3


def test_alpha_score_missing_fundamental_not_zero():
    df = pd.DataFrame(
        [
            {"symbol": "AAA", "sector": "Bank", "rs_20d": 0.12, "above_ma20": 1, "adv_20_val": 300e9, "volume_pace": 1.3, "obi_3l": 0.2, "foreign_net_ratio": 0.05, "roe": 0.20, "profit_growth": 0.15, "pe": 10.0},
            {"symbol": "BBB", "sector": "Tech", "rs_20d": 0.10, "above_ma20": 1, "adv_20_val": 250e9, "volume_pace": 1.1, "obi_3l": 0.1, "foreign_net_ratio": 0.02, "roe": np.nan, "profit_growth": np.nan, "pe": np.nan},
        ]
    )
    scored = compute_alpha_scores(df)
    bbb = scored[scored["symbol"] == "BBB"].iloc[0]
    assert np.isnan(bbb["fundamental_score"])
    assert pd.notna(bbb["alpha_score"])
    assert "Thiếu: fundamental" in bbb["data_flag"]


def test_portfolio_health_and_what_if():
    rng = np.random.default_rng(42)
    dates = pd.date_range("2026-01-01", periods=150, freq="B").strftime("%Y-%m-%d")
    mkt = rng.normal(0.0005, 0.012, 150)
    returns_df = pd.DataFrame(
        {
            "VNINDEX": mkt,
            "VCB": 1.1 * mkt + rng.normal(0, 0.008, 150),
            "TCB": 1.2 * mkt + rng.normal(0, 0.010, 150),
            "FPT": 0.6 * mkt + rng.normal(0, 0.012, 150),
        },
        index=dates,
    )
    sector_map = {"VCB": "Banking", "TCB": "Banking", "FPT": "Tech"}
    positions = {"VCB": 250_000_000, "TCB": 250_000_000}

    health = analyze_portfolio_health(positions, cash_vnd=50_000_000, returns_df=returns_df, sector_map=sector_map)
    assert health.hhi_sector == 1.0  # 100% Banking
    assert len(health.warnings) >= 1

    what_if = simulate_what_if_addition(
        positions=positions,
        cash_vnd=50_000_000,
        candidate_symbol="FPT",
        add_amount_vnd=100_000_000,
        returns_df=returns_df,
        sector_map=sector_map,
    )
    assert what_if.hhi_stock_after < what_if.hhi_stock_before
    assert what_if.hhi_sector_after < what_if.hhi_sector_before


def test_signal_and_var_validation():
    dates = pd.date_range("2026-01-01", periods=140, freq="B").strftime("%Y-%m-%d")
    prices = pd.DataFrame(
        {
            "VNINDEX": np.linspace(1200, 1250, 140),
            "FPT": np.linspace(100_000, 130_000, 140),
        },
        index=dates,
    )
    signals = pd.DataFrame([{"signal_date": dates[10], "symbol": "FPT"}])
    sig_res = evaluate_signal_forward_returns(signals, prices, horizons=[3, 5])
    assert sig_res[0].sample_count == 1
    assert sig_res[0].avg_excess_return > 0

    rets = pd.Series(np.random.default_rng(7).normal(0, 0.01, 160))
    var_bt = backtest_historical_var(rets, window=100, confidence=0.95)
    assert var_bt.test_days == 60


def test_neo_intraday_overlay():
    from src.analytics.engine import apply_live_neo_intraday_overlay
    from src.neo_api.client import _parse_neo_trading_date

    assert _parse_neo_trading_date("27/11/2026") == "2026-11-27"
    closes = pd.DataFrame({"VNINDEX": [1650.0], "HPG": [19800.0]}, index=["2026-11-27"])
    volumes = pd.DataFrame({"VNINDEX": [500e6], "HPG": [10e6]}, index=["2026-11-27"])
    values = pd.DataFrame({"VNINDEX": [10e12], "HPG": [200e9]}, index=["2026-11-27"])

    neo_mkt = {
        "source": "NEO_API_REST",
        "captured_at": "2026-11-30T10:15:00+07:00",
        "index_value": 1665.5,
        "total_volume": 250e6,
        "total_value": 5e12,
    }
    neo_stocks = {
        "HPG": {
            "trading_session": "2026-11-30|",
            "last_price": 20300.0,
            "total_volume": 6e6,
            "total_value": 120e9,
        }
    }
    c2, v2, _ = apply_live_neo_intraday_overlay(closes, volumes, values, neo_mkt, neo_stocks)
    assert str(c2.index[-1]) == "2026-11-30"
    assert float(c2.loc["2026-11-30", "VNINDEX"]) == 1665.5
    assert float(c2.loc["2026-11-30", "HPG"]) == 20300.0
    assert float(v2.loc["2026-11-30", "HPG"]) == 6e6


def test_sector_neutral_and_regime_adaptive_scores():
    df = pd.DataFrame(
        [
            {"symbol": "B1", "sector": "Bank", "rs_20d": 0.15, "above_ma20": 1, "adv_20_val": 400e9, "volume_pace": 1.4, "obi_3l": 0.2, "foreign_net_ratio": 0.05},
            {"symbol": "B2", "sector": "Bank", "rs_20d": 0.05, "above_ma20": 0, "adv_20_val": 200e9, "volume_pace": 0.9, "obi_3l": -0.1, "foreign_net_ratio": -0.02},
            {"symbol": "T1", "sector": "Tech", "rs_20d": 0.08, "above_ma20": 1, "adv_20_val": 300e9, "volume_pace": 1.2, "obi_3l": 0.1, "foreign_net_ratio": 0.04},
        ]
    )
    scored_pos = compute_alpha_scores(df, regime="Positive")
    scored_risk = compute_alpha_scores(df, regime="High Risk")
    assert "alpha_sector_neutral" in scored_pos.columns
    assert "alpha_regime_adaptive" in scored_pos.columns
    assert scored_pos["alpha_sector_neutral"].notna().all()
    # In High Risk, trend weight drops and liquidity/foreign take higher share
    b2_pos = float(scored_pos[scored_pos["symbol"] == "B2"].iloc[0]["alpha_regime_adaptive"])
    b2_risk = float(scored_risk[scored_risk["symbol"] == "B2"].iloc[0]["alpha_regime_adaptive"])
    assert b2_pos != b2_risk


def test_rebalance_backtest():
    from src.finance.validation import evaluate_portfolio_rebalance_backtest

    dates = pd.date_range("2026-01-01", periods=60, freq="B").strftime("%Y-%m-%d")
    prices = pd.DataFrame(
        {
            "VNINDEX": np.linspace(1200, 1260, 60),
            "FPT": np.linspace(100_000, 125_000, 60),
            "VCB": np.linspace(60_000, 66_000, 60),
        },
        index=dates,
    )
    picks = {dates[5]: ["FPT", "VCB"], dates[25]: ["FPT", "VCB"]}
    regimes = {dates[5]: "Positive", dates[25]: "High Risk"}
    res = evaluate_portfolio_rebalance_backtest(
        prices_df=prices,
        rebalance_picks=picks,
        regime_by_date=regimes,
        rebalance_every_n=20,
    )
    assert res["rebalance_days"] == 20
    assert len(res["equity_curve"]) > 10
    assert res["total_return_pct"] > 0
