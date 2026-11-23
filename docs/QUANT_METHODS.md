# QUANT_METHODS.md — Phương pháp Tài chính Định lượng & Giả định

## 1. Market Regime (Phân loại Bối cảnh Thị trường)
Đánh giá dựa trên 3 trụ cột độc lập (hiển thị kèm **mức độ đồng thuận**):
1. **Xu hướng (Trend):** Vị trí `VNINDEX` so với `MA20` và `MA50` (từ chuỗi lịch sử điều chỉnh).
2. **Độ lan tỏa (Breadth):** `Advance / Decline Ratio` (từ NEO API) và `% số mã trên MA20`.
3. **Thanh khoản & Dòng tiền (Liquidity & Flow):**
   - **Volume Pace (Intraday):** So sánh giá trị giao dịch lũy kế đến thời điểm $t$ với trung bình giá trị giao dịch lũy kế **tại cùng khung giờ $t$** của 5–10 phiên trước (tránh lỗi so sáng với cả ngày).
   - **Net Foreign Flow:** Giá trị mua/bán ròng khối ngoại.
- **Quy tắc gán nhãn:** `Positive` (3/3 tích cực), `Neutral` (tín hiệu trái chiều), `Defensive` (xu hướng/độ rộng suy yếu), `High Risk` (xu hướng giảm + độ rộng âm sâu + khối ngoại bán ròng/thanh khoản tụt). Đây là phân loại định lượng, **không phải dự báo chắc chắn**.

## 2. Smart Discovery — Alpha Score (0–100)
Tách riêng **Alpha Score** (chất lượng tín hiệu thị trường của mã) khỏi **Portfolio Fit Score**.

### Quy trình chuẩn hóa (chống sai lệch đơn vị & ngoại lệ)
1. Tính giá trị gốc từng chỉ tiêu trên Discovery Universe (`50–60 mã`).
2. **Winsorization** tại phân vị `[2.5%, 97.5%]` để hạn chế giá trị cực đoan.
3. **Percentile Ranking** quy đổi về thang `[0, 100]`.
4. **Xử lý thiếu dữ liệu (đặc biệt BCTC):** Không gán điểm `0` cho mã thiếu dữ liệu; gắn cờ `data_completeness`, tính điểm trên các cấu phần hợp lệ bằng cách chuẩn hóa lại tổng trọng số (và không xếp hạng nếu độ đầy đủ `< 60%`).

### 4 Cấu phần & Trọng số đề xuất
- **Trend & Momentum (35%):** Vị thế giá so với MA20/MA50 + Relative Strength (`RS_20d` so với `VNINDEX`) — chọn 1 thước đo RS chính để tránh cộng trùng lặp.
- **Liquidity & Trading Quality (25%):** Giá trị giao dịch TB 20 phiên + Volume Pace + Độ hẹp Spread + OBI (lưu ý OBI chỉ chiếm phần nhỏ ≤ 10% tổng điểm vì là tín hiệu vi cấu trúc ngắn hạn).
- **Foreign Flow (15%):** Mua/bán ròng khối ngoại chuẩn hóa theo GTGD của mã.
- **Fundamental Quality (25%):** ROE, Tăng trưởng LNST YoY, P/E tương đối so với trung vị ngành.

## 3. Portfolio Health & Portfolio Fit (What-If)
Sử dụng chuỗi lợi suất logarit ngày $r_{i,t} = \ln(P_{i,t}/P_{i,t-1})$ trên cửa sổ tối thiểu **120 phiên** (ưu tiên **250 phiên** giá điều chỉnh).

- **Độ tập trung (Concentration):**
  $$HHI_{\text{stock}} = \sum_{i=1}^{n} w_i^2, \quad N_{\text{effective}} = \frac{1}{HHI_{\text{stock}}}$$
  Tính riêng $HHI_{\text{sector}}$ theo tỷ trọng nhóm ngành.
- **Beta danh mục:** $\beta_p = \sum_{i=1}^{n} w_i \beta_i$ với $\beta_i = \frac{\text{Cov}(r_i, r_{\text{VNINDEX}})}{\text{Var}(r_{\text{VNINDEX}})}$.
- **Historical VaR & Expected Shortfall (Phương pháp chính):**
  - Với vector tỷ trọng $\mathbf{w}$, tính chuỗi lợi suất giả lập lịch sử của danh mục: $R_{p,t} = \sum_{i=1}^{n} w_i r_{i,t}$.
  - $VaR_{95\%}$ (1 ngày) = Phân vị thứ `5%` của phân phối lỗ/lãi (biểu diễn theo % và số tiền VND).
  - $ES_{95\%}$ (Expected Shortfall) = Trung bình của các phiên có mức lỗ tệ hơn $VaR_{95\%}$.
  - *(Bổ sung Parametric VaR để đối chiếu khi cần).*
- **Days-to-Liquidate (Ước lượng theo kịch bản):**
  $$DTL_i = \frac{Q_i}{ADV_{20,i} \times \text{ParticipationRate}} \quad (\text{mặc định ParticipationRate} = 10\%)$$
- **What-If Portfolio Impact (Portfolio Fit):**
  Khi người dùng nhập số tiền $\Delta C$ dự kiến mua thêm mã $k$, tính lại vector tỷ trọng mới $\mathbf{w}_{\text{after}}$ và so sánh:
  $$\Delta VaR = VaR_{\text{after}} - VaR_{\text{before}}, \quad \Delta HHI = HHI_{\text{after}} - HHI_{\text{before}}$$
  Kết hợp tương quan trung bình của mã $k$ với danh mục hiện tại để xuất **Portfolio Fit Score** độc lập.

## 4. Order Book Liquidity & Estimated Execution Cost
Từ 3 bước giá Bid/Ask (`bidPrice1..3`, `bidVol1..3`, `askPrice1..3`, `askVol1..3`) của NEO API:
- **Order Book Imbalance (3 levels):** $OBI = \frac{\sum_{k=1}^{3} V_{\text{bid},k} - \sum_{k=1}^{3} V_{\text{ask},k}}{\sum_{k=1}^{3} V_{\text{bid},k} + \sum_{k=1}^{3} V_{\text{ask},k}}$.
- **Bid-Ask Spread (%):** $\frac{Ask_1 - Bid_1}{(Ask_1 + Bid_1)/2} \times 100$.
- **Estimated Execution Cost (tách riêng Mua và Bán):**
  Với quy mô lệnh giả định $M$ (VND), tính giá khớp bình quân gia quyền $P_{\text{exec}}$ khi quét qua 3 bước giá. Nếu $M$ vượt tổng giá trị khả dụng của 3 bước giá, hệ thống báo rõ **"Không đủ độ sâu 3 bước giá để ước lượng toàn bộ lệnh"** (tuyệt đối không ngoại suy). Tách riêng với phí giao dịch & thuế giả định.
