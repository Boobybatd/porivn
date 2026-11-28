import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional
import requests
import websockets
from dotenv import load_dotenv

from src.data.db import ROOT_DIR, insert_market_snapshot, insert_stock_snapshots, now_vn_iso
from src.finance.orderbook import parse_neo_price

logger = logging.getLogger(__name__)


class RateLimiter:
    """Simple token-spacing rate limiter to stay safely under NEO API's 5 RPS cap."""

    def __init__(self, max_rps: float = 4.0) -> None:
        self.min_interval = 1.0 / max_rps
        self._last_ts = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_ts
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self._last_ts = time.monotonic()


class NeoAPIClient:
    """VPBankS NEO OpenAPI client (REST + WebSocket Market Stream, Read-Only)."""

    def __init__(self) -> None:
        load_dotenv(ROOT_DIR / ".env")
        self.auth_url = os.getenv("NEO_AUTH_URL", "https://external.vpbanks.com.vn/auth/token").strip()
        self.base_url = os.getenv("NEO_API_BASE_URL", "https://neoapi.vpbanks.com.vn/neo-api").rstrip("/")
        ws_raw = os.getenv("NEO_WS_URL", "wss://neoapi.vpbanks.com.vn/stock-stream/broker").strip()
        if ws_raw.startswith("ws://"):
            ws_raw = "wss://" + ws_raw[len("ws://") :]
        self.ws_url = ws_raw
        self.username = os.getenv("NEO_USERNAME", "").strip()
        self.password = os.getenv("NEO_PASSWORD", "").strip()
        self.device_id = os.getenv("NEO_DEVICE_ID", "vn-alpha-radar").strip()
        self.device_type = os.getenv("NEO_DEVICE_TYPE", "chrome").strip()
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0.0
        self._limiter = RateLimiter(max_rps=4.0)

    def authenticate(self, force: bool = False) -> str:
        if not force and self._access_token and time.time() < (self._token_expires_at - 120):
            return self._access_token
        if not self.username or not self.password:
            raise RuntimeError("Missing NEO_USERNAME or NEO_PASSWORD in .env")

        self._limiter.wait()
        resp = requests.post(
            self.auth_url,
            headers={"Content-Type": "application/json"},
            json={"username": self.username, "password": self.password},
            timeout=15,
        )
        resp.raise_for_status()
        body = resp.json()
        if body.get("status") != 1 or not body.get("data", {}).get("access_token"):
            raise RuntimeError(f"NEO Auth failed: {body.get('code')} - {body.get('message')}")
        self._access_token = body["data"]["access_token"]
        expires_in = float(body["data"].get("expires_in", 10800))
        self._token_expires_at = time.time() + expires_in
        return self._access_token

    def _headers(self) -> Dict[str, str]:
        tok = self.authenticate()
        return {
            "Authorization": f"Bearer {tok}",
            "x-device": self.device_id,
            "x-devicetype": self.device_type,
        }

    def get_market_status(self, market_code: str = "ALL") -> Any:
        self._limiter.wait()
        r = requests.get(
            f"{self.base_url}/market/marketStatus",
            params={"marketCode": market_code},
            headers=self._headers(),
            timeout=10,
        )
        r.raise_for_status()
        return r.json().get("data")

    def get_intraday_index(self, index_code: str = "VNINDEX") -> Dict[str, Any]:
        self._limiter.wait()
        r = requests.get(
            f"{self.base_url}/market/intradayMarketIndex",
            params={"indexCode": index_code},
            headers=self._headers(),
            timeout=10,
        )
        r.raise_for_status()
        raw = r.json().get("data") or {}
        return {
            "captured_at": now_vn_iso(),
            "index_code": raw.get("indexCode", index_code),
            "index_value": raw.get("indexValue"),
            "prev_index_value": raw.get("prevIndexValue"),
            "pct_change": raw.get("indexPercentChange"),
            "total_volume": raw.get("totalVolume"),
            "total_value": raw.get("totalValue"),
            "advances": raw.get("advances"),
            "declines": raw.get("declines"),
            "no_change": raw.get("noChange"),
            "number_of_ce": raw.get("numberOfCe"),
            "number_of_fl": raw.get("numberOfFl"),
            "market_status": raw.get("marketStatus"),
            "source": "NEO_API_REST",
        }

    def get_stock_details_batch(self, symbols: List[str], chunk_size: int = 30) -> List[Dict[str, Any]]:
        """Fetch stock details (price, 3-level Bid/Ask, foreign flow) in comma-separated chunks."""
        out: List[Dict[str, Any]] = []
        for i in range(0, len(symbols), chunk_size):
            chunk = symbols[i : i + chunk_size]
            self._limiter.wait()
            r = requests.get(
                f"{self.base_url}/stock/stockDetail",
                params={"symbols": ",".join(chunk), "pageSize": len(chunk) + 10},
                headers=self._headers(),
                timeout=15,
            )
            r.raise_for_status()
            data = r.json().get("data")
            items = data.get("content", []) if isinstance(data, dict) else (data or [])
            ts = now_vn_iso()
            for item in items:
                out.append(normalize_neo_stock_item(item, captured_at=ts, source="NEO_API_REST"))
        return out


def _parse_neo_trading_date(raw_date: Any) -> str:
    """Convert NEO 'DD/MM/YYYY' tradingDate to 'YYYY-MM-DD'."""
    s = str(raw_date or "").strip()
    if len(s) == 10 and s[2] == "/" and s[5] == "/":
        dd, mm, yyyy = s.split("/")
        return f"{yyyy}-{mm}-{dd}"
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s
    return ""


def normalize_neo_stock_item(
    item: Dict[str, Any],
    captured_at: Optional[str] = None,
    source: str = "NEO_API_WS",
) -> Dict[str, Any]:
    """Normalize a NEO stockDetail / WS stockInfo payload into internal snapshot schema."""
    fb_val = float(item.get("foreignBuyValue") or 0.0)
    fs_val = float(item.get("foreignSellValue") or 0.0)
    fnet = item.get("foreignNetValue")
    if fnet is None:
        fnet = fb_val - fs_val

    td_iso = _parse_neo_trading_date(item.get("tradingDate"))
    raw_sess = str(item.get("tradingSession") or "").strip()
    session_tag = f"{td_iso}|{raw_sess}" if td_iso else raw_sess

    return {
        "captured_at": captured_at or now_vn_iso(),
        "symbol": str(item.get("symbol", "")).upper(),
        "ref_price": item.get("refPrice"),
        "ceiling_price": item.get("ceilingPrice"),
        "floor_price": item.get("floorPrice"),
        "last_price": item.get("closePrice"),
        "pct_change": item.get("percentPriceChange"),
        "total_volume": item.get("totalTradingVolume"),
        "total_value": item.get("totalTradingValue"),
        "bid_price_1": parse_neo_price(item.get("bidPrice1")),
        "bid_vol_1": item.get("bidVol1"),
        "bid_price_2": parse_neo_price(item.get("bidPrice2")),
        "bid_vol_2": item.get("bidVol2"),
        "bid_price_3": parse_neo_price(item.get("bidPrice3")),
        "bid_vol_3": item.get("bidVol3"),
        "ask_price_1": parse_neo_price(item.get("askPrice1")),
        "ask_vol_1": item.get("askVol1"),
        "ask_price_2": parse_neo_price(item.get("askPrice2")),
        "ask_vol_2": item.get("askVol2"),
        "ask_price_3": parse_neo_price(item.get("askPrice3")),
        "ask_vol_3": item.get("askVol3"),
        "foreign_buy_val": fb_val,
        "foreign_sell_val": fs_val,
        "foreign_net_val": float(fnet),
        "foreign_remain": item.get("foreignRemain"),
        "foreign_room": item.get("foreignRoom"),
        "trading_session": session_tag,
        "source": source,
    }


async def stream_neo_market_to_sqlite(
    symbols: List[str],
    duration_seconds: int = 300,
    db_path: Optional[str] = None,
) -> int:
    """Connect to NEO WebSocket /stock-stream/broker, subscribe marketInfo + stockInfo, persist snapshots."""
    client = NeoAPIClient()
    token = client.authenticate()
    saved = 0
    deadline = time.monotonic() + duration_seconds

    while time.monotonic() < deadline:
        try:
            async with websockets.connect(client.ws_url, open_timeout=15) as ws:
                await ws.send(json.dumps({"action": "auth", "data": token}))
                auth_resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                if auth_resp.get("status") != "success":
                    raise RuntimeError(f"WS Auth error: {auth_resp}")

                await ws.send(json.dumps({"type": "sub", "channel": "marketInfo", "listId": ["VNINDEX", "VN30"]}))
                await ws.send(json.dumps({"type": "sub", "channel": "stockInfo", "listId": symbols}))

                while time.monotonic() < deadline:
                    raw = await asyncio.wait_for(ws.recv(), timeout=30)
                    msg = json.loads(raw)
                    if "indexCode" in msg and "advances" in msg:
                        insert_market_snapshot(
                            {
                                "captured_at": now_vn_iso(),
                                "index_code": msg.get("indexCode"),
                                "index_value": float(msg["indexValue"]) if msg.get("indexValue") else None,
                                "pct_change": msg.get("indexPercentChange"),
                                "total_volume": msg.get("totalVolume"),
                                "total_value": msg.get("totalValue"),
                                "advances": msg.get("advances"),
                                "declines": msg.get("declines"),
                                "no_change": msg.get("noChange"),
                                "number_of_ce": msg.get("numberOfCe"),
                                "number_of_fl": msg.get("numberOfFl"),
                                "market_status": msg.get("marketStatus"),
                                "source": "NEO_API_WS",
                            },
                            db_path=db_path,
                        )
                        saved += 1
                    elif "symbol" in msg and "bidPrice1" in msg:
                        snap = normalize_neo_stock_item(msg, source="NEO_API_WS")
                        insert_stock_snapshots([snap], db_path=db_path)
                        saved += 1
        except asyncio.TimeoutError:
            continue
        except Exception as exc:
            logger.warning("WS stream interrupted (%s). Reconnecting in 5s...", exc)
            await asyncio.sleep(5)
    return saved
