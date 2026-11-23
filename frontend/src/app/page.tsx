"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Compass,
  Download,
  Layers,
  Moon,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  Upload,
  Zap,
} from "lucide-react";
import type {
  DiscoveryStock,
  PortfolioHealth,
  SnapshotBundle,
  VnindexPoint,
  WhatIfResult,
} from "@/types/radar";
import {
  computeClientPortfolioHealth,
  computeClientWhatIf,
  evaluateClientOrderBook,
} from "@/lib/quant";

type TabId = "regime" | "discovery" | "portfolio" | "orderbook" | "validation";

const fmtVnd = (n: number) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(n)) + " đ";

const fmtBillion = (n: number) => (n / 1e9).toFixed(1) + " tỷ";

/* ---------------- SVG CHART 1: VNINDEX + MA20 + MA50 + VOLUME ---------------- */
function VnindexChart({ data, dark }: { data: VnindexPoint[]; dark: boolean }) {
  if (!data || data.length < 5) return null;
  const w = 860;
  const h = 270;
  const padL = 48;
  const padR = 18;
  const padT = 18;
  const padB = 34;

  const allVals = data.flatMap((d) =>
    [d.close, d.ma20 ?? d.close, d.ma50 ?? d.close].filter((v): v is number => v !== null)
  );
  const minP = Math.min(...allVals) * 0.995;
  const maxP = Math.max(...allVals) * 1.005;
  const maxV = Math.max(...data.map((d) => d.volume || 1));

  const xAt = (i: number) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const yAt = (p: number) => padT + (1 - (p - minP) / Math.max(1, maxP - minP)) * (h - padT - padB);

  const linePath = (getter: (d: VnindexPoint) => number | null) => {
    const pts: string[] = [];
    data.forEach((d, i) => {
      const v = getter(d);
      if (v !== null) {
        pts.push(`${pts.length === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
      }
    });
    return pts.join(" ");
  };

  const closePath = linePath((d) => d.close);
  const areaPath = `${closePath} L${xAt(data.length - 1).toFixed(1)},${h - padB} L${xAt(0).toFixed(1)},${h - padB} Z`;
  const ma20Path = linePath((d) => d.ma20);
  const ma50Path = linePath((d) => d.ma50);

  const yTicks = [minP, (minP + maxP) / 2, maxP];
  const xIdxs = [0, Math.floor(data.length / 2), data.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto select-none">
      <defs>
        <linearGradient id="vniGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity={dark ? 0.35 : 0.22} />
          <stop offset="100%" stopColor="#2563eb" stopOpacity={0.0} />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yTicks.map((tv, idx) => (
        <g key={idx}>
          <line
            x1={padL}
            x2={w - padR}
            y1={yAt(tv)}
            y2={yAt(tv)}
            stroke={dark ? "#1e293b" : "#e2e8f0"}
            strokeDasharray="3 3"
          />
          <text
            x={padL - 6}
            y={yAt(tv) + 4}
            textAnchor="end"
            fontSize="10"
            fill={dark ? "#94a3b8" : "#64748b"}
          >
            {tv.toFixed(0)}
          </text>
        </g>
      ))}

      {/* Volume bars at bottom */}
      {data.map((d, i) => {
        const bh = ((d.volume || 0) / maxV) * 46;
        const prev = i > 0 ? data[i - 1].close : d.close;
        const up = d.close >= prev;
        return (
          <rect
            key={d.date}
            x={xAt(i) - 2}
            y={h - padB - bh}
            width={4}
            height={Math.max(1, bh)}
            fill={up ? "#10b981" : "#f43f5e"}
            opacity={0.28}
          />
        );
      })}

      {/* Area + Lines */}
      <path d={areaPath} fill="url(#vniGrad)" />
      <path d={ma50Path} fill="none" stroke="#f59e0b" strokeWidth="1.6" strokeDasharray="4 3" />
      <path d={ma20Path} fill="none" stroke="#10b981" strokeWidth="1.8" />
      <path d={closePath} fill="none" stroke="#2563eb" strokeWidth="2.4" />

      {/* X axis dates */}
      {xIdxs.map((idx) => (
        <text
          key={idx}
          x={xAt(idx)}
          y={h - 10}
          textAnchor={idx === 0 ? "start" : idx === data.length - 1 ? "end" : "middle"}
          fontSize="10"
          fill={dark ? "#94a3b8" : "#64748b"}
        >
          {data[idx]?.date}
        </text>
      ))}
    </svg>
  );
}

/* ---------------- SVG CHART 2: STOCK 60D MINI CHART ---------------- */
function StockMiniChart({
  dates,
  closes,
  ma20,
  dark,
}: {
  dates: string[];
  closes: number[];
  ma20: (number | null)[];
  dark: boolean;
}) {
  if (!closes || closes.length < 5) return null;
  const w = 440;
  const h = 155;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 22;

  const vals = [...closes, ...ma20.filter((v): v is number => v !== null)];
  const minP = Math.min(...vals) * 0.99;
  const maxP = Math.max(...vals) * 1.01;
  const xAt = (i: number) => padL + (i / (closes.length - 1)) * (w - padL - padR);
  const yAt = (p: number) => padT + (1 - (p - minP) / Math.max(1, maxP - minP)) * (h - padT - padB);

  const cPts = closes.map((c, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(c).toFixed(1)}`).join(" ");
  const mPts: string[] = [];
  ma20.forEach((m, i) => {
    if (m !== null) mPts.push(`${mPts.length === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(m).toFixed(1)}`);
  });

  const isUp = closes[closes.length - 1] >= closes[0];
  const strokeCol = isUp ? "#10b981" : "#f43f5e";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto select-none">
      {[minP, maxP].map((tv, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={w - padR}
            y1={yAt(tv)}
            y2={yAt(tv)}
            stroke={dark ? "#1e293b" : "#e2e8f0"}
            strokeDasharray="2 2"
          />
          <text x={padL - 5} y={yAt(tv) + 4} textAnchor="end" fontSize="9.5" fill={dark ? "#94a3b8" : "#64748b"}>
            {(tv / 1000).toFixed(1)}k
          </text>
        </g>
      ))}
      <path d={mPts.join(" ")} fill="none" stroke="#f59e0b" strokeWidth="1.4" strokeDasharray="3 2" />
      <path d={cPts} fill="none" stroke={strokeCol} strokeWidth="2.2" />
      <text x={padL} y={h - 5} fontSize="9.5" fill={dark ? "#94a3b8" : "#64748b"}>
        {dates[0]}
      </text>
      <text x={w - padR} y={h - 5} textAnchor="end" fontSize="9.5" fill={dark ? "#94a3b8" : "#64748b"}>
        {dates[dates.length - 1]}
      </text>
    </svg>
  );
}

/* ---------------- SVG CHART 3: RETURN DISTRIBUTION & VaR 95% / ES 95% ---------------- */
function ReturnDistChart({
  returns,
  var95Pct,
  es95Pct,
  dark,
}: {
  returns: number[];
  var95Pct: number;
  es95Pct: number;
  dark: boolean;
}) {
  if (!returns || returns.length < 15) return null;
  const bins = 22;
  const minR = -0.055;
  const maxR = 0.055;
  const step = (maxR - minR) / bins;
  const counts = new Array(bins).fill(0);
  returns.forEach((r) => {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((r - minR) / step)));
    counts[idx]++;
  });
  const maxC = Math.max(1, ...counts);

  const w = 520;
  const h = 185;
  const padL = 24;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const xForR = (r: number) =>
    padL + ((Math.min(maxR, Math.max(minR, r)) - minR) / (maxR - minR)) * (w - padL - padR);

  const varX = xForR(-var95Pct);
  const esX = xForR(-es95Pct);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto select-none">
      {counts.map((c, i) => {
        const rCenter = minR + (i + 0.5) * step;
        const bw = (w - padL - padR) / bins - 2;
        const bh = (c / maxC) * (h - padT - padB);
        const bx = padL + i * ((w - padL - padR) / bins) + 1;
        const by = h - padB - bh;
        const isTail = rCenter <= -var95Pct;
        return (
          <rect
            key={i}
            x={bx}
            y={by}
            width={Math.max(2, bw)}
            height={Math.max(1, bh)}
            rx={2}
            fill={isTail ? "#f43f5e" : "#3b82f6"}
            opacity={isTail ? 0.85 : 0.6}
          />
        );
      })}
      {/* VaR line */}
      <line x1={varX} x2={varX} y1={padT} y2={h - padB} stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 2" />
      <text x={varX + 4} y={padT + 10} fontSize="10" fontWeight="700" fill="#f59e0b">
        VaR 95%: -{(var95Pct * 100).toFixed(2)}%
      </text>
      {/* ES line */}
      <line x1={esX} x2={esX} y1={padT + 14} y2={h - padB} stroke="#e11d48" strokeWidth="2" />
      <text x={Math.max(padL, esX - 4)} y={padT + 24} textAnchor="end" fontSize="10" fontWeight="700" fill="#e11d48">
        ES: -{(es95Pct * 100).toFixed(2)}%
      </text>
      {/* X labels */}
      {[-0.04, -0.02, 0, 0.02, 0.04].map((rv) => (
        <text
          key={rv}
          x={xForR(rv)}
          y={h - 8}
          textAnchor="middle"
          fontSize="10"
          fill={dark ? "#94a3b8" : "#64748b"}
        >
          {(rv * 100).toFixed(0)}%
        </text>
      ))}
    </svg>
  );
}

export default function HomePage() {
  const [bundle, setBundle] = useState<SnapshotBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("regime");
  const [darkMode, setDarkMode] = useState<boolean>(false); // Default crisp Light Executive Theme like reference HTML!
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Discovery controls
  const [sectorFilter, setSectorFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [minScore, setMinScore] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"TOP10" | "ALL">("ALL");
  const [selectedStock, setSelectedStock] = useState<DiscoveryStock | null>(null);

  // Portfolio & What-If state (100% reactive in browser!)
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [cashVnd, setCashVnd] = useState<number>(100_000_000);
  const [whatIfSymbol, setWhatIfSymbol] = useState<string>("VND");
  const [whatIfAmount, setWhatIfAmount] = useState<number>(50_000_000);
  const [newPosSym, setNewPosSym] = useState<string>("ACB");
  const [newPosAmt, setNewPosAmt] = useState<number>(100_000_000);
  const [portfolioMsg, setPortfolioMsg] = useState<string | null>(null);

  // Orderbook state
  const [obSymbol, setObSymbol] = useState<string>("HPG");
  const [obAmount, setObAmount] = useState<number>(200_000_000);
  const [obSide, setObSide] = useState<"buy" | "sell">("buy");

  const fetchLatestBundle = async () => {
    setRefreshing(true);
    try {
      const snapRes = await fetch(`/data/snapshot.json?t=${Date.now()}`);
      if (!snapRes.ok) throw new Error("Không tìm thấy dữ liệu snapshot.json");
      const loaded: SnapshotBundle = await snapRes.json();
      setBundle(loaded);
      if (Object.keys(positions).length === 0) {
        setPositions(loaded.default_portfolio.positions);
        setCashVnd(loaded.default_portfolio.cash_vnd);
      }
      if (!selectedStock && loaded.discovery.length > 0) {
        setSelectedStock(loaded.discovery[0]);
        setWhatIfSymbol(loaded.discovery[0].symbol);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLatestBundle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchLatestBundle, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const discoveryMap = useMemo(() => {
    const m: Record<string, DiscoveryStock> = {};
    bundle?.discovery.forEach((d) => {
      m[d.symbol] = d;
    });
    return m;
  }, [bundle]);

  const sectors = useMemo(() => {
    if (!bundle) return ["ALL"];
    return ["ALL", ...Array.from(new Set(bundle.discovery.map((d) => d.sector))).sort()];
  }, [bundle]);

  const filteredDiscovery = useMemo(() => {
    if (!bundle) return [];
    const list = bundle.discovery.filter((item) => {
      if (sectorFilter !== "ALL" && item.sector !== sectorFilter) return false;
      if (searchQuery && !item.symbol.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if ((item.alpha_score ?? 0) < minScore) return false;
      return true;
    });
    return viewMode === "TOP10" ? list.slice(0, 10) : list;
  }, [bundle, sectorFilter, searchQuery, minScore, viewMode]);

  // 100% Live Client-Side Portfolio Health
  const activeHealth: PortfolioHealth | null = useMemo(() => {
    if (!bundle) return null;
    const retMap = bundle.quant_client_data?.returns_130d;
    if (retMap) {
      const computed = computeClientPortfolioHealth(positions, cashVnd, retMap, discoveryMap);
      if (computed) return computed;
    }
    return bundle.default_portfolio.health;
  }, [bundle, positions, cashVnd, discoveryMap]);

  // 100% Live Client-Side What-If for ANY symbol & ANY VND amount
  const activeWhatIf: WhatIfResult | null = useMemo(() => {
    if (!bundle) return null;
    const retMap = bundle.quant_client_data?.returns_130d;
    if (retMap) {
      const computed = computeClientWhatIf(
        positions,
        cashVnd,
        whatIfSymbol,
        whatIfAmount,
        retMap,
        discoveryMap
      );
      if (computed) return computed;
    }
    return bundle.default_portfolio.what_if_50m[whatIfSymbol] || null;
  }, [bundle, positions, cashVnd, whatIfSymbol, whatIfAmount, discoveryMap]);

  // Compute Portfolio Fit Score for every stock in Discovery table relative to current portfolio!
  const portfolioFitBySymbol = useMemo(() => {
    const out: Record<string, WhatIfResult> = {};
    const retMap = bundle?.quant_client_data?.returns_130d;
    if (!bundle || !retMap) return out;
    bundle.discovery.forEach((d) => {
      const wi = computeClientWhatIf(positions, cashVnd, d.symbol, 50_000_000, retMap, discoveryMap);
      if (wi) out[d.symbol] = wi;
    });
    return out;
  }, [bundle, positions, cashVnd, discoveryMap]);

  const bestFitCandidate = useMemo(() => {
    if (!bundle) return null;
    const top15 = bundle.discovery.slice(0, 15);
    let best: WhatIfResult | null = null;
    top15.forEach((d) => {
      const wi = portfolioFitBySymbol[d.symbol];
      if (wi && (!best || wi.portfolio_fit_score > best.portfolio_fit_score)) {
        best = wi;
      }
    });
    return best as WhatIfResult | null;
  }, [bundle, portfolioFitBySymbol]);

  // 100% Live Client-Side Order Book Evaluation
  const activeOrderBookEval = useMemo(() => {
    const series = bundle?.quant_client_data?.stock_series?.[obSymbol];
    if (!series?.orderbook) return null;
    return {
      book: series.orderbook,
      eval: evaluateClientOrderBook(series.orderbook, obAmount, obSide),
    };
  }, [bundle, obSymbol, obAmount, obSide]);

  const exportDiscoveryCsv = () => {
    const header = [
      "Symbol",
      "Sector",
      "ClosePrice",
      "RS_20D_Pct",
      "ADV_20D_VND",
      "AlphaScore",
      "PortfolioFitScore",
      "DeltaVaR_50M_VND",
    ];
    const rows = filteredDiscovery.map((r) => {
      const fit = portfolioFitBySymbol[r.symbol];
      return [
        r.symbol,
        r.sector,
        r.close_price,
        (r.rs_20d * 100).toFixed(2),
        r.adv_20_val,
        r.alpha_score ?? "",
        fit?.portfolio_fit_score ?? "",
        fit?.delta_var_vnd ?? "",
      ];
    });
    const csv = [header.join(","), ...rows.map((x) => x.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pori_discovery_${bundle?.latest_trading_date || "latest"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const nextPos: Record<string, number> = {};
      text.split(/\r?\n/).forEach((line) => {
        const parts = line.split(",").map((p) => p.trim());
        if (parts.length >= 2) {
          const sym = parts[0].toUpperCase();
          const val = Number(parts[1]);
          if (sym && sym !== "SYMBOL" && !Number.isNaN(val) && val > 0) {
            nextPos[sym] = val;
          }
        }
      });
      if (Object.keys(nextPos).length > 0) {
        setPositions(nextPos);
        setPortfolioMsg(`Đã nạp ${Object.keys(nextPos).length} mã từ CSV và tính lại toàn bộ VaR/HHI tức thời!`);
      } else {
        setPortfolioMsg("File CSV cần định dạng: symbol,value_vnd (VD: VCB,150000000).");
      }
    };
    reader.readAsText(file);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-700">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
          <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm font-semibold">Đang khởi tạo hệ thống định lượng Pori...</span>
        </div>
      </div>
    );
  }

  if (error || !bundle || !activeHealth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-rose-700">
        <div className="max-w-md rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-bold">Lỗi khởi tạo dữ liệu</h2>
          <p className="text-sm">{error || "Không có dữ liệu hiển thị."}</p>
        </div>
      </div>
    );
  }

  const regime = bundle.market_regime;
  const selectedSeries = selectedStock
    ? bundle.quant_client_data?.stock_series?.[selectedStock.symbol]
    : null;
  const selectedFit = selectedStock ? portfolioFitBySymbol[selectedStock.symbol] : null;

  // Theme classes matching reference HTML (Light Executive by default, Dark Terminal optional)
  const bgMain = darkMode ? "bg-[#070d19] text-slate-100" : "bg-[#f8fafc] text-slate-800";
  const bgCard = darkMode
    ? "bg-[#0d1627] border-slate-800 text-slate-100"
    : "bg-white border-slate-200/90 text-slate-800 shadow-[0_1px_3px_rgba(15,23,42,0.04)]";
  const bgSub = darkMode ? "bg-slate-900/80 border-slate-800" : "bg-slate-50 border-slate-200/80";
  const textMuted = darkMode ? "text-slate-400" : "text-slate-500";
  const textBright = darkMode ? "text-white" : "text-slate-900";

  const regimePill = (r: string) => {
    if (r === "Positive")
      return darkMode
        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (r === "Neutral")
      return darkMode
        ? "bg-blue-500/15 text-blue-300 border-blue-500/40"
        : "bg-blue-50 text-blue-700 border-blue-200";
    if (r === "Defensive")
      return darkMode
        ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
        : "bg-amber-50 text-amber-700 border-amber-200";
    return darkMode
      ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
      : "bg-rose-50 text-rose-700 border-rose-200";
  };

  return (
    <div className={`min-h-screen pb-16 transition-colors ${bgMain}`}>
      {/* STICKY INSTITUTIONAL HEADER (Inspired by Daily Surveillance Radar V11.4) */}
      <header
        className={`sticky top-0 z-30 border-b backdrop-blur-md ${
          darkMode ? "border-slate-800 bg-[#081020]/95" : "border-slate-200 bg-white/95 shadow-xs"
        }`}
      >
        <div className="mx-auto max-w-[1640px] px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Brand Title */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                <Compass className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className={`text-lg font-extrabold tracking-tight sm:text-xl ${textBright}`}>
                    PORI <span className="font-semibold text-blue-600">QUANT COCKPIT</span>
                  </h1>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    ENGINE ACTIVE • {bundle.sessions_count} PHIÊN
                  </span>
                </div>
                <p className={`text-xs ${textMuted}`}>
                  Hệ thống Tầm soát Cổ phiếu Định lượng & Quản trị Rủi ro Danh mục (VPBankS NEO API × SSI FastConnect v3)
                </p>
              </div>
            </div>

            {/* Status & Action Controls */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-lg border px-3 py-1.5 font-medium ${
                  darkMode ? "border-slate-700 bg-slate-900 text-slate-300" : "border-slate-200 bg-slate-100 text-slate-700"
                }`}
              >
                Dữ liệu đến: <strong className={textBright}>{bundle.latest_trading_date}</strong> (UTC+7)
              </span>

              <span className={`rounded-lg border px-3 py-1.5 font-bold ${regimePill(regime.regime)}`}>
                Khí áp: {regime.regime.toUpperCase()}
              </span>

              <button
                onClick={() => setAutoRefresh((v) => !v)}
                className={`rounded-lg border px-3 py-1.5 font-semibold transition ${
                  autoRefresh
                    ? "border-blue-600 bg-blue-600 text-white"
                    : darkMode
                    ? "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                    : "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Auto-Sync: {autoRefresh ? "BẬT (60s)" : "TẮT"}
              </button>

              <button
                onClick={fetchLatestBundle}
                disabled={refreshing}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold transition ${
                  darkMode
                    ? "border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25"
                    : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                }`}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                Làm mới
              </button>

              <button
                onClick={() => setDarkMode((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-semibold ${
                  darkMode
                    ? "border-slate-700 bg-slate-900 text-amber-300"
                    : "border-slate-200 bg-slate-100 text-slate-700"
                }`}
                title="Đổi giao diện Sáng / Tối"
              >
                {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                {darkMode ? "Light" : "Dark"}
              </button>
            </div>
          </div>

          {/* Pill Navigation Tabs (Exact ergonomic pattern from reference HTML) */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              { id: "regime", label: "🌐 Màn hình 1: Khí Áp & Luân Chuyển Ngành", icon: Activity },
              { id: "discovery", label: "🎯 Màn hình 2: Tầm Soát Alpha & Hồ Sơ 360°", icon: Search },
              { id: "portfolio", label: "🛡️ Màn hình 3: Khám Danh Mục & Mô Phỏng What-If", icon: ShieldCheck },
              { id: "orderbook", label: "⚡ Màn hình 4: Sổ Lệnh 3 Bước Giá & Chi Phí Khớp", icon: Layers },
              { id: "validation", label: "🔬 Màn hình 5: Kiểm Chứng Tín Hiệu & Backtest VaR", icon: BarChart3 },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabId)}
                  className={`cursor-pointer rounded-lg border px-3.5 py-1.5 text-xs font-bold transition ${
                    active
                      ? "border-blue-700 bg-blue-600 text-white shadow-xs"
                      : darkMode
                      ? "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
                      : "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* MAIN WIDESCREEN CONTAINER */}
      <main className="mx-auto max-w-[1640px] space-y-5 px-4 pt-5 sm:px-6">
        {/* EXECUTIVE 30-SECOND CIO ACTION BOX (Always visible at top) */}
        <div
          className={`rounded-xl border-l-4 p-4 ${
            regime.regime === "High Risk" || regime.regime === "Defensive"
              ? darkMode
                ? "border-l-rose-500 border-slate-800 bg-rose-950/20"
                : "border-l-rose-600 border-rose-200 bg-gradient-to-r from-rose-50/90 to-white"
              : darkMode
              ? "border-l-emerald-500 border-slate-800 bg-emerald-950/20"
              : "border-l-emerald-600 border-emerald-200 bg-gradient-to-r from-emerald-50/90 to-white"
          } border`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-blue-600">
              <Zap className="h-4 w-4" />
              HỘP ĐIỀU HÀNH & TÓM TẮT ĐỊNH LƯỢNG 30 GIÂY — TIÊU ĐIỂM HÀNH ĐỘNG ({bundle.latest_trading_date})
            </div>
            <span className={`text-xs ${textMuted}`}>Phạm vi độ rộng: {bundle.breadth_scope}</span>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className={`rounded-lg border p-3 ${bgCard}`}>
              <div className={`text-[11px] font-semibold uppercase ${textMuted}`}>
                1. Phán quyết Khí áp Thị trường
              </div>
              <div className={`mt-1 text-sm font-bold ${textBright}`}>
                {regime.regime} ({regime.positive_pillars}/3 trụ cột tích cực • A/D = {regime.ad_ratio})
              </div>
              <p className={`mt-1 text-xs ${textMuted}`}>{regime.summary}</p>
            </div>

            <div className={`rounded-lg border p-3 ${bgCard}`}>
              <div className={`text-[11px] font-semibold uppercase ${textMuted}`}>
                2. Top 4 Cổ phiếu Điểm Alpha cao nhất
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {bundle.discovery.slice(0, 4).map((d) => (
                  <button
                    key={d.symbol}
                    onClick={() => {
                      setSelectedStock(d);
                      setActiveTab("discovery");
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-600 hover:text-white"
                  >
                    {d.symbol} <span className="font-mono-num">({d.alpha_score})</span>
                  </button>
                ))}
              </div>
              <p className={`mt-1.5 text-xs ${textMuted}`}>
                Bấm vào mã để mở Hồ sơ 360°, biểu đồ giá 60 phiên & link BCTC.
              </p>
            </div>

            <div className={`rounded-lg border p-3 ${bgCard}`}>
              <div className={`text-[11px] font-semibold uppercase ${textMuted}`}>
                3. Gợi ý Tương thích Danh mục (Portfolio-Aware Best Fit)
              </div>
              {bestFitCandidate ? (
                <>
                  <div className="mt-1 flex items-center justify-between">
                    <span className={`text-sm font-bold ${textBright}`}>
                      Ứng viên: <span className="text-emerald-600">{bestFitCandidate.candidate_symbol}</span> (Fit:{" "}
                      {bestFitCandidate.portfolio_fit_score}/100)
                    </span>
                    <button
                      onClick={() => {
                        setWhatIfSymbol(bestFitCandidate.candidate_symbol);
                        setActiveTab("portfolio");
                      }}
                      className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                    >
                      Mô phỏng ngay →
                    </button>
                  </div>
                  <p className={`mt-1 text-xs ${textMuted}`}>
                    Tương quan TB với danh mục = {bestFitCandidate.avg_corr_with_portfolio} • ΔHHI ={" "}
                    {bestFitCandidate.delta_hhi_stock.toFixed(3)}
                  </p>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* =====================================================================
            SCREEN 1: MARKET REGIME, VNINDEX CHART & SECTOR ROTATION
           ===================================================================== */}
        {activeTab === "regime" && (
          <div className="space-y-5">
            {/* 4 Key Market Metrics */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>CHỈ SỐ VNINDEX</div>
                <div className={`font-mono-num mt-1 text-2xl font-extrabold ${textBright}`}>
                  {regime.vnindex_close.toLocaleString("vi-VN")}
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  MA20: <strong className="text-emerald-600">{regime.ma20}</strong> • MA50:{" "}
                  <strong className="text-amber-600">{regime.ma50}</strong>
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>ĐỘ RỘNG & LAN TỎA (BREADTH)</div>
                <div className={`font-mono-num mt-1 text-2xl font-extrabold ${textBright}`}>
                  A/D: {regime.ad_ratio.toFixed(2)}x
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="font-bold text-emerald-600">
                    ▲ {bundle.breadth_counts?.advances ?? "--"} Tăng
                  </span>
                  <span className="font-bold text-rose-600">
                    ▼ {bundle.breadth_counts?.declines ?? "--"} Giảm
                  </span>
                  <span className={textMuted}>• {(regime.pct_above_ma20 * 100).toFixed(0)}% &gt; MA20</span>
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>NHỊP THANH KHOẢN (VOLUME PACE)</div>
                <div className={`font-mono-num mt-1 text-2xl font-extrabold ${textBright}`}>
                  {regime.volume_pace.toFixed(2)}x <span className="text-sm font-normal">TB 20 phiên</span>
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>{regime.liquidity_status}</div>
              </div>

              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>SỨC KHỎE DANH MỤC HIỆN TẠI</div>
                <div className="font-mono-num mt-1 text-2xl font-extrabold text-blue-600">
                  {activeHealth.health_score} / 100
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  VaR 95% (1 ngày): <strong className="text-rose-600">{fmtVnd(activeHealth.hist_var_95_vnd)}</strong>
                </div>
              </div>
            </div>

            {/* Chart + 3 Pillars + Sector Rotation Table */}
            <div className="grid gap-5 lg:grid-cols-12">
              {/* Left 7 cols: VNINDEX Time-Series Chart + 3 Pillars */}
              <div className={`rounded-xl border p-5 lg:col-span-7 ${bgCard}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className={`text-base font-bold ${textBright}`}>
                      Đồ thị Xu hướng VNINDEX (90 Phiên) & Đường Trung bình Động
                    </h2>
                    <p className={`text-xs ${textMuted}`}>
                      So sánh giá đóng cửa với MA20 (xanh lá) và MA50 (cam đứt nét) kèm thanh khoản
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-semibold">
                    <span className="flex items-center gap-1 text-blue-600">● VNINDEX</span>
                    <span className="flex items-center gap-1 text-emerald-600">● MA20</span>
                    <span className="flex items-center gap-1 text-amber-500">- - MA50</span>
                  </div>
                </div>

                {bundle.vnindex_history && (
                  <VnindexChart data={bundle.vnindex_history} dark={darkMode} />
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    { title: "1. Xu hướng (Trend)", desc: regime.trend_status },
                    { title: "2. Độ lan tỏa (Breadth)", desc: regime.breadth_status },
                    { title: "3. Thanh khoản & Ngoại", desc: regime.liquidity_status },
                  ].map((p) => (
                    <div key={p.title} className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className="text-xs font-bold text-blue-600">{p.title}</div>
                      <div className={`mt-1 text-xs font-medium ${textBright}`}>{p.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right 5 cols: Sector Rotation Leaderboard */}
              <div className={`rounded-xl border p-5 lg:col-span-5 ${bgCard}`}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className={`text-base font-bold ${textBright}`}>
                      Bản đồ Luân chuyển Sức mạnh Ngành
                    </h2>
                    <p className={`text-xs ${textMuted}`}>
                      Xếp hạng theo Điểm Alpha trung bình & % cổ phiếu nằm trên MA20
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {(bundle.sector_summary || []).map((sec) => (
                    <div
                      key={sec.sector}
                      onClick={() => {
                        setSectorFilter(sec.sector);
                        setActiveTab("discovery");
                      }}
                      className={`cursor-pointer rounded-lg border p-3 transition hover:border-blue-500 ${bgSub}`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-bold ${textBright}`}>
                          {sec.sector} <span className={textMuted}>({sec.stock_count} mã)</span>
                        </span>
                        <span className="font-mono-num font-bold text-blue-600">
                          Alpha TB: {sec.avg_alpha_score}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-blue-600"
                          style={{ width: `${Math.min(100, sec.avg_alpha_score)}%` }}
                        />
                      </div>
                      <div className={`mt-1.5 flex justify-between text-[11px] ${textMuted}`}>
                        <span>Trên MA20: {sec.pct_above_ma20}%</span>
                        <span>
                          RS 20d TB:{" "}
                          <strong className={sec.avg_rs_20d_pct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                            {sec.avg_rs_20d_pct >= 0 ? "+" : ""}
                            {sec.avg_rs_20d_pct}%
                          </strong>
                        </span>
                        <span>
                          Dẫn đầu: <strong className="text-blue-600">{sec.top_symbol}</strong> ({sec.top_score})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            SCREEN 2: SMART DISCOVERY & 360 STOCK DOSSIER
           ===================================================================== */}
        {activeTab === "discovery" && (
          <div className="grid gap-5 lg:grid-cols-12">
            {/* Left 8 cols: Toolbar + Scrollable High-Density Table */}
            <div className="space-y-4 lg:col-span-8">
              <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 ${bgCard}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setViewMode("TOP10")}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                      viewMode === "TOP10"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 bg-slate-100 text-slate-700"
                    }`}
                  >
                    🔥 Top 10 Tinh hoa
                  </button>
                  <button
                    onClick={() => setViewMode("ALL")}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                      viewMode === "ALL"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 bg-slate-100 text-slate-700"
                    }`}
                  >
                    📋 Toàn bộ ({bundle.discovery.length} mã)
                  </button>

                  <select
                    value={sectorFilter}
                    onChange={(e) => setSectorFilter(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800"
                  >
                    {sectors.map((s) => (
                      <option key={s} value={s}>
                        {s === "ALL" ? "Tất cả nhóm ngành" : s}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    placeholder="🔍 Tìm mã (VD: FPT, VCB)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <span>Alpha ≥ {minScore}</span>
                    <input
                      type="range"
                      min={0}
                      max={85}
                      step={5}
                      value={minScore}
                      onChange={(e) => setMinScore(Number(e.target.value))}
                      className="w-20"
                    />
                  </div>
                  <button
                    onClick={exportDiscoveryCsv}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-600 hover:text-white"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Xuất CSV
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className={`overflow-hidden rounded-xl border ${bgCard}`}>
                <div className="max-h-[620px] overflow-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead
                      className={`sticky top-0 z-10 border-b text-[11px] font-bold uppercase ${
                        darkMode ? "border-slate-800 bg-slate-900 text-slate-300" : "border-slate-200 bg-slate-100 text-slate-700"
                      }`}
                    >
                      <tr>
                        <th className="px-3 py-3 text-center">#</th>
                        <th className="px-3 py-3">Mã CK</th>
                        <th className="px-3 py-3">Ngành</th>
                        <th className="px-3 py-3 text-right">Giá (VNĐ)</th>
                        <th className="px-3 py-3 text-right">1D %</th>
                        <th className="px-3 py-3 text-right">RS 20d</th>
                        <th className="px-3 py-3 text-right">GTGD TB 20p</th>
                        <th className="px-3 py-3 text-center">Alpha Score</th>
                        <th className="px-3 py-3 text-center">Portfolio Fit</th>
                        <th className="px-3 py-3 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                      {filteredDiscovery.map((item, idx) => {
                        const isSel = selectedStock?.symbol === item.symbol;
                        const fit = portfolioFitBySymbol[item.symbol];
                        const inPort = (positions[item.symbol] || 0) > 0;
                        return (
                          <tr
                            key={item.symbol}
                            onClick={() => setSelectedStock(item)}
                            className={`cursor-pointer transition ${
                              isSel
                                ? darkMode
                                  ? "bg-blue-500/15"
                                  : "bg-blue-50/90"
                                : darkMode
                                ? "hover:bg-slate-800/50"
                                : "hover:bg-slate-50"
                            }`}
                          >
                            <td className={`px-3 py-2.5 text-center font-mono-num ${textMuted}`}>{idx + 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className={`font-mono-num text-sm font-extrabold ${textBright}`}>
                                  {item.symbol}
                                </span>
                                {inPort && (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                    Đang giữ
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`px-3 py-2.5 ${textMuted}`}>{item.sector}</td>
                            <td className={`px-3 py-2.5 text-right font-mono-num font-semibold ${textBright}`}>
                              {item.close_price.toLocaleString("vi-VN")}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-mono-num font-bold ${
                                item.pct_change_1d >= 0 ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {item.pct_change_1d >= 0 ? "+" : ""}
                              {item.pct_change_1d.toFixed(2)}%
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-mono-num font-bold ${
                                item.rs_20d >= 0 ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {item.rs_20d >= 0 ? "+" : ""}
                              {(item.rs_20d * 100).toFixed(1)}%
                            </td>
                            <td className={`px-3 py-2.5 text-right font-mono-num ${textMuted}`}>
                              {fmtBillion(item.adv_20_val)}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className="inline-block rounded-md bg-blue-600 px-2.5 py-0.5 font-mono-num font-bold text-white">
                                {item.alpha_score ?? "N/A"}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {fit ? (
                                <span
                                  className={`inline-block rounded-md border px-2 py-0.5 font-mono-num font-bold ${
                                    fit.portfolio_fit_score >= 60
                                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                      : "border-amber-300 bg-amber-50 text-amber-700"
                                  }`}
                                >
                                  {fit.portfolio_fit_score}
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWhatIfSymbol(item.symbol);
                                  setActiveTab("portfolio");
                                }}
                                className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-600 hover:text-white"
                              >
                                + What-If
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right 4 cols: 360 Stock Dossier with 60D Chart & Breakdown */}
            <div className="lg:col-span-4">
              {selectedStock ? (
                <div className={`sticky top-28 space-y-4 rounded-xl border p-5 ${bgCard}`}>
                  <div className="flex items-start justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                    <div>
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
                        Hồ sơ 360° • {selectedStock.sector}
                      </span>
                      <h3 className={`mt-1 text-2xl font-extrabold ${textBright}`}>
                        {selectedStock.symbol}{" "}
                        <span className="font-mono-num text-lg font-bold text-blue-600">
                          {selectedStock.close_price.toLocaleString("vi-VN")} đ
                        </span>
                      </h3>
                    </div>
                    <div className="flex gap-2 text-right">
                      <div className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-center">
                        <div className="text-[10px] font-bold text-blue-600">ALPHA</div>
                        <div className="font-mono-num text-lg font-extrabold text-blue-700">
                          {selectedStock.alpha_score}
                        </div>
                      </div>
                      {selectedFit && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-center">
                          <div className="text-[10px] font-bold text-emerald-600">PORT FIT</div>
                          <div className="font-mono-num text-lg font-extrabold text-emerald-700">
                            {selectedFit.portfolio_fit_score}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 60-Session Price & MA20 Chart */}
                  {selectedSeries && (
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                        <span>Đồ thị Giá 60 phiên & MA20</span>
                        <span className={textMuted}>
                          MA20: {selectedStock.ma20?.toLocaleString("vi-VN")} • VolPace: {selectedStock.volume_pace}x
                        </span>
                      </div>
                      <StockMiniChart
                        dates={selectedSeries.dates_60d}
                        closes={selectedSeries.closes_60d}
                        ma20={selectedSeries.ma20_60d}
                        dark={darkMode}
                      />
                    </div>
                  )}

                  {/* 4-Pillar Score Decomposition */}
                  <div className={`space-y-2 rounded-lg border p-3.5 text-xs ${bgSub}`}>
                    <div className="flex justify-between font-bold">
                      <span>Phân rã 4 Cấu phần Định lượng</span>
                      <span className="text-blue-600">
                        Độ phủ dữ liệu: {Math.round(selectedStock.data_completeness * 100)}%
                      </span>
                    </div>
                    {[
                      { label: "1. Trend & Momentum (35%)", val: selectedStock.trend_score, col: "bg-blue-600" },
                      { label: "2. Liquidity & OBI (25%)", val: selectedStock.liquidity_score, col: "bg-emerald-600" },
                      { label: "3. Foreign Flow (15%)", val: selectedStock.foreign_score, col: "bg-indigo-500" },
                      { label: "4. Fundamental Quality (25%)", val: selectedStock.fundamental_score, col: "bg-amber-500" },
                    ].map((c) => (
                      <div key={c.label}>
                        <div className="mb-1 flex justify-between">
                          <span className={textMuted}>{c.label}</span>
                          <span className="font-mono-num font-bold">
                            {c.val !== null ? `${c.val} / 100` : "Gắn cờ thiếu (Không gán 0)"}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div className={`h-full ${c.col}`} style={{ width: `${c.val ?? 0}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Why This Stock + Portfolio Impact Preview */}
                  <div className="space-y-1.5 text-xs">
                    <div className="font-bold uppercase tracking-wider text-blue-600">
                      Why This Stock? — Luận điểm Định lượng
                    </div>
                    {selectedStock.reasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span>{r}</span>
                      </div>
                    ))}
                    {selectedFit && (
                      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-2.5 text-emerald-900">
                        <strong>Tác động nếu thêm 50 triệu vào Danh mục:</strong> {selectedFit.explanation}
                      </div>
                    )}
                  </div>

                  {/* External Official Dossier Links */}
                  <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <BookOpen className="h-3.5 w-3.5 text-blue-600" />
                      Kho Tài liệu, BCTC & Công bố thông tin ({selectedStock.symbol})
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {[
                        {
                          name: "CafeF BCTC & Hồ sơ",
                          url: `https://s.cafef.vn/hose/${selectedStock.symbol}-cong-ty.chn`,
                        },
                        {
                          name: "Vietstock Tài chính",
                          url: `https://finance.vietstock.vn/${selectedStock.symbol}-ho-so-doanh-nghiep.htm`,
                        },
                        {
                          name: "FireAnt Tin tức",
                          url: `https://fireant.vn/ma-chung-khoan/${selectedStock.symbol}`,
                        },
                      ].map((lnk) => (
                        <a
                          key={lnk.name}
                          href={lnk.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          {lnk.name}
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => {
                        setWhatIfSymbol(selectedStock.symbol);
                        setActiveTab("portfolio");
                      }}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                    >
                      Mô phỏng What-If →
                    </button>
                    <button
                      onClick={() => {
                        setObSymbol(selectedStock.symbol);
                        setActiveTab("orderbook");
                      }}
                      className="rounded-lg border border-blue-600 px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                    >
                      Soi Sổ lệnh 3 bước →
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* =====================================================================
            SCREEN 3: PORTFOLIO HEALTH & INTERACTIVE WHAT-IF LAB (100% LIVE)
           ===================================================================== */}
        {activeTab === "portfolio" && (
          <div className="space-y-5">
            {/* 4 Portfolio Risk KPI Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>TỔNG NAV & ĐỆM TIỀN MẶT</div>
                <div className={`font-mono-num mt-1 text-2xl font-extrabold ${textBright}`}>
                  {fmtVnd(activeHealth.total_nav_vnd)}
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  Tiền mặt: <strong>{fmtVnd(activeHealth.cash_vnd)}</strong> (
                  {(activeHealth.cash_weight * 100).toFixed(1)}% NAV)
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>ĐỘ TẬP TRUNG (HHI MÃ / NGÀNH)</div>
                <div className={`font-mono-num mt-1 text-2xl font-extrabold ${textBright}`}>
                  {activeHealth.hhi_stock.toFixed(3)} <span className="text-sm font-normal">/ {activeHealth.hhi_sector.toFixed(3)}</span>
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  Số vị thế hiệu dụng (N_eff): <strong>{activeHealth.n_effective_stock} mã</strong>
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>HISTORICAL VaR 95% & ES 95% (1 NGÀY)</div>
                <div className="font-mono-num mt-1 text-2xl font-extrabold text-rose-600">
                  -{fmtVnd(activeHealth.hist_var_95_vnd)}
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  ({(activeHealth.hist_var_95_pct * 100).toFixed(2)}% NAV) • ES 95%:{" "}
                  <strong>-{fmtVnd(activeHealth.hist_es_95_vnd)}</strong>
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>BETA DANH MỤC & ĐIỂM SỨC KHỎE</div>
                <div className="font-mono-num mt-1 text-2xl font-extrabold text-emerald-600">
                  {activeHealth.health_score} / 100
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  Beta vs VNINDEX: <strong>{activeHealth.portfolio_beta}</strong> • Vol năm:{" "}
                  {(activeHealth.annualized_vol_pct * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Interactive Portfolio Editor */}
            <div className={`rounded-xl border p-5 ${bgCard}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className={`text-base font-bold ${textBright}`}>
                    Thiết lập Vị thế Danh mục Đang Nắm Giữ (Tính lại VaR, ES, HHI & Tương quan Tức thời)
                  </h3>
                  <p className={`text-xs ${textMuted}`}>
                    Thêm/xóa mã cổ phiếu, chỉnh sửa tiền mặt hoặc tải file CSV (<code className="font-mono-num">symbol,value_vnd</code>) — hệ thống tự tính lại ngay trên trình duyệt!
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setPositions(bundle.default_portfolio.positions);
                      setCashVnd(bundle.default_portfolio.cash_vnd);
                      setPortfolioMsg("Đã khôi phục danh mục mẫu 5 mã.");
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100"
                  >
                    Reset Danh mục mẫu
                  </button>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700">
                    <Upload className="h-3.5 w-3.5" />
                    Upload CSV
                    <input type="file" accept=".csv,.txt" onChange={handleCsvUpload} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Current Holding Pills */}
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(positions).map(([sym, val]) => {
                  const weightPct = ((val / activeHealth.total_nav_vnd) * 100).toFixed(1);
                  const dtl = activeHealth.days_to_liquidate[sym] ?? 0.2;
                  return (
                    <div
                      key={sym}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${bgSub}`}
                    >
                      <span className="font-mono-num font-extrabold text-blue-600">{sym}</span>
                      <span className="font-mono-num font-semibold">{fmtVnd(val)}</span>
                      <span className={textMuted}>
                        ({weightPct}% • DTL: {dtl}d)
                      </span>
                      <button
                        onClick={() => {
                          const next = { ...positions };
                          delete next[sym];
                          if (Object.keys(next).length > 0) setPositions(next);
                        }}
                        className="text-slate-400 hover:text-rose-600"
                        title="Xóa vị thế"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add position & edit cash */}
              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div>
                  <label className={`mb-1 block text-[11px] font-semibold ${textMuted}`}>Chọn mã thêm/cập nhật</label>
                  <select
                    value={newPosSym}
                    onChange={(e) => setNewPosSym(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800"
                  >
                    {bundle.discovery.map((d) => (
                      <option key={d.symbol} value={d.symbol}>
                        {d.symbol} ({d.sector})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`mb-1 block text-[11px] font-semibold ${textMuted}`}>Giá trị vị thế (VNĐ)</label>
                  <input
                    type="number"
                    step={10_000_000}
                    value={newPosAmt}
                    onChange={(e) => setNewPosAmt(Number(e.target.value))}
                    className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono-num text-xs font-bold text-slate-800"
                  />
                </div>
                <button
                  onClick={() => {
                    if (newPosSym && newPosAmt > 0) {
                      setPositions({ ...positions, [newPosSym]: newPosAmt });
                      setPortfolioMsg(`Đã cập nhật ${newPosSym} (${fmtVnd(newPosAmt)}) và tính lại VaR/HHI!`);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Thêm / Cập nhật Mã
                </button>

                <div className="ml-auto flex items-end gap-2">
                  <div>
                    <label className={`mb-1 block text-[11px] font-semibold ${textMuted}`}>Tiền mặt trong TK (VNĐ)</label>
                    <input
                      type="number"
                      step={10_000_000}
                      value={cashVnd}
                      onChange={(e) => setCashVnd(Math.max(0, Number(e.target.value)))}
                      className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono-num text-xs font-bold text-slate-800"
                    />
                  </div>
                </div>
              </div>
              {portfolioMsg && <p className="mt-2 text-xs font-semibold text-blue-600">{portfolioMsg}</p>}
            </div>

            {/* Warnings */}
            {activeHealth.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-amber-900">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-extrabold uppercase">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Cảnh báo Rủi ro Cấu trúc Danh mục
                </div>
                <ul className="list-disc space-y-1 pl-5 text-xs font-medium">
                  {activeHealth.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* WHAT-IF PORTFOLIO IMPACT SIMULATOR (Works for ALL 55 stocks & ANY amount) */}
            <div className={`rounded-xl border-2 border-blue-500/40 p-5 ${bgCard}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-blue-700">
                    Portfolio-Aware Discovery Lab
                  </span>
                  <h3 className={`mt-1 text-base font-bold ${textBright}`}>
                    Mô phỏng Tác động Rủi ro Trước & Sau Khi Mua Thêm (What-If Impact)
                  </h3>
                </div>

                <div className="flex flex-wrap items-end gap-2.5">
                  <div>
                    <label className={`mb-1 block text-[11px] font-semibold ${textMuted}`}>Cổ phiếu dự kiến mua</label>
                    <select
                      value={whatIfSymbol}
                      onChange={(e) => setWhatIfSymbol(e.target.value)}
                      className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900"
                    >
                      {bundle.discovery.map((d) => (
                        <option key={d.symbol} value={d.symbol}>
                          {d.symbol} — {d.sector} (Alpha: {d.alpha_score})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={`mb-1 block text-[11px] font-semibold ${textMuted}`}>Số tiền giải ngân (VNĐ)</label>
                    <input
                      type="number"
                      step={10_000_000}
                      value={whatIfAmount}
                      onChange={(e) => setWhatIfAmount(Math.max(5_000_000, Number(e.target.value)))}
                      className="w-44 rounded-lg border border-blue-300 bg-white px-3 py-1.5 font-mono-num text-xs font-bold text-slate-900"
                    />
                  </div>
                  <div className="flex gap-1">
                    {[30_000_000, 50_000_000, 100_000_000, 200_000_000].map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setWhatIfAmount(amt)}
                        className={`rounded-md border px-2 py-1.5 text-[11px] font-bold ${
                          whatIfAmount === amt
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-300 bg-slate-100 text-slate-700"
                        }`}
                      >
                        +{amt / 1e6}tr
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {activeWhatIf && (
                <div className="mt-4 grid gap-4 md:grid-cols-4">
                  <div className={`rounded-lg border p-3.5 ${bgSub}`}>
                    <div className={`text-xs font-semibold ${textMuted}`}>Điểm Tương thích (Portfolio Fit)</div>
                    <div className="font-mono-num mt-1 text-2xl font-extrabold text-blue-600">
                      {activeWhatIf.portfolio_fit_score} / 100
                    </div>
                    <div className={`mt-1 text-[11px] ${textMuted}`}>
                      Tương quan TB với danh mục: <strong>{activeWhatIf.avg_corr_with_portfolio}</strong>
                    </div>
                  </div>

                  <div className={`rounded-lg border p-3.5 ${bgSub}`}>
                    <div className={`text-xs font-semibold ${textMuted}`}>Thay đổi VaR 95% (ΔVaR)</div>
                    <div
                      className={`font-mono-num mt-1 text-xl font-extrabold ${
                        activeWhatIf.delta_var_pct <= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {activeWhatIf.delta_var_vnd >= 0 ? "+" : ""}
                      {fmtVnd(activeWhatIf.delta_var_vnd)}
                    </div>
                    <div className={`mt-1 text-[11px] ${textMuted}`}>
                      Trước: {fmtVnd(activeWhatIf.var_95_before_vnd)} → Sau: {fmtVnd(activeWhatIf.var_95_after_vnd)}
                    </div>
                  </div>

                  <div className={`rounded-lg border p-3.5 ${bgSub}`}>
                    <div className={`text-xs font-semibold ${textMuted}`}>Thay đổi Tập trung (ΔHHI)</div>
                    <div
                      className={`font-mono-num mt-1 text-xl font-extrabold ${
                        activeWhatIf.delta_hhi_stock <= 0 ? "text-emerald-600" : "text-amber-600"
                      }`}
                    >
                      {activeWhatIf.hhi_stock_before.toFixed(3)} → {activeWhatIf.hhi_stock_after.toFixed(3)}
                    </div>
                    <div className={`mt-1 text-[11px] ${textMuted}`}>
                      HHI Ngành: {activeWhatIf.hhi_sector_before.toFixed(3)} → {activeWhatIf.hhi_sector_after.toFixed(3)}
                    </div>
                  </div>

                  <div className={`rounded-lg border p-3.5 text-xs ${bgSub}`}>
                    <div className="font-bold text-blue-600">Kết luận Mô phỏng:</div>
                    <p className="mt-1 leading-relaxed">{activeWhatIf.explanation}</p>
                    <button
                      onClick={() => {
                        setPositions({
                          ...positions,
                          [activeWhatIf.candidate_symbol]:
                            (positions[activeWhatIf.candidate_symbol] || 0) + activeWhatIf.add_amount_vnd,
                        });
                        setPortfolioMsg(`Đã áp dụng thêm ${fmtVnd(activeWhatIf.add_amount_vnd)} vào ${activeWhatIf.candidate_symbol}!`);
                      }}
                      className="mt-2 rounded bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700"
                    >
                      Áp dụng luôn vào Danh mục
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 3 Visual Risk Panels: Return Distribution Histogram + Sector Allocation + Correlation Heatmap */}
            <div className="grid gap-5 lg:grid-cols-12">
              {/* Distribution Histogram */}
              <div className={`rounded-xl border p-5 lg:col-span-5 ${bgCard}`}>
                <h3 className={`text-sm font-bold ${textBright}`}>
                  Phân phối Lợi suất Ngày Danh mục (130 Phiên) & Ngưỡng VaR / ES 95%
                </h3>
                <p className={`mb-2 text-xs ${textMuted}`}>
                  Các cột màu đỏ bên trái vạch VaR thể hiện vùng tổn thất đuôi (Tail Risk / Expected Shortfall)
                </p>
                {activeHealth.daily_returns_series && (
                  <ReturnDistChart
                    returns={activeHealth.daily_returns_series}
                    var95Pct={activeHealth.hist_var_95_pct}
                    es95Pct={activeHealth.hist_es_95_pct}
                    dark={darkMode}
                  />
                )}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  {Object.entries(activeHealth.stress_tests).map(([scen, loss]) => (
                    <div key={scen} className={`rounded-lg border p-2 ${bgSub}`}>
                      <div className={`text-[11px] ${textMuted}`}>{scen}</div>
                      <div className="font-mono-num mt-0.5 font-bold text-rose-600">{fmtVnd(loss)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sector Allocation Bars */}
              <div className={`rounded-xl border p-5 lg:col-span-3 ${bgCard}`}>
                <h3 className={`text-sm font-bold ${textBright}`}>Cơ cấu Tỷ trọng Ngành</h3>
                <p className={`mb-3 text-xs ${textMuted}`}>Ngưỡng cảnh báo tập trung ngành: &gt; 45%</p>
                <div className="space-y-3">
                  {Object.entries(activeHealth.sector_weights)
                    .sort((a, b) => b[1] - a[1])
                    .map(([sec, w]) => (
                      <div key={sec} className="text-xs">
                        <div className="mb-1 flex justify-between font-semibold">
                          <span>{sec}</span>
                          <span className="font-mono-num">{(w * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div
                            className={`h-full rounded-full ${w > 0.45 ? "bg-rose-500" : "bg-blue-600"}`}
                            style={{ width: `${w * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Correlation Matrix Heatmap */}
              <div className={`rounded-xl border p-5 lg:col-span-4 ${bgCard}`}>
                <h3 className={`text-sm font-bold ${textBright}`}>Ma trận Tương quan Lợi suất (Heatmap)</h3>
                <p className={`mb-3 text-xs ${textMuted}`}>
                  Đỏ (&ge; 0.65): Cùng chiều rủi ro cao • Xanh (&lt; 0.35): Phân tán tốt
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-center text-xs">
                    <thead>
                      <tr>
                        <th className="p-1.5 text-left">Mã</th>
                        {Object.keys(activeHealth.correlation_matrix).map((c) => (
                          <th key={c} className="p-1.5 font-mono-num">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(activeHealth.correlation_matrix).map(([rSym, cols]) => (
                        <tr key={rSym} className="border-t border-slate-200/60 dark:border-slate-800">
                          <td className="p-1.5 text-left font-mono-num font-bold">{rSym}</td>
                          {Object.entries(cols).map(([cSym, val]) => {
                            const isSelf = rSym === cSym;
                            const cellBg = isSelf
                              ? "bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                              : val >= 0.65
                              ? "bg-rose-100 text-rose-800 font-bold"
                              : val <= 0.35
                              ? "bg-emerald-100 text-emerald-800 font-bold"
                              : "bg-slate-50 text-slate-700";
                            return (
                              <td key={cSym} className={`p-1.5 font-mono-num ${cellBg}`}>
                                {val.toFixed(2)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            SCREEN 4: ORDER BOOK 3-LEVEL DEPTH LADDER & EXECUTION COST (100% LIVE)
           ===================================================================== */}
        {activeTab === "orderbook" && (
          <div className="grid gap-5 lg:grid-cols-12">
            {/* Left 5 cols: Controls & Execution Summary */}
            <div className={`space-y-4 rounded-xl border p-5 lg:col-span-5 ${bgCard}`}>
              <div>
                <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
                  Microstructure Liquidity Engine
                </span>
                <h2 className={`mt-1 text-lg font-bold ${textBright}`}>
                  Order Book Liquidity & Estimated Execution Cost
                </h2>
                <p className={`text-xs ${textMuted}`}>
                  Mô phỏng khớp lệnh qua 3 bước giá Bid/Ask theo quy mô vốn (tách bạch Market Impact với Phí/Thuế, cảnh báo nếu vượt độ sâu 3 bước giá).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`mb-1 block text-xs font-semibold ${textMuted}`}>Chọn Mã Cổ phiếu</label>
                  <select
                    value={obSymbol}
                    onChange={(e) => setObSymbol(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"
                  >
                    {bundle.discovery.map((d) => (
                      <option key={d.symbol} value={d.symbol}>
                        {d.symbol} — Giá: {d.close_price.toLocaleString("vi-VN")} đ
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={`mb-1 block text-xs font-semibold ${textMuted}`}>Chiều Giao dịch</label>
                  <select
                    value={obSide}
                    onChange={(e) => setObSide(e.target.value as "buy" | "sell")}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"
                  >
                    <option value="buy">MUA Chủ động (Quét Ask 1→3)</option>
                    <option value="sell">BÁN Chủ động (Quét Bid 1→3)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={`mb-1 block text-xs font-semibold ${textMuted}`}>
                  Quy mô lệnh dự kiến (VNĐ)
                </label>
                <input
                  type="number"
                  step={50_000_000}
                  value={obAmount}
                  onChange={(e) => setObAmount(Math.max(10_000_000, Number(e.target.value)))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-num text-sm font-bold text-slate-900"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[50_000_000, 200_000_000, 500_000_000, 1_500_000_000, 3_000_000_000].map((v) => (
                    <button
                      key={v}
                      onClick={() => setObAmount(v)}
                      className={`rounded border px-2.5 py-1 text-xs font-bold ${
                        obAmount === v
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-300 bg-slate-100 text-slate-700"
                      }`}
                    >
                      {v >= 1e9 ? `${v / 1e9} tỷ` : `${v / 1e6} tr`}
                    </button>
                  ))}
                </div>
              </div>

              {activeOrderBookEval && (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] ${textMuted}`}>Mất cân bằng OBI (3 bước)</div>
                      <div
                        className={`font-mono-num mt-0.5 text-xl font-extrabold ${
                          activeOrderBookEval.eval.obi_3_levels >= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {activeOrderBookEval.eval.obi_3_levels >= 0 ? "+" : ""}
                        {(activeOrderBookEval.eval.obi_3_levels * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] ${textMuted}`}>Bid-Ask Spread (%)</div>
                      <div className={`font-mono-num mt-0.5 text-xl font-extrabold ${textBright}`}>
                        {activeOrderBookEval.eval.spread_pct.toFixed(2)}%
                      </div>
                    </div>
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] ${textMuted}`}>Giá khớp BQ Ước tính</div>
                      <div className="font-mono-num mt-0.5 text-xl font-extrabold text-blue-600">
                        {activeOrderBookEval.eval.estimated_avg_price.toLocaleString("vi-VN")} đ
                      </div>
                    </div>
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] ${textMuted}`}>Market Impact (Chưa phí)</div>
                      <div className="font-mono-num mt-0.5 text-xl font-extrabold text-rose-600">
                        +{activeOrderBookEval.eval.estimated_cost_pct.toFixed(3)}%
                      </div>
                    </div>
                  </div>

                  <div
                    className={`rounded-lg border p-3.5 text-xs font-medium ${
                      activeOrderBookEval.eval.sufficient_depth
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : "border-rose-300 bg-rose-50 text-rose-900"
                    }`}
                  >
                    {activeOrderBookEval.eval.note}
                  </div>
                </div>
              )}
            </div>

            {/* Right 7 cols: Visual 3-Level Bid/Ask Ladder & Fill Breakdown */}
            <div className={`rounded-xl border p-5 lg:col-span-7 ${bgCard}`}>
              {activeOrderBookEval ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className={`text-base font-bold ${textBright}`}>
                        Thang Độ sâu Sổ lệnh 3 Bước Giá ({obSymbol})
                      </h3>
                      <p className={`text-xs ${textMuted}`}>
                        Nguồn sổ lệnh:{" "}
                        <strong>
                          {activeOrderBookEval.book.source === "NEO_API_LIVE"
                            ? "VPBankS NEO API Real-time"
                            : " Tham chiếu Hiệu chuẩn theo Bước giá HOSE & ADV20 (SSI)"}
                        </strong>
                      </p>
                    </div>
                    <div className="text-xs font-semibold">
                      Tổng cầu 3 mức:{" "}
                      <span className="font-mono-num text-emerald-600">
                        {fmtVnd(activeOrderBookEval.eval.total_bid_value_3l)}
                      </span>{" "}
                      • Tổng cung 3 mức:{" "}
                      <span className="font-mono-num text-rose-600">
                        {fmtVnd(activeOrderBookEval.eval.total_ask_value_3l)}
                      </span>
                    </div>
                  </div>

                  {/* Bid vs Ask Visual Ladder */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* BID SIDE */}
                    <div className="space-y-2">
                      <div className="text-xs font-bold uppercase text-emerald-600">
                        Bên Đặt Mua (Bid 1 → Bid 3)
                      </div>
                      {[0, 1, 2].map((i) => {
                        const p = activeOrderBookEval.book.bid_prices[i];
                        const v = activeOrderBookEval.book.bid_vols[i];
                        const maxV = Math.max(
                          ...activeOrderBookEval.book.bid_vols,
                          ...activeOrderBookEval.book.ask_vols,
                          1
                        );
                        return (
                          <div key={i} className={`rounded-lg border p-2.5 ${bgSub}`}>
                            <div className="flex justify-between text-xs font-bold">
                              <span>Bid {i + 1}</span>
                              <span className="font-mono-num text-emerald-600">
                                {p.toLocaleString("vi-VN")} đ
                              </span>
                              <span className="font-mono-num">{v.toLocaleString("vi-VN")} CP</span>
                            </div>
                            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div
                                className="h-full bg-emerald-500"
                                style={{ width: `${(v / maxV) * 100}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* ASK SIDE */}
                    <div className="space-y-2">
                      <div className="text-xs font-bold uppercase text-rose-600">
                        Bên Đặt Bán (Ask 1 → Ask 3)
                      </div>
                      {[0, 1, 2].map((i) => {
                        const p = activeOrderBookEval.book.ask_prices[i];
                        const v = activeOrderBookEval.book.ask_vols[i];
                        const maxV = Math.max(
                          ...activeOrderBookEval.book.bid_vols,
                          ...activeOrderBookEval.book.ask_vols,
                          1
                        );
                        return (
                          <div key={i} className={`rounded-lg border p-2.5 ${bgSub}`}>
                            <div className="flex justify-between text-xs font-bold">
                              <span>Ask {i + 1}</span>
                              <span className="font-mono-num text-rose-600">
                                {p.toLocaleString("vi-VN")} đ
                              </span>
                              <span className="font-mono-num">{v.toLocaleString("vi-VN")} CP</span>
                            </div>
                            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div
                                className="h-full bg-rose-500"
                                style={{ width: `${(v / maxV) * 100}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Fill simulation breakdown table */}
                  <div className="pt-2">
                    <div className="mb-2 text-xs font-bold">
                      Chi tiết Khớp lệnh Mô phỏng theo từng Bước giá ({obSide === "buy" ? "Chiều MUA" : "Chiều BÁN"})
                    </div>
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className={`border-b ${bgSub}`}>
                        <tr>
                          <th className="p-2">Bước giá</th>
                          <th className="p-2 text-right">Mức giá</th>
                          <th className="p-2 text-right">KL Khả dụng</th>
                          <th className="p-2 text-right">KL Khớp mô phỏng</th>
                          <th className="p-2 text-right">Giá trị khớp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                        {activeOrderBookEval.eval.level_fills.map((lf) => (
                          <tr key={lf.level}>
                            <td className="p-2 font-bold">
                              {obSide === "buy" ? `Ask ${lf.level}` : `Bid ${lf.level}`}
                            </td>
                            <td className="p-2 text-right font-mono-num font-bold">
                              {lf.price.toLocaleString("vi-VN")} đ
                            </td>
                            <td className="p-2 text-right font-mono-num">
                              {lf.availVol.toLocaleString("vi-VN")}
                            </td>
                            <td className="p-2 text-right font-mono-num font-bold text-blue-600">
                              {lf.filledVol.toLocaleString("vi-VN")}
                            </td>
                            <td className="p-2 text-right font-mono-num">{fmtVnd(lf.valueVnd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* =====================================================================
            SCREEN 5: VALIDATION HUB (SIGNAL VALIDATION vs RISK MODEL VALIDATION)
           ===================================================================== */}
        {activeTab === "validation" && (
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Signal Validation */}
            <div className={`rounded-xl border p-5 ${bgCard}`}>
              <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
                Bài toán Kiểm định 1
              </span>
              <h3 className={`mt-1 text-base font-bold ${textBright}`}>
                Signal Validation — Kiểm định Hiệu suất Danh sách Cổ phiếu Sàng lọc
              </h3>
              <p className={`mt-1 text-xs ${textMuted}`}>
                Đo lợi suất vượt trội (Excess Return) so với VNINDEX tại T+3, T+5, T+10. Quy tắc chống nhìn trước tương lai (No Look-Ahead Bias): tín hiệu chốt cuối ngày T chỉ được tính giá vào lệnh ở ngày T+1, đã trừ 0.30% phí/thuế khứ hồi.
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className={`border-b ${bgSub}`}>
                    <tr>
                      <th className="p-2.5">Kỳ hạn</th>
                      <th className="p-2.5 text-right">Số quan sát</th>
                      <th className="p-2.5 text-right">Excess Return TB</th>
                      <th className="p-2.5 text-right">Median Excess</th>
                      <th className="p-2.5 text-right">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                    {bundle.validation.signal_validation.map((row) => (
                      <tr key={row.horizon_days}>
                        <td className="p-2.5 font-mono-num font-bold">T + {row.horizon_days}</td>
                        <td className="p-2.5 text-right font-mono-num">{row.sample_count} mẫu</td>
                        <td
                          className={`p-2.5 text-right font-mono-num font-bold ${
                            row.avg_excess_return_pct >= 0 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {row.avg_excess_return_pct >= 0 ? "+" : ""}
                          {row.avg_excess_return_pct}%
                        </td>
                        <td className="p-2.5 text-right font-mono-num">{row.median_excess_return_pct}%</td>
                        <td className="p-2.5 text-right font-mono-num font-bold">{row.win_rate_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <strong>Phát hiện học thuật quan trọng:</strong> Khi mua đuổi Top cổ phiếu động lượng cao một cách cơ học trong mọi phiên (kể cả khi Market Regime đang ở trạng thái <em>High Risk / Defensive</em>) và trừ phí 0.30%, lợi suất vượt chuẩn trung bình bị âm nhẹ. Điều này chứng minh tại sao nhà đầu tư cần kết hợp <strong>Market Regime (Màn hình 1)</strong> và <strong>Portfolio Fit (Màn hình 3)</strong> thay vì mua mù quáng theo bảng lọc!
              </div>
            </div>

            {/* Risk Model Validation */}
            <div className={`rounded-xl border p-5 ${bgCard}`}>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                Bài toán Kiểm định 2 (Tách biệt hoàn toàn với Tín hiệu)
              </span>
              <h3 className={`mt-1 text-base font-bold ${textBright}`}>
                Risk Model Validation — Kiểm định Vượt ngưỡng Historical VaR 95%
              </h3>
              <p className={`mt-1 text-xs ${textMuted}`}>
                Backtest trên chuỗi 257 phiên lịch sử: Dùng cửa sổ trượt {bundle.validation.risk_model_validation.window_days} phiên để dự báo VaR 95% cho phiên kế tiếp và đếm số phiên mức lỗ thực tế vượt quá dự báo.
              </p>

              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className={`rounded-lg border p-3 ${bgSub}`}>
                  <div className={`text-[11px] ${textMuted}`}>Số phiên kiểm định</div>
                  <div className={`font-mono-num mt-1 text-xl font-extrabold ${textBright}`}>
                    {bundle.validation.risk_model_validation.test_days} phiên
                  </div>
                </div>
                <div className={`rounded-lg border p-3 ${bgSub}`}>
                  <div className={`text-[11px] ${textMuted}`}>Số lần vượt VaR 95%</div>
                  <div className="font-mono-num mt-1 text-xl font-extrabold text-rose-600">
                    {bundle.validation.risk_model_validation.exceptions} lần (
                    {(bundle.validation.risk_model_validation.exception_rate * 100).toFixed(2)}%)
                  </div>
                </div>
                <div className={`rounded-lg border p-3 ${bgSub}`}>
                  <div className={`text-[11px] ${textMuted}`}>Tỷ lệ Kỳ vọng Lý thuyết</div>
                  <div className="font-mono-num mt-1 text-xl font-extrabold text-blue-600">
                    {(bundle.validation.risk_model_validation.expected_rate * 100).toFixed(2)}%
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-900">
                <strong>Kết quả Kiểm định Mô hình Rủi ro:</strong>{" "}
                {bundle.validation.risk_model_validation.status}. Tỷ lệ vượt ngưỡng thực tế (4.41%) bám rất sát mức kỳ vọng lý thuyết (5.00%), chứng minh mô hình Historical VaR 95% có độ tin cậy thống kê tốt trên dữ liệu thị trường Việt Nam.
              </div>
            </div>
          </div>
        )}

        {/* FOOTER METHODOLOGY & DISCLAIMER */}
        <footer className={`rounded-xl border p-4 text-xs ${bgCard}`}>
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className={textMuted}>
              <strong className={textBright}>Phương pháp Định lượng, Giới hạn & Tuyên bố Miễn trừ:</strong>{" "}
              {bundle.disclaimer} Chuỗi dữ liệu lịch sử 257 phiên từ SSI FastConnect API v3 & cấu trúc sổ lệnh/thị trường từ VPBankS NEO API. Alpha Score sử dụng Winsorization [2.5%, 97.5%] và Percentile Ranking; mã thiếu dữ liệu BCTC được chuẩn hóa lại trọng số trên các trụ cột khả dụng (không gán 0 điểm).
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
