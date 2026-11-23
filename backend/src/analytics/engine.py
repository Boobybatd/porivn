import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd

from src.data.db import DEFAULT_DB_PATH, ROOT_DIR, get_connection, now_vn_iso
from src.data.ssi_client import load_universe
from src.finance.discovery import compute_alpha_scores
from src.finance.orderbook import estimate_execution_cost
from src.finance.portfolio import analyze_portfolio_health, simulate_what_if_addition
from src.finance.regime import classify_market_regime
from src.finance.validation import backtest_historical_var, evaluate_signal_forward_returns


def hose_tick_size(price_vnd: float) -> float:
    """Return HOSE standard tick step (Section 'Bước giá' in NeoAPI Docs)."""
    if price_vnd < 10_000:
        return 10.0
    if price_vnd < 50_000:
        return 50.0
    return 100.0


def load_ohlcv_pivots(db_path: Path | str | None = None) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load close, volume, value wide DataFrames (index=trading_date asc, columns=symbol)."""
    with get_connection(db_path) as conn:
        df = pd.read_sql_query(
            "SELECT symbol, trading_date, close_price, volume, value FROM daily_ohlcv ORDER BY trading_date ASC",
            conn,
        )
    if df.empty:
        raise RuntimeError("daily_ohlcv is empty. Run `python -m src.data.ssi_client` first.")
    closes = df.pivot(index="trading_date", columns="symbol", values="close_price").sort_index()
    volumes = df.pivot(index="trading_date", columns="symbol", values="volume").sort_index()
    values = df.pivot(index="trading_date", columns="symbol", values="value").sort_index()
    return closes, volumes, values


def load_latest_neo_snapshots(db_path: Path | str | None = None) -> tuple[Optional[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """Load latest intraday market & stock snapshots from SQLite if NEO collector has run."""
    with get_connection(db_path) as conn:
        mkt_row = conn.execute(
            "SELECT * FROM intraday_market_snapshots WHERE index_code = 'VNINDEX' ORDER BY captured_at DESC LIMIT 1"
        ).fetchone()
        stk_rows = conn.execute(
            """
            SELECT s.*
            FROM intraday_stock_snapshots s
            INNER JOIN (
                SELECT symbol, MAX(captured_at) AS max_ts
                FROM intraday_stock_snapshots
                GROUP BY symbol
            ) latest ON s.symbol = latest.symbol AND s.captured_at = latest.max_ts
            """
        ).fetchall()
    mkt = dict(mkt_row) if mkt_row else None
    stocks = {r["symbol"]: dict(r) for r in stk_rows}
    return mkt, stocks


def build_orderbook_snapshot_for_symbol(
    sym: str,
    last_close: float,
    adv_20_vol: float,
    rs_20d: float,
    neo_snap: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Return 3-level Bid/Ask snapshot from NEO API if available, else calibrated EOD reference book."""
    if neo_snap and neo_snap.get("bid_price_1") and neo_snap.get("ask_price_1"):
        return {
            "source": "NEO_API_LIVE",
            "bid_prices": [neo_snap.get("bid_price_1"), neo_snap.get("bid_price_2"), neo_snap.get("bid_price_3")],
            "bid_vols": [neo_snap.get("bid_vol_1") or 0, neo_snap.get("bid_vol_2") or 0, neo_snap.get("bid_vol_3") or 0],
            "ask_prices": [neo_snap.get("ask_price_1"), neo_snap.get("ask_price_2"), neo_snap.get("ask_price_3")],
            "ask_vols": [neo_snap.get("ask_vol_1") or 0, neo_snap.get("ask_vol_2") or 0, neo_snap.get("ask_vol_3") or 0],
        }

    step = hose_tick_size(last_close)
    b1 = max(step, last_close - step)
    b2 = max(step, last_close - 2 * step)
    b3 = max(step, last_close - 3 * step)
    a1 = last_close
    a2 = last_close + step
    a3 = last_close + 2 * step

    # Calibrate typical 3-level depth (~1.2% of ADV20 per level, tilted slightly by short-term momentum)
    base_lot = max(1000.0, round((adv_20_vol * 0.012) / 100.0) * 100.0)
    tilt = float(np.clip(rs_20d * 2.5, -0.35, 0.35))
    b_mult = 1.0 + tilt
    a_mult = 1.0 - tilt

    return {
        "source": "CALIBRATED_FROM_SSI_ADV20",
        "bid_prices": [b1, b2, b3],
        "bid_vols": [
            round((base_lot * 1.15 * b_mult) / 100.0) * 100,
            round((base_lot * 1.45 * b_mult) / 100.0) * 100,
            round((base_lot * 1.80 * b_mult) / 100.0) * 100,
        ],
        "ask_prices": [a1, a2, a3],
        "ask_vols": [
            round((base_lot * 1.10 * a_mult) / 100.0) * 100,
            round((base_lot * 1.40 * a_mult) / 100.0) * 100,
            round((base_lot * 1.75 * a_mult) / 100.0) * 100,
        ],
    }


def build_discovery_table(
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    values: pd.DataFrame,
    sector_map: Dict[str, str],
    neo_stocks: Optional[Dict[str, Dict[str, Any]]] = None,
) -> pd.DataFrame:
    """Compute Alpha Score features across the 55-stock Discovery Universe."""
    neo_stocks = neo_stocks or {}
    rows: List[Dict[str, Any]] = []
    idx_ret_20 = (
        (float(closes["VNINDEX"].iloc[-1]) / float(closes["VNINDEX"].iloc[-21]) - 1.0)
        if "VNINDEX" in closes.columns and len(closes) > 21
        else 0.0
    )

    for sym, sector in sector_map.items():
        if sym not in closes.columns:
            continue
        c_ser = closes[sym].dropna()
        v_ser = volumes[sym].dropna()
        val_ser = values[sym].dropna()
        if len(c_ser) < 25:
            continue

        last_c = float(c_ser.iloc[-1])
        ma20 = float(c_ser.tail(20).mean())
        ma50 = float(c_ser.tail(50).mean()) if len(c_ser) >= 50 else ma20
        ret_20 = (last_c / float(c_ser.iloc[-21]) - 1.0) if len(c_ser) > 21 else 0.0
        ret_5 = (last_c / float(c_ser.iloc[-6]) - 1.0) if len(c_ser) > 6 else 0.0
        rs_20d = ret_20 - idx_ret_20

        est_val = val_ser.where(val_ser > 0, c_ser * v_ser)
        adv_20_val = float(est_val.tail(20).mean())
        adv_20_vol = float(v_ser.tail(20).mean())
        last_vol = float(v_ser.iloc[-1])
        vol_pace = last_vol / adv_20_vol if adv_20_vol > 0 else 1.0

        snap = neo_stocks.get(sym)
        ob_book = build_orderbook_snapshot_for_symbol(sym, last_c, adv_20_vol, rs_20d, snap)
        ob_eval = estimate_execution_cost(
            ob_book["bid_prices"],
            ob_book["bid_vols"],
            ob_book["ask_prices"],
            ob_book["ask_vols"],
            order_value_vnd=100_000_000,
            side="buy",
        )
        obi_3l = ob_eval.obi_3_levels
        foreign_net_ratio = None
        if snap:
            fnet = snap.get("foreign_net_val")
            tval = snap.get("total_value") or adv_20_val
            if fnet is not None and tval and tval > 0:
                foreign_net_ratio = float(fnet) / float(tval)

        rows.append(
            {
                "symbol": sym,
                "sector": sector,
                "close_price": round(last_c, 0),
                "ma20": round(ma20, 0),
                "ma50": round(ma50, 0),
                "pct_change_1d": round((last_c / float(c_ser.iloc[-2]) - 1.0) * 100.0, 2),
                "ret_5d_pct": round(ret_5 * 100.0, 2),
                "ret_20d_pct": round(ret_20 * 100.0, 2),
                "rs_20d": round(rs_20d, 4),
                "above_ma20": int(last_c > ma20),
                "above_ma50": int(last_c > ma50),
                "adv_20_val": round(adv_20_val, 0),
                "adv_20_vol": round(adv_20_vol, 0),
                "volume_pace": round(vol_pace, 2),
                "obi_3l": obi_3l,
                "spread_pct": ob_eval.spread_pct,
                "foreign_net_ratio": foreign_net_ratio,
                "roe": np.nan,
                "profit_growth": np.nan,
                "pe": np.nan,
            }
        )

    feat_df = pd.DataFrame(rows)
    return compute_alpha_scores(feat_df)


def run_historical_signal_backtest(
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    values: pd.DataFrame,
    sector_map: Dict[str, str],
    sample_every_n_days: int = 5,
    top_k: int = 5,
) -> List[Dict[str, Any]]:
    """Backtest Top-K Alpha Score signals over historical dates (no look-ahead bias)."""
    dates = list(closes.index)
    if len(dates) < 60:
        return []

    signal_rows: List[Dict[str, Any]] = []
    for idx in range(30, len(dates) - 15, sample_every_n_days):
        sub_c = closes.iloc[: idx + 1]
        sub_v = volumes.iloc[: idx + 1]
        sub_val = values.iloc[: idx + 1]
        scored = build_discovery_table(sub_c, sub_v, sub_val, sector_map)
        top_syms = scored.dropna(subset=["alpha_score"]).head(top_k)["symbol"].tolist()
        for sym in top_syms:
            signal_rows.append({"signal_date": dates[idx], "symbol": sym})

    sig_df = pd.DataFrame(signal_rows)
    summaries = evaluate_signal_forward_returns(sig_df, closes, horizons=[3, 5, 10])
    return [
        {
            "horizon_days": s.horizon_days,
            "sample_count": s.sample_count,
            "avg_excess_return_pct": round(s.avg_excess_return * 100.0, 2),
            "median_excess_return_pct": round(s.median_excess_return * 100.0, 2),
            "win_rate_pct": round(s.win_rate * 100.0, 1),
            "note": s.note,
        }
        for s in summaries
    ]


def build_full_snapshot_bundle(
    db_path: Path | str | None = None,
    default_positions: Optional[Dict[str, float]] = None,
    default_cash_vnd: float = 100_000_000,
) -> Dict[str, Any]:
    """Generate complete JSON bundle for Next.js frontend (100% interactive client-side + FastAPI)."""
    _, sector_map = load_universe()
    closes, volumes, values = load_ohlcv_pivots(db_path)
    neo_mkt, neo_stocks = load_latest_neo_snapshots(db_path)

    latest_c = closes.iloc[-1]
    prev_c = closes.iloc[-2]
    ma20_all = closes.tail(20).mean()
    universe_syms = [s for s in sector_map.keys() if s in closes.columns]
    pct_above_ma20 = float((latest_c[universe_syms] > ma20_all[universe_syms]).mean())

    if neo_mkt and neo_mkt.get("advances") is not None:
        advances = int(neo_mkt["advances"])
        declines = int(neo_mkt["declines"])
        no_change = int(neo_mkt.get("no_change") or 0)
        src_label = "NEO API" if "NEO" in str(neo_mkt.get("source", "")) else "SSI FastConnect v3"
        breadth_scope = f"Toàn chỉ số VNINDEX ({src_label})"
        foreign_net = 0.0
    else:
        advances = int((latest_c[universe_syms] > prev_c[universe_syms]).sum())
        declines = int((latest_c[universe_syms] < prev_c[universe_syms]).sum())
        no_change = int((latest_c[universe_syms] == prev_c[universe_syms]).sum())
        breadth_scope = f"Rổ đại diện {len(universe_syms)} mã thanh khoản cao (SSI OHLCV)"
        foreign_net = 0.0

    idx_vol = volumes["VNINDEX"].dropna()
    vol_pace = float(idx_vol.iloc[-1] / idx_vol.tail(20).mean()) if len(idx_vol) >= 20 else 1.0

    regime = classify_market_regime(
        index_closes=closes["VNINDEX"].dropna(),
        advances=advances,
        declines=declines,
        pct_above_ma20=pct_above_ma20,
        volume_pace=vol_pace,
        foreign_net_value=foreign_net,
    )

    # VNINDEX 90-session chart series with MA20 & MA50
    vni_c = closes["VNINDEX"].dropna()
    vni_v = volumes["VNINDEX"].reindex(vni_c.index).fillna(0)
    vni_ma20 = vni_c.rolling(20).mean()
    vni_ma50 = vni_c.rolling(50).mean()
    vnindex_history = [
        {
            "date": str(dt),
            "close": round(float(vni_c.loc[dt]), 2),
            "ma20": round(float(vni_ma20.loc[dt]), 2) if pd.notna(vni_ma20.loc[dt]) else None,
            "ma50": round(float(vni_ma50.loc[dt]), 2) if pd.notna(vni_ma50.loc[dt]) else None,
            "volume": round(float(vni_v.loc[dt]), 0),
        }
        for dt in vni_c.tail(90).index
    ]

    discovery_df = build_discovery_table(closes, volumes, values, sector_map, neo_stocks)
    discovery_records = discovery_df.replace({np.nan: None}).to_dict(orient="records")

    # Sector summary (average alpha score, breadth, top stock per sector)
    sector_summary: List[Dict[str, Any]] = []
    for sec, grp in discovery_df.groupby("sector"):
        sector_summary.append(
            {
                "sector": str(sec),
                "stock_count": int(len(grp)),
                "avg_alpha_score": round(float(grp["alpha_score"].mean()), 1),
                "pct_above_ma20": round(float(grp["above_ma20"].mean() * 100.0), 0),
                "avg_rs_20d_pct": round(float(grp["rs_20d"].mean() * 100.0), 2),
                "top_symbol": str(grp.iloc[0]["symbol"]),
                "top_score": float(grp.iloc[0]["alpha_score"]),
            }
        )
    sector_summary.sort(key=lambda x: x["avg_alpha_score"], reverse=True)

    # Portfolio Health on default sample portfolio
    positions = default_positions or {
        "VCB": 150_000_000,
        "TCB": 150_000_000,
        "HPG": 100_000_000,
        "FPT": 100_000_000,
        "MWG": 100_000_000,
    }
    returns_df = np.log(closes / closes.shift(1)).dropna(how="all")
    shares_map = {s: positions[s] / float(latest_c[s]) for s in positions if s in closes.columns}
    adv20_shares = {s: float(volumes[s].tail(20).mean()) for s in positions if s in volumes.columns}

    health = analyze_portfolio_health(
        positions=positions,
        cash_vnd=default_cash_vnd,
        returns_df=returns_df,
        sector_map=sector_map,
        shares_map=shares_map,
        adv20_map=adv20_shares,
    )

    top_candidates = [r["symbol"] for r in discovery_records[:15]]
    what_if_top: Dict[str, Any] = {}
    for sym in top_candidates:
        try:
            wi = simulate_what_if_addition(
                positions=positions,
                cash_vnd=default_cash_vnd,
                candidate_symbol=sym,
                add_amount_vnd=50_000_000,
                returns_df=returns_df,
                sector_map=sector_map,
            )
            what_if_top[sym] = wi.__dict__
        except Exception:
            continue

    # Client-side Quant Engine dataset (last 130 sessions of returns + 60 sessions close + 3-level orderbook)
    ret_tail = returns_df.tail(130)
    returns_matrix: Dict[str, List[float]] = {
        "VNINDEX": [round(float(x), 5) for x in ret_tail["VNINDEX"].fillna(0.0).tolist()]
    }
    stock_series: Dict[str, Dict[str, Any]] = {}
    for rec in discovery_records:
        sym = rec["symbol"]
        if sym not in closes.columns:
            continue
        returns_matrix[sym] = [round(float(x), 5) for x in ret_tail[sym].fillna(0.0).tolist()]
        c_tail = closes[sym].dropna().tail(60)
        m20_tail = closes[sym].dropna().rolling(20).mean().tail(60)
        ob_book = build_orderbook_snapshot_for_symbol(
            sym,
            float(rec["close_price"]),
            float(rec["adv_20_vol"]),
            float(rec["rs_20d"]),
            neo_stocks.get(sym),
        )
        stock_series[sym] = {
            "dates_60d": [str(d) for d in c_tail.index],
            "closes_60d": [round(float(x), 0) for x in c_tail.tolist()],
            "ma20_60d": [round(float(x), 0) if pd.notna(x) else None for x in m20_tail.tolist()],
            "orderbook": ob_book,
        }

    # Validation Hub
    signal_val = run_historical_signal_backtest(closes, volumes, values, sector_map)
    port_syms = [s for s in positions if s in returns_df.columns]
    w_vec = np.array([positions[s] / health.total_nav_vnd for s in port_syms])
    port_ret = pd.Series(returns_df[port_syms].dropna().to_numpy() @ w_vec)
    var_bt = backtest_historical_var(port_ret, window=120, confidence=0.95)

    return {
        "generated_at": now_vn_iso(),
        "data_mode": "live_neo_plus_ssi" if neo_mkt else "snapshot_ssi_historical",
        "latest_trading_date": str(closes.index[-1]),
        "sessions_count": int(len(closes)),
        "breadth_scope": breadth_scope,
        "breadth_counts": {"advances": advances, "declines": declines, "no_change": no_change},
        "market_regime": regime.__dict__,
        "vnindex_history": vnindex_history,
        "sector_summary": sector_summary,
        "discovery": discovery_records,
        "default_portfolio": {
            "positions": positions,
            "cash_vnd": default_cash_vnd,
            "health": health.__dict__,
            "what_if_50m": what_if_top,
        },
        "quant_client_data": {
            "dates_130d": [str(d) for d in ret_tail.index],
            "returns_130d": returns_matrix,
            "stock_series": stock_series,
        },
        "validation": {
            "signal_validation": signal_val,
            "risk_model_validation": var_bt.__dict__,
        },
        "disclaimer": (
            "Công cụ phân tích định lượng phục vụ học thuật và hỗ trợ ra quyết định. "
            "Không phải khuyến nghị đầu tư và không phát sinh lệnh giao dịch thật."
        ),
    }


def export_snapshot_json(out_path: Path | None = None, db_path: Path | str | None = None) -> Path:
    target = out_path or (ROOT_DIR / "frontend" / "public" / "data" / "snapshot.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    bundle = build_full_snapshot_bundle(db_path=db_path)
    with open(target, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
    return target
