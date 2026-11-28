import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

VN_TZ = timezone(timedelta(hours=7))
ROOT_DIR = Path(__file__).resolve().parents[3]
DEFAULT_DB_PATH = ROOT_DIR / "data_sample" / "market_data.sqlite"


def now_vn_iso() -> str:
    """Return current timestamp in Asia/Ho_Chi_Minh (+07:00) ISO 8601 format."""
    return datetime.now(VN_TZ).isoformat(timespec="seconds")


def get_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Path | str | None = None) -> Path:
    path = Path(db_path) if db_path else DEFAULT_DB_PATH
    with get_connection(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS daily_ohlcv (
                symbol TEXT NOT NULL,
                trading_date TEXT NOT NULL,
                open_price REAL NOT NULL,
                high_price REAL NOT NULL,
                low_price REAL NOT NULL,
                close_price REAL NOT NULL,
                volume REAL NOT NULL,
                value REAL NOT NULL,
                source TEXT NOT NULL DEFAULT 'SSI_FC_V3',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (symbol, trading_date)
            );

            CREATE TABLE IF NOT EXISTS intraday_market_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                index_code TEXT NOT NULL,
                index_value REAL,
                prev_index_value REAL,
                pct_change REAL,
                total_volume REAL,
                total_value REAL,
                advances INTEGER,
                declines INTEGER,
                no_change INTEGER,
                number_of_ce INTEGER,
                number_of_fl INTEGER,
                market_status TEXT,
                source TEXT NOT NULL DEFAULT 'NEO_API'
            );

            CREATE TABLE IF NOT EXISTS intraday_stock_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                symbol TEXT NOT NULL,
                ref_price REAL,
                ceiling_price REAL,
                floor_price REAL,
                last_price REAL,
                pct_change REAL,
                total_volume REAL,
                total_value REAL,
                bid_price_1 REAL,
                bid_vol_1 REAL,
                bid_price_2 REAL,
                bid_vol_2 REAL,
                bid_price_3 REAL,
                bid_vol_3 REAL,
                ask_price_1 REAL,
                ask_vol_1 REAL,
                ask_price_2 REAL,
                ask_vol_2 REAL,
                ask_price_3 REAL,
                ask_vol_3 REAL,
                foreign_buy_val REAL,
                foreign_sell_val REAL,
                foreign_net_val REAL,
                foreign_remain REAL,
                foreign_room REAL,
                trading_session TEXT,
                source TEXT NOT NULL DEFAULT 'NEO_API'
            );

            CREATE TABLE IF NOT EXISTS signal_history (
                signal_date TEXT NOT NULL,
                symbol TEXT NOT NULL,
                alpha_score REAL NOT NULL,
                trend_score REAL,
                liquidity_score REAL,
                foreign_score REAL,
                fundamental_score REAL,
                market_regime TEXT,
                entry_ref_price REAL,
                reasons_json TEXT,
                created_at TEXT NOT NULL,
                PRIMARY KEY (signal_date, symbol)
            );

            CREATE TABLE IF NOT EXISTS stock_events (
                symbol TEXT PRIMARY KEY,
                events_json TEXT NOT NULL,
                listed_shares REAL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol_date
                ON daily_ohlcv(symbol, trading_date);
            CREATE INDEX IF NOT EXISTS idx_stock_snap_sym_time
                ON intraday_stock_snapshots(symbol, captured_at);
            CREATE INDEX IF NOT EXISTS idx_market_snap_idx_time
                ON intraday_market_snapshots(index_code, captured_at);
            """
        )
        conn.commit()
    return path


def upsert_daily_ohlcv(rows: Iterable[dict[str, Any]], db_path: Path | str | None = None) -> int:
    now_str = now_vn_iso()
    data = [
        (
            r["symbol"],
            r["trading_date"],
            float(r["open_price"]),
            float(r["high_price"]),
            float(r["low_price"]),
            float(r["close_price"]),
            float(r["volume"]),
            float(r.get("value", 0.0) or 0.0),
            r.get("source", "SSI_FC_V3"),
            now_str,
        )
        for r in rows
    ]
    if not data:
        return 0
    with get_connection(db_path) as conn:
        conn.executemany(
            """
            INSERT INTO daily_ohlcv (
                symbol, trading_date, open_price, high_price, low_price,
                close_price, volume, value, source, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol, trading_date) DO UPDATE SET
                open_price=excluded.open_price,
                high_price=excluded.high_price,
                low_price=excluded.low_price,
                close_price=excluded.close_price,
                volume=excluded.volume,
                value=excluded.value,
                source=excluded.source,
                updated_at=excluded.updated_at
            """,
            data,
        )
        conn.commit()
    return len(data)


def insert_market_snapshot(snap: dict[str, Any], db_path: Path | str | None = None) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO intraday_market_snapshots (
                captured_at, index_code, index_value, prev_index_value, pct_change,
                total_volume, total_value, advances, declines, no_change,
                number_of_ce, number_of_fl, market_status, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                snap.get("captured_at") or now_vn_iso(),
                snap["index_code"],
                snap.get("index_value"),
                snap.get("prev_index_value"),
                snap.get("pct_change"),
                snap.get("total_volume"),
                snap.get("total_value"),
                snap.get("advances"),
                snap.get("declines"),
                snap.get("no_change"),
                snap.get("number_of_ce"),
                snap.get("number_of_fl"),
                snap.get("market_status"),
                snap.get("source", "NEO_API"),
            ),
        )
        conn.commit()


def insert_stock_snapshots(snaps: Iterable[dict[str, Any]], db_path: Path | str | None = None) -> int:
    now_str = now_vn_iso()
    rows = [
        (
            s.get("captured_at") or now_str,
            s["symbol"],
            s.get("ref_price"),
            s.get("ceiling_price"),
            s.get("floor_price"),
            s.get("last_price"),
            s.get("pct_change"),
            s.get("total_volume"),
            s.get("total_value"),
            s.get("bid_price_1"),
            s.get("bid_vol_1"),
            s.get("bid_price_2"),
            s.get("bid_vol_2"),
            s.get("bid_price_3"),
            s.get("bid_vol_3"),
            s.get("ask_price_1"),
            s.get("ask_vol_1"),
            s.get("ask_price_2"),
            s.get("ask_vol_2"),
            s.get("ask_price_3"),
            s.get("ask_vol_3"),
            s.get("foreign_buy_val"),
            s.get("foreign_sell_val"),
            s.get("foreign_net_val"),
            s.get("foreign_remain"),
            s.get("foreign_room"),
            s.get("trading_session"),
            s.get("source", "NEO_API"),
        )
        for s in snaps
    ]
    if not rows:
        return 0
    with get_connection(db_path) as conn:
        conn.executemany(
            """
            INSERT INTO intraday_stock_snapshots (
                captured_at, symbol, ref_price, ceiling_price, floor_price,
                last_price, pct_change, total_volume, total_value,
                bid_price_1, bid_vol_1, bid_price_2, bid_vol_2, bid_price_3, bid_vol_3,
                ask_price_1, ask_vol_1, ask_price_2, ask_vol_2, ask_price_3, ask_vol_3,
                foreign_buy_val, foreign_sell_val, foreign_net_val,
                foreign_remain, foreign_room, trading_session, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
    return len(rows)


def upsert_stock_events(items: Iterable[dict[str, Any]], db_path: Path | str | None = None) -> int:
    now_str = now_vn_iso()
    rows = []
    for it in items:
        sym = str(it.get("symbol") or "").upper().strip()
        if not sym:
            continue
        ev_list = it.get("events") or []
        listed = it.get("listed_shares")
        rows.append((sym, json.dumps(ev_list, ensure_ascii=False), float(listed) if listed else None, now_str))
    if not rows:
        return 0
    with get_connection(db_path) as conn:
        conn.executemany(
            """
            INSERT INTO stock_events (symbol, events_json, listed_shares, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                events_json=excluded.events_json,
                listed_shares=COALESCE(excluded.listed_shares, stock_events.listed_shares),
                updated_at=excluded.updated_at
            """,
            rows,
        )
        conn.commit()
    return len(rows)


def load_all_stock_events(db_path: Path | str | None = None) -> dict[str, dict[str, Any]]:
    try:
        with get_connection(db_path) as conn:
            rows = conn.execute("SELECT symbol, events_json, listed_shares, updated_at FROM stock_events").fetchall()
        out: dict[str, dict[str, Any]] = {}
        for r in rows:
            try:
                ev = json.loads(r["events_json"] or "[]")
            except Exception:
                ev = []
            out[r["symbol"]] = {
                "events": ev,
                "listed_shares": r["listed_shares"],
                "updated_at": r["updated_at"],
            }
        return out
    except Exception:
        return {}


def save_signals(signals: Iterable[dict[str, Any]], db_path: Path | str | None = None) -> int:
    now_str = now_vn_iso()
    rows = [
        (
            s["signal_date"],
            s["symbol"],
            float(s["alpha_score"]),
            s.get("trend_score"),
            s.get("liquidity_score"),
            s.get("foreign_score"),
            s.get("fundamental_score"),
            s.get("market_regime"),
            s.get("entry_ref_price"),
            json.dumps(s.get("reasons", []), ensure_ascii=False),
            now_str,
        )
        for s in signals
    ]
    if not rows:
        return 0
    with get_connection(db_path) as conn:
        conn.executemany(
            """
            INSERT INTO signal_history (
                signal_date, symbol, alpha_score, trend_score, liquidity_score,
                foreign_score, fundamental_score, market_regime, entry_ref_price,
                reasons_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(signal_date, symbol) DO UPDATE SET
                alpha_score=excluded.alpha_score,
                trend_score=excluded.trend_score,
                liquidity_score=excluded.liquidity_score,
                foreign_score=excluded.foreign_score,
                fundamental_score=excluded.fundamental_score,
                market_regime=excluded.market_regime,
                entry_ref_price=excluded.entry_ref_price,
                reasons_json=excluded.reasons_json
            """,
            rows,
        )
        conn.commit()
    return len(rows)


def upsert_stock_events(items: Iterable[dict[str, Any]], db_path: Path | str | None = None) -> int:
    now_str = now_vn_iso()
    rows = []
    for it in items:
        sym = str(it.get("symbol") or "").upper().strip()
        if not sym:
            continue
        ev_list = it.get("events") or []
        listed = it.get("listed_shares")
        rows.append((sym, json.dumps(ev_list, ensure_ascii=False), float(listed) if listed else None, now_str))
    if not rows:
        return 0
    with get_connection(db_path) as conn:
        conn.executemany(
            """
            INSERT INTO stock_events (symbol, events_json, listed_shares, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                events_json=excluded.events_json,
                listed_shares=COALESCE(excluded.listed_shares, stock_events.listed_shares),
                updated_at=excluded.updated_at
            """,
            rows,
        )
        conn.commit()
    return len(rows)


def load_all_stock_events(db_path: Path | str | None = None) -> dict[str, dict[str, Any]]:
    try:
        with get_connection(db_path) as conn:
            rows = conn.execute("SELECT symbol, events_json, listed_shares, updated_at FROM stock_events").fetchall()
        out: dict[str, dict[str, Any]] = {}
        for r in rows:
            try:
                ev = json.loads(r["events_json"] or "[]")
            except Exception:
                ev = []
            out[r["symbol"]] = {
                "events": ev,
                "listed_shares": r["listed_shares"],
                "updated_at": r["updated_at"],
            }
        return out
    except Exception:
        return {}
