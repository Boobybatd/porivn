# DATA_MAPPING.md — Ma trận Dữ liệu NEO API & SSI FastConnect (Đã xác minh Schema)

## 1. Quy ước chung & Xác thực
- **Múi giờ chuẩn:** `Asia/Ho_Chi_Minh` (`+07:00`).
- **Rate Limit NEO API:** Tối đa `5 requests/giây` (5 RPS) cho REST; ưu tiên **WebSocket** cho dữ liệu thời gian thực.
- **Xác thực NEO API:**
  - `POST https://external.vpbanks.com.vn/auth/token` với `{username, password}` → nhận `access_token` (JWT, hiệu lực `10,800 giây` = 3 giờ) và `refresh_token`.
  - Bắt buộc gửi kèm các header trên mọi REST request: `Authorization: Bearer <token>`, `x-device`, `x-devicetype`.
  - Yêu cầu **IP Whitelist** (chỉ IP đã đăng ký với VPBankS mới gọi được).
- **Quy ước kiểu dữ liệu đặc biệt từ NEO API:**
  - Giá cổ phiếu cơ sở là số tiền **VND** (ví dụ `29800`).
  - `bidPrice1` và `askPrice1` có kiểu **`string`** (có thể chứa `"ATO"`, `"ATC"` hoặc chuỗi số `"29750.0"`), bắt buộc parse an toàn.
  - Các field `null` có thể bị lược bỏ hoặc trả về `null`.

## 2. Phân tách 2 phạm vi dữ liệu (Universes)
| Phạm vi | Mục đích | Quy mô | Nguồn NEO API |
|---|---|---|---|
| **Market Universe** | Đánh giá Market Regime & Độ rộng (`advances`, `declines`, `noChange`) | Toàn bộ chỉ số `VNINDEX`, `VN30` (đã có sẵn thống kê tăng/giảm toàn chỉ số từ NEO!) | `GET /market/intradayMarketIndex` & WS `marketInfo` |
| **Discovery Universe** | Chấm điểm **Alpha Score** & **Portfolio Fit** | `55 mã` thanh khoản đa ngành (`config/universe.json`) | `GET /stock/stockDetail` & WS `stockInfo` |

## 3. Bảng Data Mapping (Đã đối chiếu NeoAPI Docs)
| Nhóm dữ liệu | Trường dữ liệu chính | Nguồn | Endpoint / Kênh WebSocket chính xác | Trạng thái |
|---|---|---|---|---|
| **Xác thực JWT** | `access_token`, `refresh_token`, `expires_in` | NEO Auth | `POST https://external.vpbanks.com.vn/auth/token` | `[x] Đã khớp Doc` |
| **Trạng thái phiên** | `marketCode`, `marketStatus` (`PRE/ATO/LO/ATC/PLO/C`) | NEO REST / WS | `GET /market/marketStatus` & WS `marketSession` | `[x] Đã khớp Doc` |
| **Chỉ số & Độ rộng** | `indexValue`, `indexPercentChange`, `advances`, `declines`, `noChange`, `numberOfCe`, `numberOfFl`, `totalVolume`, `totalValue` | NEO REST / WS | `GET /market/intradayMarketIndex?indexCode=VNINDEX` & WS `marketInfo` | `[x] Đã khớp Doc` |
| **Giá & Sự kiện cổ phiếu** | `symbol`, `refPrice`, `ceilingPrice`, `floorPrice`, `closePrice`, `openPrice`, `highPrice`, `lowPrice`, `totalTradingVolume`, `totalTradingValue`, `events[]` | NEO REST / WS | `GET /stock/stockDetail?symbols=...` & WS `stockInfo` | `[x] Đã khớp Doc` |
| **Sổ lệnh 3 bước giá** | `bidPrice1..3`, `bidVol1..3`, `askPrice1..3`, `askVol1..3` | NEO REST / WS | `GET /stock/stockDetail` & WS `stockInfo` | `[x] Đã khớp Doc` |
| **Dòng tiền khối ngoại** | `foreignBuyVolume`, `foreignSellVolume`, `foreignBuyValue`, `foreignSellValue`, `foreignNetValue`, `foreignRemain`, `foreignRoom` | NEO REST / WS | `GET /stock/stockDetail` & WS `stockInfo` | `[x] Đã khớp Doc` |
| **Lịch sử OHLCV điều chỉnh** | `date`, `open`, `high`, `low`, `close`, `volume` (120–250 phiên) | **SSI FastConnect** | `GET /Market/DailyOhlc` | `[ ] Chờ test key` |
| **Chỉ số cơ bản & Tài liệu** | `PE`, `PB`, `ROE`, tăng trưởng LN + Link BCTC/Tin tức | Nguồn công khai hợp lệ | Cache định kỳ + Link trực tiếp + `events[]` từ NEO | `[ ] GĐ 2` |
