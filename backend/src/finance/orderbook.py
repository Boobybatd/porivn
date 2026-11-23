from dataclasses import dataclass
from typing import Literal, Optional


def parse_neo_price(val: object) -> Optional[float]:
    """Safely parse NEO API price fields (handles 'ATO', 'ATC', None, numeric strings)."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val) if val > 0 else None
    s = str(val).strip().upper()
    if not s or s in {"ATO", "ATC", "MP", "MOK", "MAK", "MTL", "PLO", "-"}:
        return None
    try:
        num = float(s.replace(",", ""))
        return num if num > 0 else None
    except ValueError:
        return None


@dataclass
class OrderBookLiquidityResult:
    obi_3_levels: Optional[float]
    spread_pct: Optional[float]
    mid_price: Optional[float]
    total_bid_value_3l: float
    total_ask_value_3l: float
    side: Literal["buy", "sell"]
    order_value_vnd: float
    estimated_avg_price: Optional[float]
    estimated_cost_pct: Optional[float]
    sufficient_depth: bool
    note: str


def compute_obi_3_levels(
    bid_vols: list[float],
    ask_vols: list[float],
) -> Optional[float]:
    """Compute 3-level Order Book Imbalance in [-1, 1]."""
    q_bid = sum(max(0.0, float(v or 0.0)) for v in bid_vols[:3])
    q_ask = sum(max(0.0, float(v or 0.0)) for v in ask_vols[:3])
    denom = q_bid + q_ask
    if denom <= 0:
        return None
    return (q_bid - q_ask) / denom


def estimate_execution_cost(
    bid_prices: list[object],
    bid_vols: list[float],
    ask_prices: list[object],
    ask_vols: list[float],
    order_value_vnd: float,
    side: Literal["buy", "sell"] = "buy",
) -> OrderBookLiquidityResult:
    """
    Estimate Order Book Liquidity & Estimated Execution Cost across 3 Bid/Ask levels.
    Never extrapolates beyond available 3-level depth; flags insufficient depth explicitly.
    """
    b_prices = [parse_neo_price(p) for p in bid_prices[:3]]
    a_prices = [parse_neo_price(p) for p in ask_prices[:3]]
    b_vols = [max(0.0, float(v or 0.0)) for v in bid_vols[:3]]
    a_vols = [max(0.0, float(v or 0.0)) for v in ask_vols[:3]]

    b1 = b_prices[0]
    a1 = a_prices[0]
    mid_price = ((b1 + a1) / 2.0) if (b1 and a1) else (a1 or b1)
    spread_pct = (((a1 - b1) / mid_price) * 100.0) if (b1 and a1 and mid_price) else None

    total_bid_val = sum((p or 0.0) * v for p, v in zip(b_prices, b_vols))
    total_ask_val = sum((p or 0.0) * v for p, v in zip(a_prices, a_vols))
    obi = compute_obi_3_levels(b_vols, a_vols)

    levels = list(zip(a_prices, a_vols)) if side == "buy" else list(zip(b_prices, b_vols))
    remaining_vnd = max(0.0, float(order_value_vnd))
    filled_vnd = 0.0
    filled_shares = 0.0

    for price, vol in levels:
        if price is None or vol <= 0 or remaining_vnd <= 0:
            continue
        level_val = price * vol
        take_val = min(remaining_vnd, level_val)
        filled_vnd += take_val
        filled_shares += take_val / price
        remaining_vnd -= take_val

    sufficient = remaining_vnd <= 1e-6 and filled_shares > 0
    if filled_shares <= 0 or not mid_price:
        return OrderBookLiquidityResult(
            obi_3_levels=obi,
            spread_pct=spread_pct,
            mid_price=mid_price,
            total_bid_value_3l=total_bid_val,
            total_ask_value_3l=total_ask_val,
            side=side,
            order_value_vnd=order_value_vnd,
            estimated_avg_price=None,
            estimated_cost_pct=None,
            sufficient_depth=False,
            note="Không có dữ liệu giá khớp hợp lệ (phiên ATO/ATC hoặc sổ lệnh trống).",
        )

    avg_exec_price = filled_vnd / filled_shares
    if side == "buy":
        cost_pct = ((avg_exec_price - mid_price) / mid_price) * 100.0
    else:
        cost_pct = ((mid_price - avg_exec_price) / mid_price) * 100.0

    if not sufficient:
        note = (
            f"Cảnh báo: Quy mô lệnh ({order_value_vnd:,.0f} đ) vượt quá tổng độ sâu 3 bước giá "
            f"({filled_vnd:,.0f} đ). Chỉ ước lượng trên phần khớp được; không ngoại suy phần dư."
        )
    else:
        note = "Đủ độ sâu 3 bước giá để ước lượng chi phí khớp lệnh tức thời (chưa gồm phí/thuế)."

    return OrderBookLiquidityResult(
        obi_3_levels=round(obi, 4) if obi is not None else None,
        spread_pct=round(spread_pct, 4) if spread_pct is not None else None,
        mid_price=round(mid_price, 2),
        total_bid_value_3l=round(total_bid_val, 0),
        total_ask_value_3l=round(total_ask_val, 0),
        side=side,
        order_value_vnd=order_value_vnd,
        estimated_avg_price=round(avg_exec_price, 2),
        estimated_cost_pct=round(max(0.0, cost_pct), 4),
        sufficient_depth=sufficient,
        note=note,
    )
