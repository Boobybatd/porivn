# VALIDATION_PLAN.md — Kế hoạch Kiểm thử & Kiểm chứng Mô hình

## 1. Kiểm thử Kỹ thuật (Unit & Integration Tests)
- **Unit Tests (`pytest` cho `src/finance/`):**
  - Kiểm chứng toán học bằng tay (hand-calculated fixtures) cho: `HHI`, `N_effective`, `Portfolio Beta`, `Historical VaR`, `Expected Shortfall`, `Days-to-Liquidate`, `OBI`, `Estimated Execution Cost`, `Percentile Ranking` & `Winsorization`.
  - Test các trường hợp biên: danh mục 1 mã (`HHI = 1`), thiếu dữ liệu BCTC, sổ lệnh không đủ độ sâu 3 bước giá, cổ phiếu không giao dịch (`volume = 0`).
- **Integration & Resilience Tests:**
  - Luồng End-to-End: API/Snapshot -> Chuẩn hóa `UTC+7` -> SQLite -> Tính toán -> FastAPI JSON -> Frontend.
  - Fault-tolerance: Giả lập mất kết nối WebSocket, HTTP `429 Rate Limit`, dữ liệu `null`/trùng timestamp → xác nhận hệ thống không crash, ghi log đầy đủ và trả trạng thái cảnh báo minh bạch.

## 2. Kiểm chứng Tín hiệu (Signal Validation)
- **Mục tiêu:** Đo xem các mã lọt Top Alpha Score có thực sự tạo ra lợi suất vượt trội so với thị trường chung hay không.
- **Quy tắc chống sai lệch (No Look-Ahead Bias):**
  - Tín hiệu chỉ được ghi nhận tại thời điểm dữ liệu đã khả dụng.
  - Lợi suất tính từ mức giá mở cửa/tham chiếu khả dụng **sau** thời điểm phát sinh tín hiệu; xử lý tách riêng trường hợp cổ phiếu không giao dịch.
- **Thước đo chính:**
  - **Average Excess Return** tại `T+3`, `T+5`, `T+10`: $\frac{1}{N}\sum (R_{i, T+k} - R_{\text{VNINDEX}, T+k})$.
  - **Win Rate (%):** Tỷ lệ tín hiệu có Excess Return dương.
  - *(Ghi chú trung thực: Nếu số phiên thu thập từ NEO API mới đạt 5–10 phiên, cần kết hợp backtest trên chuỗi lịch sử 120–250 phiên từ SSI FastConnect để có ý nghĩa thống kê, và nêu rõ sự khác biệt giữa backtest lịch sử và forward-tracking).*

## 3. Kiểm chứng Mô hình Rủi ro (Risk Model Validation — VaR Backtesting)
- **Tách bạch hoàn toàn với Signal Validation:** Kiểm định trên chuỗi lợi suất danh mục mẫu dài **120–250 phiên** (dữ liệu điều chỉnh từ SSI FastConnect).
- **Phương pháp:** Rolling Out-of-Sample VaR Exception Test — đếm số ngày mức lỗ thực tế của danh mục vượt quá mức $VaR_{95\%}$ dự báo của ngày hôm trước (tỷ lệ kỳ vọng $\approx 5\%$).

## 4. Sanity Check trên 3 Danh mục Mẫu
Chứng minh hệ thống phân biệt hợp lý giữa:
- **Danh mục A (Rủi ro tập trung cao):** 3 mã cùng 1 ngành, biến động mạnh.
- **Danh mục B (Cân bằng):** 6 mã đa ngành VN30.
- **Danh mục C (Phòng thủ):** Cổ phiếu Beta thấp + tỷ trọng tiền mặt cao.
Kỳ vọng kiểm chứng: $VaR(A) > VaR(B) > VaR(C)$ và $HHI(A) > HHI(B)$.
