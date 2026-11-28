from dataclasses import dataclass
from typing import Literal
import numpy as np
import pandas as pd

RegimeLabel = Literal["Positive", "Neutral", "Defensive", "High Risk"]


@dataclass
class MarketRegimeResult:
    regime: RegimeLabel
    consensus_score: int  # -3 to +3
    positive_pillars: int  # 0 to 3
    trend_status: str
    breadth_status: str
    liquidity_status: str
    vnindex_close: float
    ma20: float
    ma50: float
    ad_ratio: float
    pct_above_ma20: float
    volume_pace: float
    foreign_net_value: float
    summary: str


def classify_market_regime(
    index_closes: pd.Series,
    advances: int,
    declines: int,
    pct_above_ma20: float,
    volume_pace: float,
    foreign_net_value: float,
) -> MarketRegimeResult:
    """
    Classify market regime using 3 independent pillars:
      1. Trend: VNINDEX close vs MA20 & MA50
      2. Breadth: Advance/Decline ratio & % stocks above MA20
      3. Liquidity & Flow: Same-time-of-day Volume Pace & Net Foreign Flow
    """
    if len(index_closes) < 50:
        raise ValueError("Need at least 50 sessions of index_closes to compute MA20 and MA50.")

    close = float(index_closes.iloc[-1])
    ma20 = float(index_closes.tail(20).mean())
    ma50 = float(index_closes.tail(50).mean())

    # Pillar 1: Trend
    if close > ma20 and ma20 >= ma50:
        trend_vote, trend_status = 1, "Tích cực (Trên MA20 & MA50)"
    elif close < ma20 and close < ma50:
        trend_vote, trend_status = -1, "Suy yếu (Dưới MA20 & MA50)"
    else:
        trend_vote, trend_status = 0, "Trung tính / Đi ngang"

    # Pillar 2: Breadth
    ad_ratio = float(advances) / max(float(declines), 1.0)
    if ad_ratio >= 1.25 and pct_above_ma20 >= 0.55:
        breadth_vote, breadth_status = 1, f"Lan tỏa tốt (A/D={ad_ratio:.2f}, {pct_above_ma20:.0%} > MA20)"
    elif ad_ratio <= 0.80 or pct_above_ma20 <= 0.35:
        breadth_vote, breadth_status = -1, f"Thu hẹp / Phân hóa âm (A/D={ad_ratio:.2f}, {pct_above_ma20:.0%} > MA20)"
    else:
        breadth_vote, breadth_status = 0, f"Trung tính (A/D={ad_ratio:.2f}, {pct_above_ma20:.0%} > MA20)"

    # Pillar 3: Liquidity & Foreign Flow
    fnv = float(foreign_net_value) if foreign_net_value is not None else 0.0
    if volume_pace >= 1.05 and fnv >= 0:
        liq_vote, liquidity_status = 1, f"Xác nhận dòng tiền (VolPace={volume_pace:.2f}x, Ngoại mua ròng)"
    elif volume_pace < 0.80 and fnv < 0:
        liq_vote, liquidity_status = -1, f"Thanh khoản yếu & Ngoại bán ròng (VolPace={volume_pace:.2f}x)"
    elif fnv < -300e9:
        liq_vote, liquidity_status = -1, f"Áp lực bán ròng khối ngoại lớn ({fnv/1e9:,.0f} tỷ)"
    else:
        liq_vote, liquidity_status = 0, f"Dòng tiền trung tính (VolPace={volume_pace:.2f}x)"

    consensus = trend_vote + breadth_vote + liq_vote
    pos_count = sum(1 for v in (trend_vote, breadth_vote, liq_vote) if v == 1)

    if consensus >= 2:
        regime: RegimeLabel = "Positive"
        summary = "Xu hướng, độ lan tỏa và dòng tiền đồng thuận tích cực. Phù hợp tìm kiếm cơ hội mới có chọn lọc."
    elif consensus <= -2:
        regime = "High Risk"
        summary = "Nhiều trụ cột cùng suy yếu. Ưu tiên quản trị rủi ro danh mục, hạn chế mở rộng vị thế mới."
    elif trend_vote == -1 or breadth_vote == -1:
        regime = "Defensive"
        summary = "Xu hướng hoặc độ rộng suy yếu. Chỉ giải ngân thăm dò các mã thực sự vượt trội và ít tương quan."
    else:
        regime = "Neutral"
        summary = "Tín hiệu chưa đồng thuận hoàn toàn. Nên duy trì tỷ trọng cân bằng và kiểm tra kỹ Portfolio Fit."

    return MarketRegimeResult(
        regime=regime,
        consensus_score=consensus,
        positive_pillars=pos_count,
        trend_status=trend_status,
        breadth_status=breadth_status,
        liquidity_status=liquidity_status,
        vnindex_close=round(close, 2),
        ma20=round(ma20, 2),
        ma50=round(ma50, 2),
        ad_ratio=round(ad_ratio, 2),
        pct_above_ma20=round(pct_above_ma20, 4),
        volume_pace=round(volume_pace, 2),
        foreign_net_value=round(foreign_net_value, 0),
        summary=summary,
    )
