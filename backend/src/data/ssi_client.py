import json
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv
from ssi_sdk import Auth, Config, Data

from src.data.db import ROOT_DIR, VN_TZ, init_db, upsert_daily_ohlcv

logger = logging.getLogger(__name__)


def load_universe(config_path: Path | None = None) -> tuple[list[str], dict[str, str]]:
    """Return (all_symbols_with_indices, symbol_to_sector_map)."""
    path = config_path or (ROOT_DIR / "backend" / "config" / "universe.json")
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    sector_map: dict[str, str] = {}
    for sector, syms in cfg["sectors"].items():
        for s in syms:
            sector_map[s] = sector
    all_symbols = list(cfg.get("indices", [])) + list(sector_map.keys())
    return all_symbols, sector_map


def fetch_ssi_historical_ohlcv(
    symbols: list[str] | None = None,
    lookback_days: int = 380,
    db_path: Path | None = None,
) -> dict[str, int]:
    """Fetch ~250 trading sessions (380 calendar days) from SSI FastConnect v3 into SQLite."""
    load_dotenv(ROOT_DIR / ".env")
    api_key = os.getenv("SSI_CONSUMER_ID", "").strip()
    api_secret = os.getenv("SSI_CONSUMER_SECRET", "").strip()
    if not api_key or not api_secret:
        raise RuntimeError("Missing SSI_CONSUMER_ID or SSI_CONSUMER_SECRET in .env")

    init_db(db_path)
    if symbols is None:
        symbols, _ = load_universe()

    cfg = Config(api_key=api_key, api_secret=api_secret)
    auth = Auth(cfg)
    auth.authenticate()
    dc = Data(auth)

    end_dt = datetime.now(VN_TZ).date()
    start_dt = end_dt - timedelta(days=lookback_days)
    from_str = start_dt.strftime("%Y/%m/%d")
    to_str = end_dt.strftime("%Y/%m/%d")

    counts: dict[str, int] = {}
    for idx, sym in enumerate(symbols, start=1):
        try:
            bars = dc.market_data.get_ohlc_1day_historical(
                symbol=sym,
                from_date=from_str,
                to_date=to_str,
                page=1,
                size=1000,
            )
            rows = [
                {
                    "symbol": b.symbol,
                    "trading_date": b.trading_date.replace("/", "-"),
                    "open_price": b.open_price,
                    "high_price": b.high_price,
                    "low_price": b.low_price,
                    "close_price": b.close_price,
                    "volume": b.volume,
                    "value": getattr(b, "value", 0.0) or 0.0,
                    "source": "SSI_FC_V3",
                }
                for b in bars
            ]
            inserted = upsert_daily_ohlcv(rows, db_path=db_path)
            counts[sym] = inserted
            if idx % 10 == 0 or idx == len(symbols):
                print(f"[{idx}/{len(symbols)}] Synced {sym}: {inserted} bars")
            time.sleep(0.15)
        except Exception as exc:
            logger.warning("Failed to fetch SSI OHLCV for %s: %s", sym, exc)
            counts[sym] = 0
    return counts


if __name__ == "__main__":
    import sys

    sys.path.insert(0, str(ROOT_DIR / "backend"))
    res = fetch_ssi_historical_ohlcv()
    total = sum(res.values())
    print(f"Done! Total bars synced across {len(res)} symbols: {total}")
