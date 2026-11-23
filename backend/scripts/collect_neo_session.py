import asyncio
import logging
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR / "backend"))

from src.analytics.engine import export_snapshot_json
from src.data.db import init_db, insert_market_snapshot, insert_stock_snapshots
from src.data.ssi_client import load_universe
from src.neo_api.client import NeoAPIClient, stream_neo_market_to_sqlite

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("neo_collector")


def collect_once_rest() -> None:
    """Capture a full REST snapshot of VNINDEX, VN30, and the 55-stock Discovery Universe."""
    init_db()
    _, sector_map = load_universe()
    symbols = list(sector_map.keys())

    client = NeoAPIClient()
    logger.info("Authenticating with VPBankS NEO API...")
    client.authenticate()

    for idx_code in ("VNINDEX", "VN30"):
        mkt = client.get_intraday_index(idx_code)
        insert_market_snapshot(mkt)
        logger.info("Saved market snapshot for %s (value=%s)", idx_code, mkt.get("index_value"))

    snaps = client.get_stock_details_batch(symbols, chunk_size=30)
    count = insert_stock_snapshots(snaps)
    logger.info("Saved %d stock snapshots (prices, 3-level Bid/Ask, foreign flow).", count)


def main() -> None:
    init_db()
    _, sector_map = load_universe()
    symbols = list(sector_map.keys())

    try:
        collect_once_rest()
        ws_duration = int(sys.argv[1]) if len(sys.argv) > 1 else 60
        if ws_duration > 0:
            logger.info("Starting NEO WebSocket stream collection for %ds...", ws_duration)
            saved_ws = asyncio.run(stream_neo_market_to_sqlite(symbols, duration_seconds=ws_duration))
            logger.info("WebSocket session finished. Messages persisted: %d", saved_ws)
    except Exception as exc:
        logger.error("NEO collector failed: %s", exc)
        logger.info("Exporting snapshot JSON from available SQLite data...")

    out = export_snapshot_json()
    logger.info("Exported frontend snapshot JSON to: %s", out)


if __name__ == "__main__":
    main()
