import logging
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from ssi_sdk import Auth, Config, Data

ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR / "backend"))

from src.analytics.engine import export_snapshot_json
from src.data.db import init_db, insert_market_snapshot, now_vn_iso
from src.data.ssi_client import fetch_ssi_historical_ohlcv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ssi_collector")


def collect_ssi_market_summary() -> None:
    """Fallback/supplement collector using SSI FastConnect v3 while NEO IP whitelist is pending."""
    load_dotenv(ROOT_DIR / ".env")
    api_key = os.getenv("SSI_CONSUMER_ID", "").strip()
    api_secret = os.getenv("SSI_CONSUMER_SECRET", "").strip()
    if not api_key or not api_secret:
        raise RuntimeError("Missing SSI_CONSUMER_ID / SSI_CONSUMER_SECRET in .env")

    init_db()
    cfg = Config(api_key=api_key, api_secret=api_secret)
    auth = Auth(cfg)
    auth.authenticate()
    dc = Data(auth)

    for idx_code in ("VNINDEX", "VN30"):
        summary = dc.market_data.get_index_summary(idx_code)
        if summary:
            insert_market_snapshot(
                {
                    "captured_at": now_vn_iso(),
                    "index_code": idx_code,
                    "index_value": summary.index_value,
                    "prev_index_value": (
                        summary.index_value - summary.index_change
                        if summary.index_value is not None and summary.index_change is not None
                        else None
                    ),
                    "pct_change": summary.index_change_percent,
                    "total_volume": summary.total_trade,
                    "total_value": summary.total_trade_value,
                    "advances": summary.total_advance_stock,
                    "declines": summary.total_decline_stock,
                    "no_change": summary.total_steady_stock,
                    "number_of_ce": summary.total_ceiling_stock,
                    "number_of_fl": summary.total_floor_stock,
                    "market_status": f"SSI_EOD|{float(summary.net_purchases_foreign_value or 0.0)}",
                    "source": "SSI_FC_V3",
                }
            )
            logger.info(
                "Saved SSI %s summary: value=%s, advances=%s, declines=%s, foreign_net=%s",
                idx_code,
                summary.index_value,
                summary.total_advance_stock,
                summary.total_decline_stock,
                summary.net_purchases_foreign_value,
            )


def main() -> None:
    collect_ssi_market_summary()
    logger.info("Refreshing recent OHLCV bars from SSI FastConnect v3...")
    fetch_ssi_historical_ohlcv(lookback_days=30)
    out = export_snapshot_json()
    logger.info("Updated snapshot JSON at: %s", out)

    # Also push to Supabase live snapshot table if service credentials are available
    try:
        from scripts.auto_sync_neo import push_snapshot_to_supabase

        push_snapshot_to_supabase(out)
    except Exception as exc:
        logger.debug("Optional Supabase push skipped: %s", exc)


if __name__ == "__main__":
    main()
