from typing import Dict, Literal, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from pydantic import BaseModel, Field

from src.analytics.engine import (
    build_full_snapshot_bundle,
    load_latest_neo_snapshots,
    load_ohlcv_pivots,
)
from src.data.ssi_client import load_universe
from src.finance.orderbook import estimate_execution_cost
from src.finance.portfolio import analyze_portfolio_health, simulate_what_if_addition

app = FastAPI(
    title="Pori — Portfolio-Aware Market & Risk Cockpit API",
    version="1.0.0",
    description="Pori (Portfolio + Risk): Quantitative market regime, portfolio-aware stock discovery, and risk management API.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PortfolioRequest(BaseModel):
    positions: Dict[str, float] = Field(..., description="Map of symbol -> market value in VND")
    cash_vnd: float = Field(default=100_000_000, ge=0)


class WhatIfRequest(PortfolioRequest):
    candidate_symbol: str
    add_amount_vnd: float = Field(..., gt=0)
    use_existing_cash: bool = False


class ExecutionCostRequest(BaseModel):
    symbol: str
    order_value_vnd: float = Field(..., gt=0)
    side: Literal["buy", "sell"] = "buy"


@app.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/dashboard")
def get_dashboard_bundle() -> Dict:
    try:
        return build_full_snapshot_bundle()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/portfolio/health")
def post_portfolio_health(req: PortfolioRequest) -> Dict:
    try:
        _, sector_map = load_universe()
        closes, volumes, _ = load_ohlcv_pivots()
        returns_df = np.log(closes / closes.shift(1)).dropna(how="all")
        latest_c = closes.iloc[-1]
        shares_map = {
            s.upper(): v / float(latest_c[s.upper()])
            for s, v in req.positions.items()
            if s.upper() in closes.columns
        }
        adv20_map = {
            s.upper(): float(volumes[s.upper()].tail(20).mean())
            for s in req.positions
            if s.upper() in volumes.columns
        }
        res = analyze_portfolio_health(
            positions=req.positions,
            cash_vnd=req.cash_vnd,
            returns_df=returns_df,
            sector_map=sector_map,
            shares_map=shares_map,
            adv20_map=adv20_map,
        )
        return res.__dict__
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/portfolio/what-if")
def post_what_if(req: WhatIfRequest) -> Dict:
    try:
        _, sector_map = load_universe()
        closes, _, _ = load_ohlcv_pivots()
        returns_df = np.log(closes / closes.shift(1)).dropna(how="all")
        res = simulate_what_if_addition(
            positions=req.positions,
            cash_vnd=req.cash_vnd,
            candidate_symbol=req.candidate_symbol,
            add_amount_vnd=req.add_amount_vnd,
            returns_df=returns_df,
            sector_map=sector_map,
            use_existing_cash=req.use_existing_cash,
        )
        return res.__dict__
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/orderbook/execution-cost")
def post_execution_cost(req: ExecutionCostRequest) -> Dict:
    sym = req.symbol.upper()
    _, neo_stocks = load_latest_neo_snapshots()
    snap = neo_stocks.get(sym)
    if not snap:
        raise HTTPException(
            status_code=404,
            detail=f"Chưa có dữ liệu sổ lệnh 3 bước giá từ NEO API cho {sym}. Hãy chạy collector khi phiên mở.",
        )
    res = estimate_execution_cost(
        bid_prices=[snap.get("bid_price_1"), snap.get("bid_price_2"), snap.get("bid_price_3")],
        bid_vols=[snap.get("bid_vol_1"), snap.get("bid_vol_2"), snap.get("bid_vol_3")],
        ask_prices=[snap.get("ask_price_1"), snap.get("ask_price_2"), snap.get("ask_price_3")],
        ask_vols=[snap.get("ask_vol_1"), snap.get("ask_vol_2"), snap.get("ask_vol_3")],
        order_value_vnd=req.order_value_vnd,
        side=req.side,
    )
    return res.__dict__
