import type {
  DiscoveryStock,
  OrderBookSnapshot,
  PortfolioHealth,
  WhatIfResult,
} from "@/types/radar";

const SECTOR_VN_MAP: Record<string, string> = {
  Banking: "Ngân hàng",
  Securities: "Chứng khoán",
  RealEstate: "Bất động sản",
  Materials_Steel: "Thép & Vật liệu",
  Retail_Consumer: "Bán lẻ & Tiêu dùng",
  Technology_Telecom: "Công nghệ & Viễn thông",
  Oil_Gas_Energy: "Dầu khí & Năng lượng",
  Industrial_Logistics: "Công nghiệp & Cảng biển",
  Other: "Khác",
};

export function vnSectorName(sec?: string): string {
  if (!sec) return "Khác";
  return SECTOR_VN_MAP[sec] || sec;
}

export function computeHhi(weights: number[]): { hhi: number; nEff: number } {
  const clean = weights.filter((w) => w > 0);
  const total = clean.reduce((a, b) => a + b, 0);
  if (total <= 0) return { hhi: 0, nEff: 0 };
  const norm = clean.map((w) => w / total);
  const hhi = norm.reduce((acc, w) => acc + w * w, 0);
  return { hhi, nEff: hhi > 0 ? 1 / hhi : 0 };
}

export function pearsonCorr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let sumA = 0,
    sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0,
    denA = 0,
    denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

export function computeClientPortfolioHealth(
  positions: Record<string, number>,
  cashVnd: number,
  returnsMap: Record<string, number[]>,
  discoveryMap: Record<string, DiscoveryStock>
): PortfolioHealth | null {
  const syms = Object.keys(positions)
    .map((s) => s.toUpperCase())
    .filter((s) => positions[s] > 0 && returnsMap[s] && returnsMap[s].length > 20);

  if (syms.length === 0) {
    const cleanCash = Math.max(0, cashVnd);
    if (cleanCash <= 0) {
      return {
        total_nav_vnd: 0,
        equity_value_vnd: 0,
        cash_vnd: 0,
        cash_weight: 1,
        hhi_stock: 0,
        n_effective_stock: 0,
        hhi_sector: 0,
        portfolio_beta: 0,
        hist_var_95_pct: 0,
        hist_var_95_vnd: 0,
        hist_es_95_pct: 0,
        hist_es_95_vnd: 0,
        param_var_95_pct: 0,
        annualized_vol_pct: 0,
        health_score: 50,
        sector_weights: {},
        correlation_matrix: {},
        days_to_liquidate: {},
        stress_tests: {
          "VNINDEX -3% (Theo Beta)": 0,
          "VNINDEX -5% (Theo Beta)": 0,
          "VNINDEX -7% (Bán tháo)": 0,
        },
        warnings: ["Chưa có cổ phiếu nào trong danh mục. Hãy nhập vốn hoặc thêm mã để mô phỏng."],
        daily_returns_series: [],
        component_risk_pct: {},
      };
    }
    return {
      total_nav_vnd: Math.round(cleanCash),
      equity_value_vnd: 0,
      cash_vnd: Math.round(cleanCash),
      cash_weight: 1,
      hhi_stock: 0,
      n_effective_stock: 0,
      hhi_sector: 0,
      portfolio_beta: 0,
      hist_var_95_pct: 0,
      hist_var_95_vnd: 0,
      hist_es_95_pct: 0,
      hist_es_95_vnd: 0,
      param_var_95_pct: 0,
      annualized_vol_pct: 0,
      health_score: 72,
      sector_weights: {},
      correlation_matrix: {},
      days_to_liquidate: {},
      stress_tests: {
        "VNINDEX -3% (Theo Beta)": 0,
        "VNINDEX -5% (Theo Beta)": 0,
        "VNINDEX -7% (Bán tháo)": 0,
      },
      warnings: ["Đang giữ 100% tiền mặt — Chưa phát sinh rủi ro biến động giá cổ phiếu."],
      daily_returns_series: [],
      component_risk_pct: {},
    };
  }

  const equityVal = syms.reduce((acc, s) => acc + positions[s], 0);
  const cleanCash = Math.max(0, cashVnd);
  const totalNav = equityVal + cleanCash;
  if (totalNav <= 0) return null;

  const wNav: Record<string, number> = {};
  const wEq: Record<string, number> = {};
  syms.forEach((s) => {
    wNav[s] = positions[s] / totalNav;
    wEq[s] = positions[s] / equityVal;
  });
  const cashWeight = cleanCash / totalNav;

  const { hhi: hhiStock, nEff: nEffStock } = computeHhi(Object.values(wEq));

  const sectorWeights: Record<string, number> = {};
  syms.forEach((s) => {
    const sec = vnSectorName(discoveryMap[s]?.sector);
    sectorWeights[sec] = (sectorWeights[sec] || 0) + wEq[s];
  });
  const { hhi: hhiSector } = computeHhi(Object.values(sectorWeights));

  const nSessions = returnsMap[syms[0]].length;
  const portRet: number[] = new Array(nSessions).fill(0);
  for (let t = 0; t < nSessions; t++) {
    let r = 0;
    for (const s of syms) {
      r += wNav[s] * (returnsMap[s][t] ?? 0);
    }
    portRet[t] = r;
  }

  // Historical VaR 95% and ES 95%
  const sorted = [...portRet].sort((a, b) => a - b);
  const qIdx = Math.max(0, Math.floor(0.05 * sorted.length));
  const qVal = sorted[qIdx];
  const histVar95Pct = Math.max(0, -qVal);
  const tail = sorted.slice(0, qIdx + 1);
  const tailMean = tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length);
  const histEs95Pct = Math.max(histVar95Pct, -tailMean);

  // Mean & Std Dev
  const meanRet = portRet.reduce((a, b) => a + b, 0) / nSessions;
  const variance =
    portRet.reduce((acc, r) => acc + (r - meanRet) * (r - meanRet), 0) /
    Math.max(1, nSessions - 1);
  const sigmaDaily = Math.sqrt(variance);
  const paramVar95Pct = Math.max(0, 1.64485 * sigmaDaily - meanRet);
  const annVolPct = sigmaDaily * Math.sqrt(252);

  // Marginal / Component Risk Contribution (% of portfolio variance contributed by each stock)
  const componentRiskPct: Record<string, number> = {};
  if (variance > 0) {
    let totalComp = 0;
    const rawComp: Record<string, number> = {};
    syms.forEach((s) => {
      const sArr = returnsMap[s];
      const sMean = sArr.reduce((a, b) => a + b, 0) / nSessions;
      let covWithPort = 0;
      for (let t = 0; t < nSessions; t++) {
        covWithPort += (sArr[t] - sMean) * (portRet[t] - meanRet);
      }
      covWithPort /= Math.max(1, nSessions - 1);
      rawComp[s] = Math.max(0, wNav[s] * covWithPort);
      totalComp += rawComp[s];
    });
    syms.forEach((s) => {
      componentRiskPct[s] = totalComp > 0 ? Number(((rawComp[s] / totalComp) * 100).toFixed(1)) : 0;
    });
  }

  // Beta vs VNINDEX
  let portBeta = 1.0;
  const mkt = returnsMap["VNINDEX"];
  if (mkt && mkt.length === nSessions) {
    const mktMean = mkt.reduce((a, b) => a + b, 0) / nSessions;
    let cov = 0,
      mktVar = 0;
    for (let t = 0; t < nSessions; t++) {
      cov += (portRet[t] - meanRet) * (mkt[t] - mktMean);
      mktVar += (mkt[t] - mktMean) * (mkt[t] - mktMean);
    }
    if (mktVar > 0) portBeta = cov / mktVar;
  }

  // Correlation matrix
  const corrMatrix: Record<string, Record<string, number>> = {};
  for (const rSym of syms) {
    corrMatrix[rSym] = {};
    for (const cSym of syms) {
      corrMatrix[rSym][cSym] =
        rSym === cSym ? 1.0 : Number(pearsonCorr(returnsMap[rSym], returnsMap[cSym]).toFixed(3));
    }
  }

  // Days to liquidate (@ 10% ADV20)
  const dtlMap: Record<string, number> = {};
  syms.forEach((s) => {
    const info = discoveryMap[s];
    if (info && info.adv_20_val > 0) {
      dtlMap[s] = Number((positions[s] / (info.adv_20_val * 0.1)).toFixed(2));
    } else {
      dtlMap[s] = 0.2;
    }
  });

  // Multi-dimensional Stress Tests (Market Beta + Sector Shocks + Correlation Spike)
  const topSectorEntry = Object.entries(sectorWeights).sort((a, b) => b[1] - a[1])[0];
  const topSectorName = topSectorEntry ? topSectorEntry[0] : "Ngân hàng";
  const topSectorVal = topSectorEntry ? topSectorEntry[1] * equityVal : 0;

  const stressTests: Record<string, number> = {
    "VNINDEX -3% (Theo Beta)": Math.round(-0.03 * portBeta * totalNav),
    "VNINDEX -5% (Theo Beta)": Math.round(-0.05 * portBeta * totalNav),
    "VNINDEX -7% (Bán tháo)": Math.round(-0.07 * portBeta * totalNav),
    [`Cú sốc ngành ${topSectorName} (-7%)`]: Math.round(-0.07 * topSectorVal - 0.02 * (equityVal - topSectorVal)),
    "Khủng hoảng Tương quan (ρ → 1.0)": Math.round(-histEs95Pct * 1.35 * totalNav),
  };

  const warnings: string[] = [];
  if (hhiStock > 0.25) {
    warnings.push(
      `Độ tập trung cổ phiếu cao (HHI=${hhiStock.toFixed(2)}, N hiệu dụng=${nEffStock.toFixed(1)} mã).`
    );
  }
  if (topSectorEntry && topSectorEntry[1] > 0.45) {
    warnings.push(
      `Tập trung ngành ${topSectorEntry[0]} chiếm ${(topSectorEntry[1] * 100).toFixed(0)}% tỷ trọng cổ phiếu.`
    );
  }
  if (histVar95Pct > 0.03) {
    warnings.push(
      `VaR 95% 1 ngày ở mức cao (${(histVar95Pct * 100).toFixed(2)}% ~ ${Math.round(
        histVar95Pct * totalNav
      ).toLocaleString("vi-VN")} đ).`
    );
  }
  Object.entries(dtlMap).forEach(([s, dtl]) => {
    if (dtl > 3.0) {
      warnings.push(`${s} cần ~${dtl.toFixed(1)} phiên để thoát vị thế ở mức tham gia 10% ADV.`);
    }
  });

  const divScore = Math.max(0, Math.min(100, 100 * (1 - (hhiStock - 0.1) / 0.4)));
  const riskScore = Math.max(0, Math.min(100, 100 * (1 - (histVar95Pct - 0.01) / 0.035)));
  const cashScore = Math.max(0, Math.min(100, (cashWeight / 0.2) * 100));
  const maxDtl = Math.max(0.5, ...Object.values(dtlMap));
  const liqScore = Math.max(0, Math.min(100, 100 * (1 - Math.max(0, maxDtl - 1.0) / 5.0)));
  const healthScore = 0.3 * divScore + 0.35 * riskScore + 0.2 * liqScore + 0.15 * cashScore;

  return {
    total_nav_vnd: Math.round(totalNav),
    equity_value_vnd: Math.round(equityVal),
    cash_vnd: Math.round(cleanCash),
    cash_weight: Number(cashWeight.toFixed(4)),
    hhi_stock: Number(hhiStock.toFixed(4)),
    n_effective_stock: Number(nEffStock.toFixed(2)),
    hhi_sector: Number(hhiSector.toFixed(4)),
    portfolio_beta: Number(portBeta.toFixed(3)),
    hist_var_95_pct: Number(histVar95Pct.toFixed(5)),
    hist_var_95_vnd: Math.round(histVar95Pct * totalNav),
    hist_es_95_pct: Number(histEs95Pct.toFixed(5)),
    hist_es_95_vnd: Math.round(histEs95Pct * totalNav),
    param_var_95_pct: Number(paramVar95Pct.toFixed(5)),
    annualized_vol_pct: Number(annVolPct.toFixed(4)),
    health_score: Number(healthScore.toFixed(1)),
    sector_weights: sectorWeights,
    correlation_matrix: corrMatrix,
    days_to_liquidate: dtlMap,
    stress_tests: stressTests,
    warnings,
    daily_returns_series: portRet,
    component_risk_pct: componentRiskPct,
  };
}

export function computeClientWhatIf(
  positions: Record<string, number>,
  cashVnd: number,
  candidateSymbol: string,
  addAmountVnd: number,
  returnsMap: Record<string, number[]>,
  discoveryMap: Record<string, DiscoveryStock>
): WhatIfResult | null {
  const sym = candidateSymbol.toUpperCase();
  if (!returnsMap[sym] || addAmountVnd <= 0) return null;

  const before = computeClientPortfolioHealth(positions, cashVnd, returnsMap, discoveryMap);
  if (!before) return null;

  const nextPos = { ...positions, [sym]: (positions[sym] || 0) + addAmountVnd };
  const after = computeClientPortfolioHealth(nextPos, cashVnd, returnsMap, discoveryMap);
  if (!after) return null;

  const existingSyms = Object.keys(positions)
    .map((s) => s.toUpperCase())
    .filter((s) => positions[s] > 0 && returnsMap[s] && s !== sym);

  const pairwiseCorr: Record<string, number> = {};
  let avgCorr = (positions[sym] || 0) > 0 ? 1.0 : 0.0;
  if (existingSyms.length > 0) {
    const corrs = existingSyms.map((s) => {
      const c = pearsonCorr(returnsMap[s], returnsMap[sym]);
      pairwiseCorr[s] = Number(c.toFixed(2));
      return c;
    });
    avgCorr = corrs.reduce((a, b) => a + b, 0) / corrs.length;
  }

  const sec = vnSectorName(discoveryMap[sym]?.sector);
  const secBefore = Number(((before.sector_weights[sec] || 0) * 100).toFixed(1));
  const secAfter = Number(((after.sector_weights[sec] || 0) * 100).toFixed(1));

  const adv20Val = discoveryMap[sym]?.adv_20_val || 0;
  const totalCandidatePos = (positions[sym] || 0) + addAmountVnd;
  const candidateDtl = adv20Val > 0 ? Number((totalCandidatePos / (adv20Val * 0.1)).toFixed(2)) : 0.5;
  const liqFeasible = candidateDtl <= 1.0;

  const deltaVarVnd = after.hist_var_95_vnd - before.hist_var_95_vnd;
  const deltaVarPct = after.hist_var_95_pct - before.hist_var_95_pct;
  const deltaEsVnd = after.hist_es_95_vnd - before.hist_es_95_vnd;
  const deltaHhiStock = after.hhi_stock - before.hhi_stock;

  const corrComp = Math.max(0, Math.min(100, (1 - avgCorr) * 100));
  const varComp = Math.max(0, Math.min(100, 50 - (deltaVarPct / 0.005) * 25));
  const hhiComp = Math.max(0, Math.min(100, 50 - (deltaHhiStock / 0.05) * 25));
  const fitScore = Number((0.45 * varComp + 0.35 * corrComp + 0.2 * hhiComp).toFixed(1));

  const varDir = deltaVarPct <= 0 ? "giảm tỷ lệ rủi ro" : "tăng tỷ lệ rủi ro";
  const hhiDir = deltaHhiStock <= 0 ? "giảm tập trung" : "tăng tập trung";

  return {
    candidate_symbol: sym,
    candidate_sector: sec,
    add_amount_vnd: Math.round(addAmountVnd),
    nav_before: before.total_nav_vnd,
    nav_after: after.total_nav_vnd,
    var_95_before_vnd: before.hist_var_95_vnd,
    var_95_after_vnd: after.hist_var_95_vnd,
    delta_var_vnd: Math.round(deltaVarVnd),
    delta_var_pct: Number(deltaVarPct.toFixed(5)),
    es_95_before_vnd: before.hist_es_95_vnd,
    es_95_after_vnd: after.hist_es_95_vnd,
    delta_es_vnd: Math.round(deltaEsVnd),
    hhi_stock_before: before.hhi_stock,
    hhi_stock_after: after.hhi_stock,
    delta_hhi_stock: Number(deltaHhiStock.toFixed(4)),
    hhi_sector_before: before.hhi_sector,
    hhi_sector_after: after.hhi_sector,
    sector_weight_before: secBefore,
    sector_weight_after: secAfter,
    avg_corr_with_portfolio: Number(avgCorr.toFixed(3)),
    pairwise_corr: pairwiseCorr,
    candidate_dtl_days: candidateDtl,
    liquidity_feasible: liqFeasible,
    portfolio_fit_score: fitScore,
    explanation: `Thêm ${addAmountVnd.toLocaleString("vi-VN")} đ vào ${sym} (${sec}): Tỷ trọng ngành ${sec} từ ${secBefore}% → ${secAfter}%; VaR 95% (% NAV) từ ${(
      before.hist_var_95_pct * 100
    ).toFixed(2)}% → ${(after.hist_var_95_pct * 100).toFixed(2)}% (${varDir}), HHI mã ${hhiDir} (${before.hhi_stock.toFixed(
      3
    )} → ${after.hhi_stock.toFixed(3)}), tương quan TB = ${avgCorr.toFixed(2)}, thanh khoản thoát vị thế DTL = ${candidateDtl} phiên.`,
  };
}

export interface ClientOrderBookEvaluation {
  obi_3_levels: number;
  spread_pct: number;
  mid_price: number;
  total_bid_value_3l: number;
  total_ask_value_3l: number;
  side: "buy" | "sell";
  order_value_vnd: number;
  filled_value_vnd: number;
  filled_shares: number;
  estimated_avg_price: number;
  estimated_cost_pct: number;
  fee_tax_pct: number;
  sufficient_depth: boolean;
  level_fills: Array<{ level: number; price: number; availVol: number; filledVol: number; valueVnd: number }>;
  note: string;
}

export function evaluateClientOrderBook(
  book: OrderBookSnapshot,
  orderValueVnd: number,
  side: "buy" | "sell"
): ClientOrderBookEvaluation {
  const bPrices = book.bid_prices.slice(0, 3);
  const bVols = book.bid_vols.slice(0, 3);
  const aPrices = book.ask_prices.slice(0, 3);
  const aVols = book.ask_vols.slice(0, 3);

  const qBid = bVols.reduce((a, b) => a + b, 0);
  const qAsk = aVols.reduce((a, b) => a + b, 0);
  const obi = qBid + qAsk > 0 ? (qBid - qAsk) / (qBid + qAsk) : 0;

  const b1 = bPrices[0] || 0;
  const a1 = aPrices[0] || 0;
  const midPrice = b1 > 0 && a1 > 0 ? (b1 + a1) / 2 : a1 || b1;
  const spreadPct = midPrice > 0 ? ((a1 - b1) / midPrice) * 100 : 0;

  const totalBidVal = bPrices.reduce((acc, p, i) => acc + p * (bVols[i] || 0), 0);
  const totalAskVal = aPrices.reduce((acc, p, i) => acc + p * (aVols[i] || 0), 0);

  const prices = side === "buy" ? aPrices : bPrices;
  const vols = side === "buy" ? aVols : bVols;

  let remVnd = Math.max(0, orderValueVnd);
  let filledVnd = 0;
  let filledShares = 0;
  const levelFills: Array<{ level: number; price: number; availVol: number; filledVol: number; valueVnd: number }> = [];

  for (let i = 0; i < 3; i++) {
    const p = prices[i] || 0;
    const v = vols[i] || 0;
    if (p <= 0 || v <= 0) continue;
    const lvlVal = p * v;
    const takeVal = Math.min(remVnd, lvlVal);
    const takeShares = takeVal / p;
    filledVnd += takeVal;
    filledShares += takeShares;
    remVnd -= takeVal;
    levelFills.push({
      level: i + 1,
      price: p,
      availVol: v,
      filledVol: Math.round(takeShares),
      valueVnd: Math.round(takeVal),
    });
  }

  const sufficient = remVnd <= 1 && filledShares > 0;
  const avgPrice = filledShares > 0 ? filledVnd / filledShares : midPrice;
  const rawCostPct =
    midPrice > 0
      ? side === "buy"
        ? ((avgPrice - midPrice) / midPrice) * 100
        : ((midPrice - avgPrice) / midPrice) * 100
      : 0;
  const feeTaxPct = side === "buy" ? 0.15 : 0.25;

  const note = sufficient
    ? `Đủ độ sâu 3 bước giá để khớp toàn bộ ${orderValueVnd.toLocaleString("vi-VN")} đ. Tách riêng Độ trượt giá sổ lệnh (${Math.max(
        0,
        rawCostPct
      ).toFixed(3)}%) và Phí/Thuế giả định (${feeTaxPct.toFixed(2)}%).`
    : `CẢNH BÁO GIỚI HẠN ĐỘ SÂU: Quy mô lệnh (${orderValueVnd.toLocaleString(
        "vi-VN"
      )} đ) vượt quá tổng 3 bước giá (${Math.round(filledVnd).toLocaleString(
        "vi-VN"
      )} đ). Chỉ tính trên phần khớp được (${((filledVnd / orderValueVnd) * 100).toFixed(
        1
      )}%); tuyệt đối không ngoại suy phần dư.`;

  return {
    obi_3_levels: Number(obi.toFixed(4)),
    spread_pct: Number(spreadPct.toFixed(4)),
    mid_price: Number(midPrice.toFixed(1)),
    total_bid_value_3l: Math.round(totalBidVal),
    total_ask_value_3l: Math.round(totalAskVal),
    side,
    order_value_vnd: orderValueVnd,
    filled_value_vnd: Math.round(filledVnd),
    filled_shares: Math.round(filledShares),
    estimated_avg_price: Number(avgPrice.toFixed(1)),
    estimated_cost_pct: Number(Math.max(0, rawCostPct).toFixed(4)),
    fee_tax_pct: feeTaxPct,
    sufficient_depth: sufficient,
    level_fills: levelFills,
    note,
  };
}

export interface CapitalAllocationAdvice {
  capitalVnd: number;
  tier: "SMALL" | "MEDIUM" | "LARGE";
  tierTitle: string;
  recommendedCountLabel: string;
  minPosSizeVnd: number;
  currentCount: number;
  recommendedCashPct: number;
  verdictBadge: string;
  shouldDiversifyMore: boolean;
  headline: string;
  rationale: string;
  suggestedCandidates: Array<{
    symbol: string;
    sector: string;
    poriScore: number;
    fitScore: number;
    avgCorr: number;
    suggestedAmountVnd: number;
    reason: string;
  }>;
  actionChecklist: string[];
}

export function computeCapitalAllocationAdvice(
  capitalVnd: number,
  positions: Record<string, number>,
  health: PortfolioHealth,
  regime: "Positive" | "Neutral" | "Defensive" | "High Risk",
  discovery: DiscoveryStock[],
  portfolioFitBySymbol: Record<string, WhatIfResult>
): CapitalAllocationAdvice {
  const cleanCap = Math.max(0, capitalVnd);
  const activeEntries = Object.entries(positions).filter(([, v]) => v > 0);
  const currentCount = activeEntries.length;

  const isRiskyMkt = regime === "High Risk" || regime === "Defensive";
  const recommendedCashPct =
    regime === "High Risk" ? 45 : regime === "Defensive" ? 30 : regime === "Neutral" ? 20 : 10;

  let tier: "SMALL" | "MEDIUM" | "LARGE" = "MEDIUM";
  let tierTitle = "Vốn trung bình (50 – 300 triệu) • Lõi & Vệ tinh";
  let recommendedCountLabel = "2 – 4 mã (2–3 ngành tương quan thấp)";
  let maxIdealCount = 4;
  let minIdealCount = 2;
  let minPosSizeVnd = 25_000_000;

  if (cleanCap < 50_000_000) {
    tier = "SMALL";
    tierTitle = "Vốn nhỏ (< 50 triệu) • Tập trung có kiểm soát";
    recommendedCountLabel = "1 – 2 mã (Không dàn trải)";
    maxIdealCount = 2;
    minIdealCount = 1;
    minPosSizeVnd = 15_000_000;
  } else if (cleanCap > 300_000_000) {
    tier = "LARGE";
    tierTitle = "Vốn lớn (> 300 triệu) • Cân bằng rủi ro & Thanh khoản";
    recommendedCountLabel = "4 – 7 mã (Đa ngành, kiểm soát HHI < 0.25)";
    maxIdealCount = 7;
    minIdealCount = 4;
    minPosSizeVnd = 50_000_000;
  }

  const deployableBudget = Math.round(cleanCap * (1 - recommendedCashPct / 100));
  const actionChecklist: string[] = [];
  let shouldDiversifyMore = true;
  let verdictBadge = "CÂN ĐỐI PHÂN BỔ";
  let headline = "";
  let rationale = "";

  const sortedHoldings = [...activeEntries].sort((a, b) => b[1] - a[1]);
  const smallestHoldings = [...activeEntries].sort((a, b) => a[1] - b[1]);
  const topSectorEntry = Object.entries(health.sector_weights).sort((a, b) => b[1] - a[1])[0];

  if (tier === "SMALL") {
    shouldDiversifyMore = currentCount === 0;
    if (currentCount >= 3) {
      verdictBadge = "KHÔNG NÊN ĐA DẠNG HÓA THÊM";
      headline = `Vốn ${(cleanCap / 1e6).toFixed(0)} triệu đang giữ ${currentCount} mã là quá dàn trải — nên thu gọn về 1–2 mã mạnh nhất.`;
      rationale =
        "Trên sàn HOSE/HNX quy định lô tối thiểu 100 cổ phiếu cùng chi phí giao dịch/thuế khứ hồi ~0.35%–0.40%. Khi vốn dưới 50 triệu mà chia nhiều hơn 2 mã, mỗi vị thế chỉ còn vài triệu đến dưới 15 triệu: dễ kẹt lô lẻ với các mã thị giá cao và hiệu suất sinh lời bị pha loãng gần như bằng 0. Với quy mô vốn nhỏ, công cụ phòng thủ hiệu quả nhất là giữ đệm Tiền mặt, chứ không phải mua nhiều mã.";
      actionChecklist.push(
        `Xem xét cơ cấu gom các vị thế nhỏ (${smallestHoldings
          .slice(0, 2)
          .map(([s]) => s)
          .join(", ")}) để tập trung vào 1–2 cổ phiếu đầu ngành.`
      );
    } else if (currentCount === 2) {
      verdictBadge = "ƯU TIÊN TẬP TRUNG (ĐÃ ĐỦ SỐ MÃ)";
      headline = `Không cần mở thêm mã thứ 3 — hãy dồn vốn vào 2 vị thế hiện có (${sortedHoldings
        .map(([s]) => s)
        .join(", ")}).`;
      rationale =
        "Với vốn dưới 50 triệu, 2 mã là ngưỡng tối đa để vừa đảm bảo đủ lô tròn 100 CP, vừa tối ưu hóa biên lợi nhuận ròng sau phí. Thay vì mua thêm mã mới, hãy tăng tỷ trọng ở mã đang có Điểm PORI cao hơn khi thị trường thuận lợi.";
      actionChecklist.push(
        `Giữ tối đa 2 mã; giữ khoảng ${recommendedCashPct}% tiền mặt (~${((cleanCap * recommendedCashPct) / 100 / 1e6).toFixed(1)} triệu) làm bộ đệm quản trị rủi ro.`
      );
    } else {
      verdictBadge = currentCount === 0 ? "CHỌN 1–2 MÃ TRỌNG TÂM" : "GIỮ TẬP TRUNG 1–2 MÃ";
      headline =
        currentCount === 0
          ? `Với vốn ${(cleanCap / 1e6).toFixed(0)} triệu, chỉ nên giải ngân 1–2 cổ phiếu có Điểm PORI cao nhất.`
          : `Đang cầm ${sortedHoldings[0]?.[0]} — có thể chọn tối đa 1 mã bổ trợ khác ngành nếu muốn cân bằng.`;
      rationale =
        "Quy mô vốn dưới 50 triệu phù hợp với chiến lược tập trung có chọn lọc để tối đa hóa hiệu quả trên từng lô giao dịch 100 cổ phiếu, kết hợp giữ đệm tiền mặt khi thị trường biến động.";
      actionChecklist.push(
        `Mỗi mã nên phân bổ tối thiểu ~${(minPosSizeVnd / 1e6).toFixed(0)} triệu để tránh vướng lô lẻ với các mã thị giá lớn.`
      );
    }
  } else if (tier === "MEDIUM") {
    if (currentCount > maxIdealCount) {
      shouldDiversifyMore = false;
      verdictBadge = "KHÔNG MỞ THÊM MÃ MỚI";
      headline = `Đang giữ ${currentCount} mã với vốn ${(cleanCap / 1e6).toFixed(0)} triệu — đã vượt ngưỡng tối ưu (2–4 mã).`;
      rationale =
        "Danh mục đang có dấu hiệu loãng vốn (over-diversification). Giữ quá nhiều mã khiến bạn khó theo dõi sát diễn biến doanh nghiệp và biến động tổng danh mục tiệm cận chỉ số chung mà không tạo được lợi nhuận vượt trội.";
      actionChecklist.push(
        `Ngừng mua thêm mã mới; ưu tiên tỉa bớt các mã có tỷ trọng quá nhỏ (${smallestHoldings[0]?.[0]}) hoặc Điểm PORI thấp.`
      );
    } else if (topSectorEntry && topSectorEntry[1] > 0.48) {
      shouldDiversifyMore = true;
      verdictBadge = "NÊN ĐA DẠNG HÓA SANG NGÀNH KHÁC";
      headline = `Ngành ${topSectorEntry[0]} đang chiếm ${(topSectorEntry[1] * 100).toFixed(0)}% tỷ trọng — nên bổ sung 1 mã khác ngành có tương quan thấp.`;
      rationale =
        "Vốn 50–300 triệu cho phép xây dựng cấu trúc Lõi–Vệ tinh gồm 2–4 mã. Đa dạng hóa sang 1 ngành khác giúp giảm mạnh VaR danh mục khi ngành chính gặp nhịp điều chỉnh, mà mỗi vị thế vẫn đủ lớn để sinh lời rõ nét.";
      actionChecklist.push(
        `Tránh mua thêm cổ phiếu thuộc ngành ${topSectorEntry[0]}; ưu tiên mã dẫn đầu ở nhóm ngành ít tương quan (ρ < 0.55).`
      );
    } else {
      shouldDiversifyMore = currentCount < 3;
      verdictBadge = currentCount < 3 ? "CÓ THỂ MỞ RỘNG 2–4 MÃ" : "CƠ CẤU ĐANG HỢP LÝ";
      headline =
        currentCount < 3
          ? `Vốn ${(cleanCap / 1e6).toFixed(0)} triệu có thể phân bổ đều vào 2–4 mã thuộc 2–3 nhóm ngành khác nhau.`
          : `Số lượng ${currentCount} mã hiện tại rất phù hợp với quy mô vốn trung bình.`;
      rationale =
        "Mỗi vị thế nên chiếm từ 20%–35% phần vốn cổ phiếu (tối thiểu 25–30 triệu/mã) để vừa kiểm soát rủi ro đơn lẻ vừa không bị loãng hiệu suất.";
      actionChecklist.push(
        `Chia ngân sách giải ngân (~${(deployableBudget / 1e6).toFixed(0)} triệu) cho tối đa ${maxIdealCount} mã, giữ ${recommendedCashPct}% tiền mặt.`
      );
    }
  } else {
    // LARGE > 300M
    if (currentCount < minIdealCount || health.hhi_stock > 0.30) {
      shouldDiversifyMore = true;
      verdictBadge = "NÊN ĐA DẠNG HÓA & GIẢM TẬP TRUNG";
      headline = `Vốn lớn (${(cleanCap / 1e6).toFixed(0)} triệu) nhưng chỉ giữ ${currentCount} mã (HHI=${health.hhi_stock.toFixed(2)}) — rủi ro tập trung cao.`;
      rationale =
        "Ở quy mô vốn trên 300 triệu, dồn vào 1–2 mã khiến chỉ một phiên giảm sàn -7% gây thiệt hại tuyệt đối rất lớn và dễ gặp trượt giá khi thoát hàng. Cần phân bổ sang 4–7 mã đa ngành để đưa HHI < 0.25.";
      actionChecklist.push(
        "Mục tiêu: mỗi mã không quá 25%–30% NAV và mỗi ngành không vượt quá 35%–40% tỷ trọng cổ phiếu."
      );
    } else {
      shouldDiversifyMore = currentCount < maxIdealCount && (!topSectorEntry || topSectorEntry[1] > 0.38);
      verdictBadge = "ĐA DẠNG HÓA CHUẨN ĐỊNH LƯỢNG";
      headline = `Cấu trúc ${currentCount} mã phù hợp với vốn ${(cleanCap / 1e6).toFixed(0)} triệu; tập trung kiểm soát VaR 95% và độ sâu sổ lệnh.`;
      rationale =
        "Với quy mô vốn lớn, mọi quyết định mua thêm cần đối chiếu đồng thời 2 tiêu chí: giảm rủi ro biên (VaR) của danh mục và đủ thanh khoản 3 bước giá trên sổ lệnh để không bị trượt giá quá 0.15%.";
      actionChecklist.push(
        "Kiểm tra mục 04 (Thanh khoản & Khớp lệnh) trước khi đi lệnh trên 200 triệu/mã."
      );
    }
  }

  if (isRiskyMkt) {
    actionChecklist.push(
      `Thị trường đang ở trạng thái ${regime === "High Risk" ? "Rủi ro cao" : "Phòng thủ"}: Khuyến nghị giữ tối thiểu ${recommendedCashPct}% tiền mặt (~${((cleanCap * recommendedCashPct) / 100 / 1e6).toFixed(0)} triệu), chỉ giải ngân thăm dò từng phần.`
    );
  } else {
    actionChecklist.push(
      `Duy trì đệm tiền mặt khoảng ${recommendedCashPct}% (~${((cleanCap * recommendedCashPct) / 100 / 1e6).toFixed(0)} triệu) để linh hoạt tận dụng nhịp điều chỉnh.`
    );
  }

  // Pick top 3 suggested candidates that are NOT dominating the same over-weighted sector
  const heldSet = new Set(activeEntries.map(([s]) => s.toUpperCase()));
  const overWeightSector = topSectorEntry && topSectorEntry[1] > 0.42 ? topSectorEntry[0] : null;
  const targetSlots = Math.max(1, Math.min(maxIdealCount, currentCount === 0 ? Math.min(3, maxIdealCount) : 2));
  const perSlotBudget = Math.max(minPosSizeVnd, Math.round(deployableBudget / Math.max(2, maxIdealCount)));

  const scoredPool = discovery
    .filter((d) => (d.alpha_score ?? 0) > 0)
    .map((d) => {
      const fit = portfolioFitBySymbol[d.symbol];
      const secVn = vnSectorName(d.sector);
      const penalty = overWeightSector && secVn === overWeightSector ? -18 : 0;
      const alreadyBonus = !shouldDiversifyMore && heldSet.has(d.symbol) ? 20 : 0;
      const composite =
        (d.alpha_score ?? 50) * 0.5 + (fit?.portfolio_fit_score ?? 50) * 0.5 + penalty + alreadyBonus;
      return { d, fit, secVn, composite };
    })
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 3);

  const suggestedCandidates = scoredPool.map(({ d, fit, secVn }) => ({
    symbol: d.symbol,
    sector: secVn,
    poriScore: d.alpha_score ?? 0,
    fitScore: fit?.portfolio_fit_score ?? 50,
    avgCorr: fit?.avg_corr_with_portfolio ?? 0,
    suggestedAmountVnd: Math.min(deployableBudget, Math.max(minPosSizeVnd, Math.round(perSlotBudget / 1_000_000) * 1_000_000)),
    reason:
      heldSet.has(d.symbol) && !shouldDiversifyMore
        ? `Gia tăng vị thế đang có (${secVn}) thay vì mở mã mới để tránh loãng vốn.`
        : `Ngành ${secVn} • Tương quan danh mục ρ=${(fit?.avg_corr_with_portfolio ?? 0).toFixed(2)} • Phù hợp bổ sung (${targetSlots} vị thế).`,
  }));

  return {
    capitalVnd: cleanCap,
    tier,
    tierTitle,
    recommendedCountLabel,
    minPosSizeVnd,
    currentCount,
    recommendedCashPct,
    verdictBadge,
    shouldDiversifyMore,
    headline,
    rationale,
    suggestedCandidates,
    actionChecklist,
  };
}
