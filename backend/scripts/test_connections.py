import asyncio
import json
import os
from pathlib import Path
from dotenv import load_dotenv
import requests
import websockets

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")


def check_env() -> None:
    keys = [
        "NEO_AUTH_URL",
        "NEO_API_BASE_URL",
        "NEO_WS_URL",
        "NEO_USERNAME",
        "NEO_PASSWORD",
        "SSI_FC_BASE_URL",
        "SSI_CONSUMER_ID",
        "SSI_CONSUMER_SECRET",
    ]
    print("=== 1. KIỂM TRA BIẾN MÔI TRƯỜNG (.env) ===")
    for k in keys:
        val = os.getenv(k, "").strip()
        is_set = bool(val) and "your_" not in val
        if k in {"NEO_PASSWORD", "SSI_CONSUMER_SECRET"}:
            display = "SET (***)" if is_set else "MISSING"
        elif is_set and len(val) > 10 and "http" not in val and "ws" not in val:
            display = f"{val[:4]}...{val[-3:]}"
        else:
            display = val if is_set else "MISSING"
        print(f"  - {k}: {display}")


def get_neo_token() -> str | None:
    print("\n=== 2. KIỂM TRA ĐĂNG NHẬP VPBankS NEO API (JWT) ===")
    auth_url = os.getenv("NEO_AUTH_URL", "https://external.vpbanks.com.vn/auth/token").strip()
    username = os.getenv("NEO_USERNAME", "").strip()
    password = os.getenv("NEO_PASSWORD", "").strip()

    if not username or not password or "your_" in username or "your_" in password:
        print("  [SKIP] Chưa điền NEO_USERNAME / NEO_PASSWORD trong .env")
        return None

    try:
        resp = requests.post(
            auth_url,
            headers={"Content-Type": "application/json"},
            json={"username": username, "password": password},
            timeout=15,
        )
        print(f"  POST {auth_url} -> HTTP {resp.status_code}")
        body = resp.json()
        if resp.status_code == 200 and body.get("status") == 1:
            token = body["data"]["access_token"]
            expires_in = body["data"].get("expires_in")
            print(f"  [OK] Lấy JWT token thành công! (expires_in={expires_in}s)")
            return token
        print(f"  [FAIL] Phản hồi NEO Auth: {body.get('code')} - {body.get('message')}")
        return None
    except Exception as exc:
        print(f"  [ERROR] Lỗi kết nối NEO Auth: {exc}")
        return None


def test_neo_rest(token: str) -> None:
    print("\n=== 3. KIỂM TRA NEO REST (Market Status, VNINDEX, Stock Detail) ===")
    base_url = os.getenv("NEO_API_BASE_URL", "https://neoapi.vpbanks.com.vn/neo-api").rstrip("/")
    headers = {
        "Authorization": f"Bearer {token}",
        "x-device": os.getenv("NEO_DEVICE_ID", "vn-alpha-radar"),
        "x-devicetype": os.getenv("NEO_DEVICE_TYPE", "chrome"),
    }

    endpoints = [
        ("Market Status", f"{base_url}/market/marketStatus?marketCode=ALL"),
        ("VNINDEX Intraday", f"{base_url}/market/intradayMarketIndex?indexCode=VNINDEX"),
        ("Stock Detail (VCB,HPG)", f"{base_url}/stock/stockDetail?symbols=VCB,HPG"),
    ]
    for name, url in endpoints:
        try:
            r = requests.get(url, headers=headers, timeout=10)
            data = r.json()
            ok = r.status_code == 200 and data.get("status") == 1
            print(f"  - {name}: HTTP {r.status_code} | status={data.get('status')} | code={data.get('code')}")
            if ok and name == "Stock Detail (VCB,HPG)":
                sample = data.get("data", {})
                print(f"    Preview keys: {str(sample)[:220]}...")
        except Exception as exc:
            print(f"  - {name}: [ERROR] {exc}")


async def test_neo_ws(token: str) -> None:
    print("\n=== 4. KIỂM TRA NEO WEBSOCKET (/stock-stream/broker) ===")
    ws_url = os.getenv("NEO_WS_URL", "wss://neoapi.vpbanks.com.vn/stock-stream/broker").strip()
    if ws_url.startswith("ws://"):
        ws_url = "wss://" + ws_url[len("ws://") :]
    try:
        async with websockets.connect(ws_url, open_timeout=10) as ws:
            await ws.send(json.dumps({"action": "auth", "data": token}))
            auth_raw = await asyncio.wait_for(ws.recv(), timeout=10)
            auth_msg = json.loads(auth_raw)
            print(f"  WS Auth -> {auth_msg.get('type')} | status={auth_msg.get('status')}")
            if auth_msg.get("status") != "success":
                print(f"  [FAIL] WS Auth lỗi: {auth_msg}")
                return

            await ws.send(json.dumps({"type": "sub", "channel": "marketInfo", "listId": ["VNINDEX"]}))
            await ws.send(json.dumps({"type": "sub", "channel": "stockInfo", "listId": ["VCB", "HPG"]}))
            print("  [OK] Đã subscribe marketInfo & stockInfo. Chờ 3 giây nhận message...")
            try:
                for _ in range(3):
                    msg = await asyncio.wait_for(ws.recv(), timeout=3)
                    print(f"  WS Msg: {msg[:200]}...")
            except asyncio.TimeoutError:
                print("  [INFO] Hết giờ chờ (ngoài giờ giao dịch có thể chưa có tick mới).")
    except Exception as exc:
        print(f"  [ERROR] Lỗi WebSocket: {repr(exc)}")


def test_ssi_fastconnect() -> None:
    print("\n=== 5. KIỂM TRA SSI FASTCONNECT API v3 ===")
    base_url = os.getenv("SSI_FC_BASE_URL", "https://api.ssi.com.vn/api/v3").rstrip("/")
    if "fc-data.ssi.com.vn" in base_url:
        base_url = "https://api.ssi.com.vn/api/v3"
    api_key = os.getenv("SSI_CONSUMER_ID", "").strip()
    api_secret = os.getenv("SSI_CONSUMER_SECRET", "").strip()

    if not api_key or "your_" in api_key:
        print("  [SKIP] Chưa điền SSI_CONSUMER_ID / SSI_CONSUMER_SECRET trong .env")
        return

    token_url = f"{base_url}/auth/token"
    try:
        resp = requests.post(
            token_url,
            json={"apiKey": api_key, "apiSecret": api_secret},
            timeout=10,
        )
        data = resp.json()
        if resp.status_code == 200 and data.get("accessToken"):
            print("  [OK] Lấy AccessToken SSI FastConnect v3 thành công!")
        else:
            print(f"  [WARN] Phản hồi SSI v3: {str(data)[:250]}")
    except Exception as exc:
        print(f"  [ERROR] Không kết nối được SSI FastConnect v3: {exc}")


if __name__ == "__main__":
    if not (ROOT_DIR / ".env").exists():
        print("[WARN] Chưa có file .env. Hãy copy .env.example thành .env.")
    check_env()
    neo_token = get_neo_token()
    if neo_token:
        test_neo_rest(neo_token)
        asyncio.run(test_neo_ws(neo_token))
    test_ssi_fastconnect()
