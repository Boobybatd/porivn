# PRODUCT_SPEC.md — VN Alpha Radar & Portfolio Cockpit

## 1. Định vị sản phẩm
Nền tảng phân tích bối cảnh thị trường và hỗ trợ quản trị rủi ro danh mục dành cho nhà đầu tư cá nhân trên thị trường chứng khoán Việt Nam, kết hợp dữ liệu thị trường thời gian thực từ **VPBankS NEO API**, dữ liệu lịch sử bổ trợ từ **SSI FastConnect API**, hệ thống sàng lọc cổ phiếu định lượng và mô phỏng tác động rủi ro khi thay đổi cơ cấu danh mục.

## 2. Bài toán & Người dùng mục tiêu
- **Người dùng:** Nhà đầu tư cá nhân tại Việt Nam.
- **Vấn đề giải quyết:**
  1. Không đánh giá được trạng thái thị trường hiện tại (nên giải ngân hay phòng thủ).
  2. Thường mua theo thói quen/cảm tính, bỏ lỡ các cổ phiếu tiềm năng ngoài danh sách quen thuộc.
  3. Thiếu công cụ đo lường xem **việc bổ sung một mã mới ảnh hưởng thế nào đến rủi ro tổng thể (VaR, HHI, tương quan)** của danh mục đang nắm giữ.
  4. Thiếu cơ chế lưu vết tín hiệu để tự kiểm chứng hiệu quả bộ lọc theo thời gian.

## 3. Luồng nghiệp vụ khép kín (MVP — 5 bước)
1. **Market Regime:** Xác định bối cảnh thị trường (`Positive` / `Neutral` / `Defensive` / `High Risk`) cùng mức độ đồng thuận tín hiệu.
2. **Smart Discovery:** Xếp hạng rổ cổ phiếu thanh khoản tốt (`50–60 mã`) theo **Alpha Score (0–100)** tách rời 4 cấu phần + thẻ giải thích *"Why This Stock?"*.
3. **Portfolio Health & What-If (Linh hồn sản phẩm):**
   - Khám danh mục hiện tại (nhập tay / CSV mẫu): HHI (mã & ngành), $N_{\text{effective}}$, tương quan, $\beta_p$, Historical $VaR_{95\%}$, $ES_{95\%}$, *Days-to-Liquidate*.
   - **What-If Impact:** Nhập số tiền dự kiến mua thêm vào mã $X$ → tính $\Delta VaR = VaR_{\text{after}} - VaR_{\text{before}}$, $\Delta HHI$, và thay đổi tương quan.
4. **Stock Dossier:** Tóm tắt chỉ số cơ bản + liên kết trực tiếp tới nguồn tài liệu/tin tức chính thống + *Order Book Liquidity & Estimated Execution Cost* (3 mức giá Bid/Ask).
5. **Validation Hub:** Tách riêng **Signal Validation** (Excess Return & Win Rate tại `T+3, T+5, T+10` so với `VNINDEX`) và **Risk Model Validation** (VaR backtesting).

## 4. Kiến trúc triển khai & Tính tái lập
- **Frontend:** Next.js / React deploy trên **Vercel** (tự động cập nhật khi `git push` lên GitHub).
- **Backend Core:** Python (`FastAPI` + `src/finance/` + `src/neo_api/` + `src/data/`).
- **Dual-Mode (Live & Snapshot):**
  - *Live Mode:* Chạy collector trên máy có `.env` (token + IP whitelist) để thu thập dữ liệu thật NEO API & SSI mỗi phiên giao dịch.
  - *Snapshot Mode (Mặc định trên Web/khi chấm bài):* Đọc dữ liệu thật đã lưu trong `data_sample/` (không chứa thông tin cá nhân/key thật), đảm bảo ai mở web hoặc clone repo về cũng chạy và tái lập kết quả 100%.

## 5. Lộ trình 8 ngày (22/11/2026 → 30/11/2026) & Tiêu chuẩn nghiệm thu
| Giai đoạn | Thời gian | Tiêu chuẩn nghiệm thu |
|---|---|---|
| **GĐ 0: Xác minh & Spec** | 22/11 | Hoàn tất 4 file spec; kết nối thử thành công NEO API & SSI FastConnect; khóa bảng Data Mapping thực tế. |
| **GĐ 1: Collector & Dữ liệu** | 23/11 – 27/11 | Chạy thu thập xuyên suốt **5 phiên giao dịch (T2–T6)**; lưu SQLite chuẩn `UTC+7`; xử lý reconnect, rate limit, thiếu/trùng dữ liệu. |
| **GĐ 2: Lõi Định lượng & Test** | 23/11 – 26/11 | Hoàn tất `src/finance/` + FastAPI endpoints; bộ `pytest` unit test & integration test xanh 100%. |
| **GĐ 3: Next.js UI, Kiểm chứng & Báo cáo** | 26/11 – 30/11 | Push GitHub → Auto-deploy Vercel hoàn chỉnh; xuất kết quả Validation; hoàn tất Báo cáo 8–12 trang A4 & Video Demo. |

## 6. Nguyên tắc an toàn & Tuân thủ
- Tuyệt đối **không phát sinh lệnh giao dịch thật** qua API.
- Không đưa thông tin xác thực thật vào mã nguồn, GitHub, báo cáo hay video.
- Ghi rõ mọi giả định, giới hạn mô hình và tuyên bố đây là **công cụ phân tích học thuật, không phải khuyến nghị đầu tư**.
