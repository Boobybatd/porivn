# Pori — Portfolio-Aware Market & Risk Cockpit

**Pori** (*Portfolio + Risk*) là hệ thống phân tích bối cảnh thị trường, tầm soát cổ phiếu tiềm năng gắn với quản trị rủi ro danh mục cá nhân trên nền tảng **VPBankS NEO API** và **SSI FastConnect API v3**.

> **Tuyên bố học thuật:** Đây là công cụ phân tích định lượng phục vụ học phần *Gói phần mềm ứng dụng cho tài chính 1*, **không phải khuyến nghị đầu tư** và **không phát sinh lệnh giao dịch thật**.

## 1. Kiến trúc hệ thống
- `backend/src/neo_api/`: Client VPBankS NEO OpenAPI (JWT Auth, Rate Limiter ≤ 5 RPS, REST & WebSocket `/stock-stream/broker` tự động reconnect).
- `backend/src/data/`: Đồng bộ lịch sử OHLCV điều chỉnh (SSI FastConnect v3) và lưu trữ snapshot SQLite (`UTC+7`).
- `backend/src/finance/`: Lõi tính toán định lượng thuần (`regime.py`, `discovery.py`, `portfolio.py`, `orderbook.py`, `validation.py`).
- `backend/src/analytics/`: Tổng hợp dữ liệu, chạy What-If Portfolio Impact và xuất `frontend/public/data/snapshot.json`.
- `backend/src/api/`: FastAPI server phục vụ tương tác động.
- `frontend/`: Giao diện Web **Next.js + Tailwind CSS** (deploy trực tiếp lên **Vercel**, hỗ trợ Dual-Mode: *Live FastAPI Mode* và *Snapshot Mode* tái lập 100%).

## 2. Hướng dẫn cài đặt & chạy nhanh

### A. Backend Python & Kiểm thử (`pytest`)
```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item .env.example .env   # Điền NEO_USERNAME, NEO_PASSWORD, SSI_CONSUMER_ID, SSI_CONSUMER_SECRET

# Chạy bộ kiểm thử đơn vị (Unit tests)
$env:PYTHONPATH="backend"
.\.venv\Scripts\python.exe -m pytest backend\tests\test_finance.py -v

# Chạy FastAPI server (tùy chọn để bật Live What-If trên giao diện)
.\.venv\Scripts\uvicorn.exe src.api.main:app --app-dir backend --reload --port 8000
```

### B. Thu thập dữ liệu phiên giao dịch NEO API
```powershell
# Chạy thu thập REST + WebSocket (mặc định 60s) và tự động xuất lại snapshot.json
.\.venv\Scripts\python.exe backend\scripts\collect_neo_session.py 120
```

### C. Frontend Next.js (Chạy Local hoặc Deploy Vercel)
```powershell
cd frontend
npm install
npm run dev
```
*(Khi deploy lên Vercel: chọn `Root Directory` là `frontend`. Mọi `git push` lên GitHub sẽ tự động cập nhật bản web mới).*

## 3. Giới hạn đã biết
- Sổ lệnh NEO API chỉ cung cấp 3 bước giá Bid/Ask tốt nhất; hệ thống không ngoại suy chi phí khớp lệnh vượt quá độ sâu 3 bước giá này.
- Dữ liệu cơ bản (P/E, ROE, tăng trưởng) đang ở trạng thái tùy chọn bổ sung và được gắn cờ minh bạch khi thiếu thay vì gán 0 điểm.
