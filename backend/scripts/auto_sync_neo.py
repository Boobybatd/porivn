"""
Automatic VPBankS NEO + SSI FastConnect v3 Sync Daemon for PORI.

Two automatic delivery channels (whichever is configured, or both):
1. Supabase Live Push (if SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY are set in .env):
   - Updates `pori_live_snapshots` in <1 second every 30s during HOSE trading hours.
   - Zero Vercel rebuilds, zero Git commit spam, near real-time across all devices.
2. GitHub Auto-Push (default fallback every 20 minutes during trading hours + 15:05 EOD):
   - Commits & pushes `frontend/public/data/snapshot.json` and `data_sample/market_data.sqlite`
     so Vercel auto-deploys updated data even without Supabase Live Push.
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR / "backend"))

from src.analytics.engine import export_snapshot_json
from src.data.db import get_connection, init_db, insert_market_snapshot, insert_stock_snapshots
from src.data.ssi_client import fetch_ssi_historical_ohlcv, load_universe
from src.neo_api.client import NeoAPIClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pori_auto_sync")
VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def latest_completed_trading_day(now_vn: datetime) -> str:
    """Return YYYY-MM-DD of the most recent completed HOSE session (Mon-Fri after 15:05)."""
    d = now_vn.date()
    hhmm = now_vn.hour * 100 + now_vn.minute
    if d.weekday() < 5 and hhmm < 1505:
        d = d - timedelta(days=1)
    while d.weekday() >= 5:
        d = d - timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def get_sqlite_max_ohlcv_date() -> str:
    try:
        with get_connection() as conn:
            row = conn.execute("SELECT MAX(trading_date) FROM daily_ohlcv").fetchone()
            return str(row[0] or "") if row else ""
    except Exception:
        return ""


def is_vn_trading_window(now_vn: datetime) -> bool:
    """Return True during HOSE Mon-Fri 08:55-11:35 and 12:55-15:08."""
    if now_vn.weekday() >= 5:
        return False
    hhmm = now_vn.hour * 100 + now_vn.minute
    return (855 <= hhmm <= 1135) or (1255 <= hhmm <= 1508)


def push_snapshot_to_supabase(snapshot_path: Path) -> bool:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not service_key or "your_" in service_key:
        return False

    try:
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
        endpoint = f"{url}/rest/v1/pori_live_snapshots"
        headers = {
            "apikey": service_key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        }
        if service_key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {service_key}"
        body = {
            "id": "latest",
            "generated_at": payload.get("generated_at"),
            "payload": payload,
        }
        resp = requests.post(endpoint, headers=headers, json=body, timeout=15)
        if resp.status_code in (200, 201, 204):
            logger.info("Supabase live snapshot pushed (mode=%s, at=%s).", payload.get("data_mode"), payload.get("generated_at"))
            return True
        logger.warning("Supabase live push HTTP %s: %s", resp.status_code, resp.text[:250])
        return False
    except Exception as exc:
        logger.warning("Supabase live push failed: %s", exc)
        return False


def git_commit_and_push(reason: str) -> bool:
    try:
        subprocess.run(
            ["git", "add", "data_sample/market_data.sqlite", "frontend/public/data/snapshot.json"],
            cwd=ROOT_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        diff = subprocess.run(
            ["git", "diff", "--staged", "--quiet"],
            cwd=ROOT_DIR,
        )
        if diff.returncode == 0:
            logger.info("No data changes to push to GitHub.")
            return True

        ts = datetime.now(VN_TZ).strftime("%Y-%m-%d %H:%M")
        subprocess.run(
            ["git", "commit", "-m", f"chore(data): auto-sync NEO+SSI ({reason} @ {ts})"],
            cwd=ROOT_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "pull", "--rebase", "-X", "ours", "origin", "main"],
            cwd=ROOT_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "push", "origin", "main"],
            cwd=ROOT_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Successfully pushed live snapshot to GitHub/Vercel (%s).", reason)
        return True
    except subprocess.CalledProcessError as exc:
        logger.warning("Git auto-push error: %s %s", exc.stdout, exc.stderr)
        return False


def run_neo_sync_cycle(neo_client: NeoAPIClient, symbols: list[str], sync_ssi_eod: bool = False) -> Path:
    init_db()
    neo_client.authenticate()

    for idx_code in ("VNINDEX", "VN30"):
        mkt = neo_client.get_intraday_index(idx_code)
        insert_market_snapshot(mkt)
        logger.info("NEO %s: value=%s, adv=%s, dec=%s", idx_code, mkt.get("index_value"), mkt.get("advances"), mkt.get("declines"))

    snaps = neo_client.get_stock_details_batch(symbols, chunk_size=30)
    saved = insert_stock_snapshots(snaps)
    logger.info("NEO REST saved %d stock orderbooks & foreign flow snapshots.", saved)

    # Keep SQLite compact during 15s real-time loops (prune intraday rows older than 24h)
    try:
        cutoff = (datetime.now(VN_TZ) - timedelta(hours=24)).isoformat(timespec="seconds")
        with get_connection() as conn:
            conn.execute("DELETE FROM intraday_market_snapshots WHERE captured_at < ?", (cutoff,))
            conn.execute("DELETE FROM intraday_stock_snapshots WHERE captured_at < ?", (cutoff,))
            conn.commit()
    except Exception:
        pass

    if sync_ssi_eod:
        try:
            logger.info("Refreshing recent SSI FastConnect v3 EOD OHLCV bars...")
            fetch_ssi_historical_ohlcv(lookback_days=15)
        except Exception as exc:
            logger.warning("SSI EOD refresh skipped due to error: %s", exc)

    out_path = export_snapshot_json()
    logger.info("Exported snapshot JSON: %s", out_path)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="PORI Automatic NEO + SSI Sync Daemon")
    parser.add_argument("--once", action="store_true", help="Run a single sync cycle and exit")
    parser.add_argument("--force", action="store_true", help="Sync even outside HOSE trading hours")
    parser.add_argument("--interval", type=int, default=60, help="Seconds between NEO REST cycles (default: 60)")
    parser.add_argument("--git-interval", type=int, default=1200, help="Seconds between GitHub pushes if no Supabase service key (default: 1200 = 20m)")
    parser.add_argument("--no-git", action="store_true", help="Disable automatic GitHub push")
    args = parser.parse_args()

    load_dotenv(ROOT_DIR / ".env")
    _, sector_map = load_universe()
    symbols = list(sector_map.keys())
    neo_client = NeoAPIClient()

    has_supabase_push = bool(os.getenv("SUPABASE_URL", "").strip() and os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip())
    logger.info(
        "PORI Auto-Sync started (Supabase Live Push: %s | Git Auto-Push: %s | Cycle: %ss)",
        "ENABLED" if has_supabase_push else "NOT SET (using Git Auto-Push)",
        "DISABLED" if args.no_git else f"every {args.git_interval}s",
        args.interval,
    )

    last_git_push_ts = 0.0
    last_eod_ssi_date = ""

    while True:
        now_vn = datetime.now(VN_TZ)
        today_str = now_vn.strftime("%Y-%m-%d")
        expected_eod = latest_completed_trading_day(now_vn)
        max_db_date = get_sqlite_max_ohlcv_date()
        needs_ssi_catchup = (not max_db_date) or (max_db_date < expected_eod)
        in_hours = is_vn_trading_window(now_vn)
        is_eod_time = now_vn.weekday() < 5 and (1502 <= (now_vn.hour * 100 + now_vn.minute) <= 1525) and last_eod_ssi_date != today_str

        if args.once or args.force or in_hours or is_eod_time or needs_ssi_catchup:
            try:
                do_ssi = is_eod_time or needs_ssi_catchup
                if needs_ssi_catchup:
                    logger.info(
                        "SQLite latest OHLCV (%s) is behind expected trading day (%s). Catching up SSI bars...",
                        max_db_date or "empty",
                        expected_eod,
                    )
                out_path = run_neo_sync_cycle(neo_client, symbols, sync_ssi_eod=do_ssi)
                if is_eod_time:
                    last_eod_ssi_date = today_str

                sb_ok = push_snapshot_to_supabase(out_path)
                now_mono = time.monotonic()

                should_git_push = (
                    not args.no_git
                    and (
                        args.once
                        or is_eod_time
                        or needs_ssi_catchup
                        or (not sb_ok and (now_mono - last_git_push_ts) >= args.git_interval)
                        or (sb_ok and (now_mono - last_git_push_ts) >= max(3600, args.git_interval))
                    )
                )
                if should_git_push:
                    if git_commit_and_push("eod" if is_eod_time else "intraday"):
                        last_git_push_ts = now_mono
            except Exception as exc:
                logger.error("Sync cycle error: %s", exc)
        else:
            logger.info("Outside HOSE trading hours (%s). Sleeping %ss...", now_vn.strftime("%H:%M"), args.interval)

        if args.once:
            break
        time.sleep(max(15, args.interval))


if __name__ == "__main__":
    main()
