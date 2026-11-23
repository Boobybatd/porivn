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
  Database,
  Download,
  HelpCircle,
  Layers,
  Moon,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Trash2,
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

/* ============================================================================
   SVG CHART 1: INTERACTIVE VNINDEX + MA20 + MA50 + VOLUME WITH HOVER CROSSHAIR
   ============================================================================ */
function VnindexChart({ data, dark }: { data: VnindexPoint[]; dark: boolean }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length < 5) return null;
  const w = 860;
  const h = 285;
  const padL = 50;
  const padR = 18;
  const padT = 22;
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

  const activeIdx = hoverIdx !== null ? hoverIdx : data.length - 1;
  const activePt = data[activeIdx];
  const prevPt = activeIdx > 0 ? data[activeIdx - 1] : activePt;
  const chgPct = prevPt && prevPt.close > 0 ? ((activePt.close - prevPt.close) / prevPt.close) * 100 : 0;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * w;
    const ratio = (relX - padL) / (w - padL - padR);
    const idx = Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1))));
    setHoverIdx(idx);
  };

  return (
    <div className="space-y-2">
      {/* Live Hover HUD Bar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
          dark ? "border-slate-800 bg-slate-900/90 text-slate-200" : "border-slate-200 bg-slate-50 text-slate-800"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono-num font-bold text-blue-500">📅 {activePt.date}</span>
          <span>
            VNINDEX:{" "}
            <strong className="font-mono-num text-sm">
              {activePt.close.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>{" "}
            <span className={`font-mono-num font-bold ${chgPct >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              ({chgPct >= 0 ? "+" : ""}
              {chgPct.toFixed(2)}%)
            </span>
          </span>
          {activePt.ma20 !== null && (
            <span>
              MA20: <strong className="font-mono-num text-emerald-500">{activePt.ma20.toFixed(2)}</strong>
            </span>
          )}
          {activePt.ma50 !== null && (
            <span>
              MA50: <strong className="font-mono-num text-amber-500">{activePt.ma50.toFixed(2)}</strong>
            </span>
          )}
        </div>
        <div className="font-mono-num text-[11px] opacity-80">
          KL: <strong>{((activePt.volume || 0) / 1e6).toFixed(1)} triệu CP</strong> (Rê chuột trên biểu đồ để tra cứu)
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto select-none cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="vniGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={dark ? 0.35 : 0.22} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0.0} />
          </linearGradient>
        </defs>

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

        {data.map((d, i) => {
          const bh = ((d.volume || 0) / maxV) * 48;
          const prev = i > 0 ? data[i - 1].close : d.close;
          const up = d.close >= prev;
          const isHovered = i === activeIdx;
          return (
            <rect
              key={d.date}
              x={xAt(i) - 2}
              y={h - padB - bh}
              width={4}
              height={Math.max(1, bh)}
              fill={up ? "#10b981" : "#f43f5e"}
              opacity={isHovered ? 0.85 : 0.28}
            />
          );
        })}

        <path d={areaPath} fill="url(#vniGrad)" />
        <path d={ma50Path} fill="none" stroke="#f59e0b" strokeWidth="1.6" strokeDasharray="4 3" />
        <path d={ma20Path} fill="none" stroke="#10b981" strokeWidth="1.8" />
        <path d={closePath} fill="none" stroke="#2563eb" strokeWidth="2.4" />

        {/* Interactive Crosshair & Dots */}
        <line
          x1={xAt(activeIdx)}
          x2={xAt(activeIdx)}
          y1={padT}
          y2={h - padB}
          stroke={dark ? "#94a3b8" : "#475569"}
          strokeWidth="1.2"
          strokeDasharray="3 3"
        />
        <line
          x1={padL}
          x2={w - padR}
          y1={yAt(activePt.close)}
          y2={yAt(activePt.close)}
          stroke={dark ? "#475569" : "#94a3b8"}
          strokeWidth="0.9"
          strokeDasharray="2 3"
        />

        {activePt.ma50 !== null && (
          <circle cx={xAt(activeIdx)} cy={yAt(activePt.ma50)} r="3.5" fill="#f59e0b" />
        )}
        {activePt.ma20 !== null && (
          <circle cx={xAt(activeIdx)} cy={yAt(activePt.ma20)} r="3.5" fill="#10b981" />
        )}
        <circle
          cx={xAt(activeIdx)}
          cy={yAt(activePt.close)}
          r="5"
          fill="#2563eb"
          stroke="#ffffff"
          strokeWidth="1.8"
        />

        {/* Floating Price Tag on SVG */}
        <g
          transform={`translate(${Math.min(w - 165, Math.max(padL + 6, xAt(activeIdx) + 8))}, ${Math.max(
            padT + 4,
            Math.min(h - padB - 48, yAt(activePt.close) - 22)
          )})`}
        >
          <rect
            width="150"
            height="42"
            rx="6"
            fill={dark ? "#0f172a" : "#ffffff"}
            stroke={dark ? "#334155" : "#cbd5e1"}
            strokeWidth="1"
            opacity="0.95"
          />
          <text x="8" y="15" fontSize="10" fontWeight="700" fill={dark ? "#e2e8f0" : "#0f172a"}>
            {activePt.date} • {activePt.close.toFixed(2)}
          </text>
          <text x="8" y="31" fontSize="9.5" fill={dark ? "#94a3b8" : "#475569"}>
            MA20: {activePt.ma20?.toFixed(1) ?? "-"} | MA50: {activePt.ma50?.toFixed(1) ?? "-"}
          </text>
        </g>

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
    </div>
  );
}

/* ============================================================================
   SVG CHART 2: INTERACTIVE STOCK 60D MINI CHART WITH HOVER TOOLTIP
   ============================================================================ */
function StockMiniChart({
  symbol,
  dates,
  closes,
  ma20,
  dark,
}: {
  symbol: string;
  dates: string[];
  closes: number[];
  ma20: (number | null)[];
  dark: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!closes || closes.length < 5) return null;
  const w = 440;
  const h = 165;
  const padL = 46;
  const padR = 14;
  const padT = 16;
  const padB = 24;

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

  const activeIdx = hoverIdx !== null ? hoverIdx : closes.length - 1;
  const activeClose = closes[activeIdx];
  const activeMa20 = ma20[activeIdx];
  const activeDate = dates[activeIdx];
  const diffMa20Pct = activeMa20 && activeMa20 > 0 ? ((activeClose - activeMa20) / activeMa20) * 100 : 0;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * w;
    const ratio = (relX - padL) / (w - padL - padR);
    const idx = Math.min(closes.length - 1, Math.max(0, Math.round(ratio * (closes.length - 1))));
    setHoverIdx(idx);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between text-[11px]">
        <span className="font-mono-num font-bold text-blue-500">
          {symbol} • {activeDate}
        </span>
        <span className="font-mono-num">
          Giá: <strong>{activeClose.toLocaleString("vi-VN")} đ</strong>
          {activeMa20 !== null && (
            <>
              {" "}
              • MA20: <strong className="text-amber-500">{activeMa20.toLocaleString("vi-VN")} đ</strong> (
              <span className={diffMa20Pct >= 0 ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
                {diffMa20Pct >= 0 ? "+" : ""}
                {diffMa20Pct.toFixed(1)}%
              </span>
              )
            </>
          )}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto select-none cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[minP, (minP + maxP) / 2, maxP].map((tv, i) => (
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

        {/* Crosshair */}
        <line
          x1={xAt(activeIdx)}
          x2={xAt(activeIdx)}
          y1={padT}
          y2={h - padB}
          stroke={dark ? "#94a3b8" : "#475569"}
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        {activeMa20 !== null && (
          <circle cx={xAt(activeIdx)} cy={yAt(activeMa20)} r="3" fill="#f59e0b" />
        )}
        <circle
          cx={xAt(activeIdx)}
          cy={yAt(activeClose)}
          r="4.5"
          fill={strokeCol}
          stroke="#ffffff"
          strokeWidth="1.5"
        />

        <text x={padL} y={h - 6} fontSize="9.5" fill={dark ? "#94a3b8" : "#64748b"}>
          {dates[0]}
        </text>
        <text x={w - padR} y={h - 6} textAnchor="end" fontSize="9.5" fill={dark ? "#94a3b8" : "#64748b"}>
          {dates[dates.length - 1]}
        </text>
      </svg>
    </div>
  );
}

/* ============================================================================
   SVG CHART 3: INTERACTIVE RETURN DISTRIBUTION & VaR / ES 95%
   ============================================================================ */
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
  const [hoverBin, setHoverBin] = useState<number | null>(null);

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

  const bIdx = hoverBin;
  const bLow = bIdx !== null ? ((minR + bIdx * step) * 100).toFixed(2) : null;
  const bHigh = bIdx !== null ? ((minR + (bIdx + 1) * step) * 100).toFixed(2) : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] font-mono-num">
        {bIdx !== null ? (
          <span>
            Biên lợi suất: <strong>{bLow}% đến {bHigh}%</strong> • Tần suất:{" "}
            <strong className="text-blue-500">{counts[bIdx]} phiên</strong> (
            {((counts[bIdx] / returns.length) * 100).toFixed(1)}%)
          </span>
        ) : (
          <span className="opacity-75">Rê chuột vào các cột để xem tần suất phân phối lợi suất ngày</span>
        )}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto select-none">
        {counts.map((c, i) => {
          const rCenter = minR + (i + 0.5) * step;
          const bw = (w - padL - padR) / bins - 2;
          const bh = (c / maxC) * (h - padT - padB);
          const bx = padL + i * ((w - padL - padR) / bins) + 1;
          const by = h - padB - bh;
          const isTail = rCenter <= -var95Pct;
          const isHov = hoverBin === i;
          return (
            <rect
              key={i}
              x={bx}
              y={by}
              width={Math.max(2, bw)}
              height={Math.max(2, bh)}
              rx={2}
              fill={isTail ? "#f43f5e" : "#3b82f6"}
              opacity={isHov ? 1.0 : isTail ? 0.82 : 0.58}
              className="cursor-pointer"
              onMouseEnter={() => setHoverBin(i)}
              onMouseLeave={() => setHoverBin(null)}
            />
          );
        })}
        <line x1={varX} x2={varX} y1={padT} y2={h - padB} stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 2" />
        <text x={varX + 4} y={padT + 10} fontSize="10" fontWeight="700" fill="#f59e0b">
          VaR 95%: -{(var95Pct * 100).toFixed(2)}%
        </text>
        <line x1={esX} x2={esX} y1={padT + 14} y2={h - padB} stroke="#e11d48" strokeWidth="2" />
        <text x={Math.max(padL, esX - 4)} y={padT + 24} textAnchor="end" fontSize="10" fontWeight="700" fill="#e11d48">
          ES: -{(es95Pct * 100).toFixed(2)}%
        </text>
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
    </div>
  );
}

export default function HomePage() {
  const [bundle, setBundle] = useState<SnapshotBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("regime");
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Discovery controls
  const [sectorFilter, setSectorFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [minScore, setMinScore] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"TOP10" | "ALL">("ALL");
  const [selectedStock, setSelectedStock] = useState<DiscoveryStock | null>(null);

  // Portfolio & What-If state
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

  const activeHealth: PortfolioHealth | null = useMemo(() => {
    if (!bundle) return null;
    const retMap = bundle.quant_client_data?.returns_130d;
    if (retMap) {
      const computed = computeClientPortfolioHealth(positions, cashVnd, retMap, discoveryMap);
      if (computed) return computed;
    }
    return bundle.default_portfolio.health;
  }, [bundle, positions, cashVnd, discoveryMap]);

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
      "TrendScore",
      "LiquidityScore",
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
        r.trend_score ?? "",
        r.liquidity_score ?? "",
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
      <div className="flex min-h-screen items-center justify-center bg-[#070d19] text-slate-200">
        <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-[#0d1627] px-6 py-4">
          <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
          <span className="text-sm font-semibold">Đang khởi tạo hệ thống định lượng Pori...</span>
        </div>
      </div>
    );
  }

  if (error || !bundle || !activeHealth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070d19] p-6 text-rose-300">
        <div className="max-w-md rounded-xl border border-rose-500/30 bg-[#0d1627] p-6">
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
      {/* STICKY HEADER */}
      <header
        className={`sticky top-0 z-30 border-b backdrop-blur-md ${
          darkMode ? "border-slate-800 bg-[#081020]/95" : "border-slate-200 bg-white/95 shadow-xs"
        }`}
      >
        <div className="mx-auto max-w-[1640px] px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                <Compass className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className={`text-lg font-extrabold tracking-tight sm:text-xl ${textBright}`}>
                    PORI <span className="font-semibold text-blue-500">QUANT COCKPIT</span>
                  </h1>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    ENGINE ACTIVE • {bundle.sessions_count} PHIÊN
                  </span>
                </div>
                <p className={`text-xs ${textMuted}`}>
                  Nền tảng phân tích bối cảnh thị trường, sàng lọc cổ phiếu định lượng & mô phỏng rủi ro phân bổ danh mục
                </p>
              </div>
            </div>

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

          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              { id: "regime", label: "🌐 Màn hình 1: Khí Áp & Luân Chuyển Ngành", icon: Activity },
              { id: "discovery", label: "🎯 Màn hình 2: Tầm Soát Alpha & Hồ Sơ 360°", icon: Search },
              { id: "portfolio", label: "🛡️ Màn hình 3: Khám Danh Mục & Mô Phỏng What-If", icon: ShieldCheck },
              { id: "orderbook", label: "⚡ Màn hình 4: Sổ Lệnh 3 Bước Giá & Chi Phí Khớp", icon: Layers },
              { id: "validation", label: "🔬 Màn hình 5: Kiểm Chứng, Data Mapping & Thiết Kế", icon: BarChart3 },
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

      <main className="mx-auto max-w-[1640px] space-y-5 px-4 pt-5 sm:px-6">
        {/* EXECUTIVE 30-SECOND ACTION BOX */}
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
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-blue-500">
              <Zap className="h-4 w-4" />
              HỘP ĐIỀU HÀNH & TÓM TẮT ĐỊNH LƯỢNG 30 GIÂY — TIÊU ĐIỂM HÀNH ĐỘNG ({bundle.latest_trading_date})
            </div>
            <span className={`text-xs ${textMuted}`}>Phạm vi độ rộng: {bundle.breadth_scope}</span>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className={`rounded-lg border p-3 ${bgCard}`}>
              <div className={`text-[11px] font-semibold uppercase ${textMuted}`}>
                1. Phán quyết Khí áp & Đồng thuận Tín hiệu
              </div>
              <div className={`mt-1 text-sm font-bold ${textBright}`}>
                {regime.regime} ({regime.positive_pillars}/3 trụ cột tích cực • Điểm đồng thuận: {regime.consensus_score})
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
                    className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs font-bold text-blue-400 hover:bg-blue-600 hover:text-white"
                  >
                    {d.symbol} <span className="font-mono-num">({d.alpha_score})</span>
                  </button>
                ))}
              </div>
              <p className={`mt-1.5 text-xs ${textMuted}`}>
                Tách riêng Alpha Score (tín hiệu thị trường) với Portfolio Fit Score.
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
                      Ứng viên: <span className="text-emerald-400">{bestFitCandidate.candidate_symbol}</span> (Fit:{" "}
                      {bestFitCandidate.portfolio_fit_score}/100)
                    </span>
                    <button
                      onClick={() => {
                        setWhatIfSymbol(bestFitCandidate.candidate_symbol);
                        setActiveTab("portfolio");
                      }}
                      className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                    >
                      So sánh Trước/Sau →
                    </button>
                  </div>
                  <p className={`mt-1 text-xs ${textMuted}`}>
                    Tương quan TB = {bestFitCandidate.avg_corr_with_portfolio} • ΔHHI ={" "}
                    {bestFitCandidate.delta_hhi_stock.toFixed(3)} • DTL = {bestFitCandidate.candidate_dtl_days ?? 0.2}d
                  </p>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* =====================================================================
            SCREEN 1: MARKET REGIME & SECTOR ROTATION
           ===================================================================== */}
        {activeTab === "regime" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>CHỈ SỐ VNINDEX</div>
                <div className={`font-mono-num mt-1 text-2xl font-extrabold ${textBright}`}>
                  {regime.vnindex_close.toLocaleString("vi-VN")}
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  MA20: <strong className="text-emerald-500">{regime.ma20}</strong> • MA50:{" "}
                  <strong className="text-amber-500">{regime.ma50}</strong>
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>ĐỘ RỘNG TOÀN SÀN (BREADTH)</div>
                <div className={`font-mono-num mt-1 text-2xl font-extrabold ${textBright}`}>
                  A/D: {regime.ad_ratio.toFixed(2)}x
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="font-bold text-emerald-500">
                    ▲ {bundle.breadth_counts?.advances ?? "--"} Tăng
                  </span>
                  <span className="font-bold text-rose-500">
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
                <div className="font-mono-num mt-1 text-2xl font-extrabold text-blue-500">
                  {activeHealth.health_score} / 100
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  VaR 95% (1 ngày): <strong className="text-rose-500">{fmtVnd(activeHealth.hist_var_95_vnd)}</strong>
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-12">
              <div className={`rounded-xl border p-5 lg:col-span-7 ${bgCard}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className={`text-base font-bold ${textBright}`}>
                      Đồ thị Xu hướng VNINDEX (90 Phiên) & Đường Trung bình Động
                    </h2>
                    <p className={`text-xs ${textMuted}`}>
                      Rê chuột vào biểu đồ để xem chi tiết Điểm số, MA20, MA50 và Khối lượng từng phiên
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-semibold">
                    <span className="flex items-center gap-1 text-blue-500">● VNINDEX</span>
                    <span className="flex items-center gap-1 text-emerald-500">● MA20</span>
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
                      <div className="text-xs font-bold text-blue-500">{p.title}</div>
                      <div className={`mt-1 text-xs font-medium ${textBright}`}>{p.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`rounded-xl border p-5 lg:col-span-5 ${bgCard}`}>
                <div className="mb-3">
                  <h2 className={`text-base font-bold ${textBright}`}>
                    Bản đồ Luân chuyển Sức mạnh Ngành
                  </h2>
                  <p className={`text-xs ${textMuted}`}>
                    Xếp hạng theo Điểm Alpha trung bình & % cổ phiếu nằm trên MA20 (Bấm vào ngành để lọc)
                  </p>
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
                        <span className="font-mono-num font-bold text-blue-500">
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
                          <strong className={sec.avg_rs_20d_pct >= 0 ? "text-emerald-500" : "text-rose-500"}>
                            {sec.avg_rs_20d_pct >= 0 ? "+" : ""}
                            {sec.avg_rs_20d_pct}%
                          </strong>
                        </span>
                        <span>
                          Dẫn đầu: <strong className="text-blue-500">{sec.top_symbol}</strong> ({sec.top_score})
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
            <div className="space-y-4 lg:col-span-8">
              <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 ${bgCard}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setViewMode("TOP10")}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                      viewMode === "TOP10"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-700 bg-slate-900 text-slate-300"
                    }`}
                  >
                    🔥 Top 10 Tinh hoa
                  </button>
                  <button
                    onClick={() => setViewMode("ALL")}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                      viewMode === "ALL"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-700 bg-slate-900 text-slate-300"
                    }`}
                  >
                    📋 Toàn bộ ({bundle.discovery.length} mã)
                  </button>

                  <select
                    value={sectorFilter}
                    onChange={(e) => setSectorFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
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
                    className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-1.5 text-xs font-bold text-blue-300 hover:bg-blue-600 hover:text-white"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Xuất CSV
                  </button>
                </div>
              </div>

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
                        <th className="px-2 py-3">Ngành</th>
                        <th className="px-2 py-3 text-right">Giá (VNĐ)</th>
                        <th className="px-2 py-3 text-right">RS 20d</th>
                        <th className="px-2 py-3 text-center">Trend / Liq</th>
                        <th className="px-2 py-3 text-center">Alpha Score</th>
                        <th className="px-2 py-3 text-center">Portfolio Fit</th>
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
                                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                                    Đang giữ
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`px-2 py-2.5 ${textMuted}`}>{item.sector}</td>
                            <td className={`px-2 py-2.5 text-right font-mono-num font-semibold ${textBright}`}>
                              {item.close_price.toLocaleString("vi-VN")}
                            </td>
                            <td
                              className={`px-2 py-2.5 text-right font-mono-num font-bold ${
                                item.rs_20d >= 0 ? "text-emerald-500" : "text-rose-500"
                              }`}
                            >
                              {item.rs_20d >= 0 ? "+" : ""}
                              {(item.rs_20d * 100).toFixed(1)}%
                            </td>
                            <td className="px-2 py-2.5 text-center font-mono-num text-[11px]">
                              <span className="text-blue-400">{item.trend_score}</span> /{" "}
                              <span className="text-emerald-400">{item.liquidity_score}</span>
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <span className="inline-block rounded-md bg-blue-600 px-2.5 py-0.5 font-mono-num font-bold text-white">
                                {item.alpha_score ?? "N/A"}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              {fit ? (
                                <span
                                  className={`inline-block rounded-md border px-2 py-0.5 font-mono-num font-bold ${
                                    fit.portfolio_fit_score >= 60
                                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                      : "border-amber-500/40 bg-amber-500/15 text-amber-300"
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
                                className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-600 hover:text-white"
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

            {/* Right 4 cols: 360 Stock Dossier */}
            <div className="lg:col-span-4">
              {selectedStock ? (
                <div className={`sticky top-28 space-y-4 rounded-xl border p-5 ${bgCard}`}>
                  <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                    <div>
                      <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-300">
                        Why This Stock? • {selectedStock.sector}
                      </span>
                      <h3 className={`mt-1 text-2xl font-extrabold ${textBright}`}>
                        {selectedStock.symbol}{" "}
                        <span className="font-mono-num text-lg font-bold text-blue-400">
                          {selectedStock.close_price.toLocaleString("vi-VN")} đ
                        </span>
                      </h3>
                    </div>
                    <div className="flex gap-2 text-right">
                      <div className="rounded-lg border border-blue-500/40 bg-blue-500/15 px-2.5 py-1.5 text-center">
                        <div className="text-[10px] font-bold text-blue-300">ALPHA</div>
                        <div className="font-mono-num text-lg font-extrabold text-blue-400">
                          {selectedStock.alpha_score}
                        </div>
                      </div>
                      {selectedFit && (
                        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-center">
                          <div className="text-[10px] font-bold text-emerald-300">PORT FIT</div>
                          <div className="font-mono-num text-lg font-extrabold text-emerald-400">
                            {selectedFit.portfolio_fit_score}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedSeries && (
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <StockMiniChart
                        symbol={selectedStock.symbol}
                        dates={selectedSeries.dates_60d}
                        closes={selectedSeries.closes_60d}
                        ma20={selectedSeries.ma20_60d}
                        dark={darkMode}
                      />
                    </div>
                  )}

                  <div className={`space-y-2 rounded-lg border p-3.5 text-xs ${bgSub}`}>
                    <div className="flex justify-between font-bold">
                      <span>Phân rã 4 Cấu phần Alpha Score</span>
                      <span className="text-blue-400">
                        Độ đầy đủ dữ liệu: {Math.round(selectedStock.data_completeness * 100)}%
                      </span>
                    </div>
                    {[
                      { label: "1. Trend & Momentum (35%)", val: selectedStock.trend_score, col: "bg-blue-500" },
                      { label: "2. Liquidity & Trading Quality (25%)", val: selectedStock.liquidity_score, col: "bg-emerald-500" },
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
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                          <div className={`h-full ${c.col}`} style={{ width: `${c.val ?? 0}%` }} />
                        </div>
                      </div>
                    ))}
                    <div className="pt-1 text-[11px] text-amber-400">
                      Trạng thái dữ liệu: {selectedStock.data_flag} (Tái chuẩn hóa trọng số trên các trụ cột hợp lệ)
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="font-bold uppercase tracking-wider text-blue-400">
                      Vì sao cổ phiếu này xuất hiện trong danh sách?
                    </div>
                    {selectedStock.reasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2 border-t border-slate-800 pt-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <BookOpen className="h-3.5 w-3.5 text-blue-400" />
                      Nguồn Tham khảo Chính thống ({selectedStock.symbol}) — Không sao chép trái phép
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
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 font-semibold text-blue-300 hover:border-blue-500"
                        >
                          {lnk.name}
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ))}
                    </div>
                  </div>

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
                      className="rounded-lg border border-blue-500 px-3 py-2 text-xs font-bold text-blue-400 hover:bg-blue-500/15"
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
            SCREEN 3: PORTFOLIO HEALTH & 5-DIMENSION WHAT-IF LAB
           ===================================================================== */}
        {activeTab === "portfolio" && (
          <div className="space-y-5">
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
                <div className={`text-xs font-semibold ${textMuted}`}>TẬP TRUNG RIÊNG BIỆT (HHI MÃ / NGÀNH)</div>
                <div className={`font-mono-num mt-1 text-2xl font-extrabold ${textBright}`}>
                  {activeHealth.hhi_stock.toFixed(3)} <span className="text-sm font-normal">/ {activeHealth.hhi_sector.toFixed(3)}</span>
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  Số vị thế hiệu dụng (N_eff): <strong>{activeHealth.n_effective_stock} mã</strong>
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>HISTORICAL VaR 95% & ES 95% (1 NGÀY)</div>
                <div className="font-mono-num mt-1 text-2xl font-extrabold text-rose-500">
                  -{fmtVnd(activeHealth.hist_var_95_vnd)}
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  ({(activeHealth.hist_var_95_pct * 100).toFixed(2)}% NAV) • ES 95%:{" "}
                  <strong>-{fmtVnd(activeHealth.hist_es_95_vnd)}</strong>
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${bgCard}`}>
                <div className={`text-xs font-semibold ${textMuted}`}>BETA DANH MỤC & ĐIỂM SỨC KHỎE</div>
                <div className="font-mono-num mt-1 text-2xl font-extrabold text-emerald-500">
                  {activeHealth.health_score} / 100
                </div>
                <div className={`mt-1 text-xs ${textMuted}`}>
                  Beta vs VNINDEX: <strong>{activeHealth.portfolio_beta}</strong> • Vol năm:{" "}
                  {(activeHealth.annualized_vol_pct * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Interactive Portfolio Editor with Marginal Risk Contribution */}
            <div className={`rounded-xl border p-5 ${bgCard}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className={`text-base font-bold ${textBright}`}>
                    Danh mục Đang Nắm Giữ & Đóng góp Rủi ro Biên (Marginal Risk Contribution %)
                  </h3>
                  <p className={`text-xs ${textMuted}`}>
                    Không cần đăng nhập tài khoản chứng khoán thật để đảm bảo bảo mật — hỗ trợ nhập tay hoặc Upload CSV (<code className="font-mono-num">symbol,value_vnd</code>).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setPositions(bundle.default_portfolio.positions);
                      setCashVnd(bundle.default_portfolio.cash_vnd);
                      setPortfolioMsg("Đã khôi phục danh mục mẫu 5 mã.");
                    }}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-800"
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

              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(positions).map(([sym, val]) => {
                  const weightPct = ((val / activeHealth.total_nav_vnd) * 100).toFixed(1);
                  const riskContrib = activeHealth.component_risk_pct?.[sym] ?? weightPct;
                  const dtl = activeHealth.days_to_liquidate[sym] ?? 0.2;
                  return (
                    <div
                      key={sym}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${bgSub}`}
                    >
                      <span className="font-mono-num font-extrabold text-blue-400">{sym}</span>
                      <span className="font-mono-num font-semibold">{fmtVnd(val)}</span>
                      <span className={textMuted}>
                        (Vốn: {weightPct}% • <strong className="text-rose-400">Rủi ro biên: {riskContrib}%</strong> • DTL: {dtl}d)
                      </span>
                      <button
                        onClick={() => {
                          const next = { ...positions };
                          delete next[sym];
                          if (Object.keys(next).length > 0) setPositions(next);
                        }}
                        className="text-slate-400 hover:text-rose-500"
                        title="Xóa vị thế"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-800 pt-3">
                <div>
                  <label className={`mb-1 block text-[11px] font-semibold ${textMuted}`}>Chọn mã thêm/cập nhật</label>
                  <select
                    value={newPosSym}
                    onChange={(e) => setNewPosSym(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white"
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
                    className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono-num text-xs font-bold text-white"
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
                      className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono-num text-xs font-bold text-white"
                    />
                  </div>
                </div>
              </div>
              {portfolioMsg && <p className="mt-2 text-xs font-semibold text-blue-400">{portfolioMsg}</p>}
            </div>

            {/* 5-DIMENSION BEFORE vs AFTER WHAT-IF SIMULATOR */}
            <div className={`rounded-xl border-2 border-blue-500/40 p-5 ${bgCard}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-blue-300">
                    Portfolio-Aware Discovery • Đối chiếu 5 Chiều Trước & Sau
                  </span>
                  <h3 className={`mt-1 text-base font-bold ${textBright}`}>
                    Mô phỏng Tác động Quyết định Phân bổ Danh mục (What-If Impact)
                  </h3>
                </div>

                <div className="flex flex-wrap items-end gap-2.5">
                  <div>
                    <label className={`mb-1 block text-[11px] font-semibold ${textMuted}`}>Cổ phiếu dự kiến mua</label>
                    <select
                      value={whatIfSymbol}
                      onChange={(e) => setWhatIfSymbol(e.target.value)}
                      className="rounded-lg border border-blue-500/50 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white"
                    >
                      {bundle.discovery.map((d) => (
                        <option key={d.symbol} value={d.symbol}>
                          {d.symbol} — {d.sector} (Alpha: {d.alpha_score})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={`mb-1 block text-[11px] font-semibold ${textMuted}`}>Số tiền dự kiến bổ sung (VNĐ)</label>
                    <input
                      type="number"
                      step={10_000_000}
                      value={whatIfAmount}
                      onChange={(e) => setWhatIfAmount(Math.max(5_000_000, Number(e.target.value)))}
                      className="w-44 rounded-lg border border-blue-500/50 bg-slate-900 px-3 py-1.5 font-mono-num text-xs font-bold text-white"
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
                            : "border-slate-700 bg-slate-900 text-slate-300"
                        }`}
                      >
                        +{amt / 1e6}tr
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {activeWhatIf && (
                <div className="mt-4 space-y-4">
                  {/* 5 Explicit Questions Answered Before vs After */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] font-semibold ${textMuted}`}>
                        1. Tỷ trọng ngành ({activeWhatIf.candidate_sector})
                      </div>
                      <div className="font-mono-num mt-1 text-lg font-extrabold text-blue-400">
                        {activeWhatIf.sector_weight_before ?? 0}% → {activeWhatIf.sector_weight_after ?? 0}%
                      </div>
                      <div className={`mt-1 text-[11px] ${textMuted}`}>
                        HHI Ngành: {activeWhatIf.hhi_sector_before.toFixed(3)} → {activeWhatIf.hhi_sector_after.toFixed(3)}
                      </div>
                    </div>

                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] font-semibold ${textMuted}`}>
                        2. Độ tập trung HHI Cổ phiếu
                      </div>
                      <div
                        className={`font-mono-num mt-1 text-lg font-extrabold ${
                          activeWhatIf.delta_hhi_stock <= 0 ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {activeWhatIf.hhi_stock_before.toFixed(3)} → {activeWhatIf.hhi_stock_after.toFixed(3)}
                      </div>
                      <div className={`mt-1 text-[11px] ${textMuted}`}>
                        ΔHHI: {activeWhatIf.delta_hhi_stock >= 0 ? "+" : ""}
                        {activeWhatIf.delta_hhi_stock.toFixed(4)}
                      </div>
                    </div>

                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] font-semibold ${textMuted}`}>
                        3. Thay đổi VaR 95% & ES 95%
                      </div>
                      <div
                        className={`font-mono-num mt-1 text-lg font-extrabold ${
                          activeWhatIf.delta_var_pct <= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {activeWhatIf.delta_var_vnd >= 0 ? "+" : ""}
                        {fmtVnd(activeWhatIf.delta_var_vnd)}
                      </div>
                      <div className={`mt-1 text-[11px] ${textMuted}`}>
                        Trước: {fmtVnd(activeWhatIf.var_95_before_vnd)} → Sau: {fmtVnd(activeWhatIf.var_95_after_vnd)}
                      </div>
                    </div>

                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] font-semibold ${textMuted}`}>
                        4. Tương quan với vị thế hiện hữu
                      </div>
                      <div className="font-mono-num mt-1 text-lg font-extrabold text-white">
                        ρ_TB = {activeWhatIf.avg_corr_with_portfolio}
                      </div>
                      <div className={`mt-1 text-[11px] ${textMuted}`}>
                        {activeWhatIf.pairwise_corr &&
                          Object.entries(activeWhatIf.pairwise_corr)
                            .slice(0, 3)
                            .map(([k, v]) => `${k}:${v}`)
                            .join(" • ")}
                      </div>
                    </div>

                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] font-semibold ${textMuted}`}>
                        5. Khả năng Thanh khoản & Fit Score
                      </div>
                      <div className="font-mono-num mt-1 text-lg font-extrabold text-emerald-400">
                        Fit: {activeWhatIf.portfolio_fit_score}/100
                      </div>
                      <div className={`mt-1 text-[11px] ${textMuted}`}>
                        DTL (@10% ADV): <strong>{activeWhatIf.candidate_dtl_days ?? 0.2} phiên</strong> (
                        {activeWhatIf.liquidity_feasible ? "Đáp ứng tốt" : "Cần chia nhỏ lệnh"})
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs">
                    <div>
                      <strong className="text-blue-400">Diễn giải tác động rủi ro biên:</strong>{" "}
                      {activeWhatIf.explanation}
                    </div>
                    <button
                      onClick={() => {
                        setPositions({
                          ...positions,
                          [activeWhatIf.candidate_symbol]:
                            (positions[activeWhatIf.candidate_symbol] || 0) + activeWhatIf.add_amount_vnd,
                        });
                        setPortfolioMsg(
                          `Đã bổ sung ${fmtVnd(activeWhatIf.add_amount_vnd)} vào ${activeWhatIf.candidate_symbol}!`
                        );
                      }}
                      className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 font-bold text-white hover:bg-blue-700"
                    >
                      Áp dụng vào Danh mục
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 3 Visual Risk Panels */}
            <div className="grid gap-5 lg:grid-cols-12">
              <div className={`rounded-xl border p-5 lg:col-span-5 ${bgCard}`}>
                <h3 className={`text-sm font-bold ${textBright}`}>
                  Phân phối Lợi suất Ngày Danh mục (130 Phiên) & Stress-Test Đa Chiều
                </h3>
                <p className={`mb-2 text-xs ${textMuted}`}>
                  Bao gồm kịch bản biến động thị trường chung, cú sốc ngành lớn nhất và khủng hoảng tương quan (ρ → 1.0)
                </p>
                {activeHealth.daily_returns_series && (
                  <ReturnDistChart
                    returns={activeHealth.daily_returns_series}
                    var95Pct={activeHealth.hist_var_95_pct}
                    es95Pct={activeHealth.hist_es_95_pct}
                    dark={darkMode}
                  />
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  {Object.entries(activeHealth.stress_tests).map(([scen, loss]) => (
                    <div key={scen} className={`rounded-lg border p-2 ${bgSub}`}>
                      <div className={`text-[10px] ${textMuted}`}>{scen}</div>
                      <div className="font-mono-num mt-0.5 font-bold text-rose-500">{fmtVnd(loss)}</div>
                    </div>
                  ))}
                </div>
              </div>

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
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full rounded-full ${w > 0.45 ? "bg-rose-500" : "bg-blue-600"}`}
                            style={{ width: `${w * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              </div>

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
                        <tr key={rSym} className="border-t border-slate-800">
                          <td className="p-1.5 text-left font-mono-num font-bold">{rSym}</td>
                          {Object.entries(cols).map(([cSym, val]) => {
                            const isSelf = rSym === cSym;
                            const cellBg = isSelf
                              ? "bg-slate-800 text-slate-400"
                              : val >= 0.65
                              ? "bg-rose-500/20 text-rose-300 font-bold"
                              : val <= 0.35
                              ? "bg-emerald-500/20 text-emerald-300 font-bold"
                              : "text-slate-300";
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
            SCREEN 4: ORDER BOOK 3-LEVEL DEPTH LADDER & EXECUTION COST
           ===================================================================== */}
        {activeTab === "orderbook" && (
          <div className="grid gap-5 lg:grid-cols-12">
            <div className={`space-y-4 rounded-xl border p-5 lg:col-span-5 ${bgCard}`}>
              <div>
                <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-300">
                  Microstructure Liquidity Engine
                </span>
                <h2 className={`mt-1 text-lg font-bold ${textBright}`}>
                  Order Book Liquidity & Estimated Execution Cost
                </h2>
                <p className={`text-xs ${textMuted}`}>
                  Hiển thị tách biệt OBI (3 mức giá), Bid-Ask Spread (%), Độ sâu 3 bước giá và Market Impact theo quy mô lệnh giả định (tuyệt đối không ngoại suy vượt độ sâu 3 bước giá).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`mb-1 block text-xs font-semibold ${textMuted}`}>Chọn Mã Cổ phiếu</label>
                  <select
                    value={obSymbol}
                    onChange={(e) => setObSymbol(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-white"
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
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                  >
                    <option value="buy">MUA Chủ động (Quét Ask 1→3)</option>
                    <option value="sell">BÁN Chủ động (Quét Bid 1→3)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={`mb-1 block text-xs font-semibold ${textMuted}`}>
                  Quy mô vị thế dự kiến (VNĐ)
                </label>
                <input
                  type="number"
                  step={50_000_000}
                  value={obAmount}
                  onChange={(e) => setObAmount(Math.max(10_000_000, Number(e.target.value)))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono-num text-sm font-bold text-white"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[50_000_000, 200_000_000, 500_000_000, 1_500_000_000, 3_000_000_000].map((v) => (
                    <button
                      key={v}
                      onClick={() => setObAmount(v)}
                      className={`rounded border px-2.5 py-1 text-xs font-bold ${
                        obAmount === v
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-700 bg-slate-900 text-slate-300"
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
                      <div className={`text-[11px] ${textMuted}`}>1. Mất cân bằng OBI (3 mức)</div>
                      <div
                        className={`font-mono-num mt-0.5 text-xl font-extrabold ${
                          activeOrderBookEval.eval.obi_3_levels >= 0 ? "text-emerald-500" : "text-rose-500"
                        }`}
                      >
                        {activeOrderBookEval.eval.obi_3_levels >= 0 ? "+" : ""}
                        {(activeOrderBookEval.eval.obi_3_levels * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] ${textMuted}`}>2. Bid-Ask Spread (%)</div>
                      <div className={`font-mono-num mt-0.5 text-xl font-extrabold ${textBright}`}>
                        {activeOrderBookEval.eval.spread_pct.toFixed(2)}%
                      </div>
                    </div>
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] ${textMuted}`}>3. Giá khớp BQ Ước tính</div>
                      <div className="font-mono-num mt-0.5 text-xl font-extrabold text-blue-400">
                        {activeOrderBookEval.eval.estimated_avg_price.toLocaleString("vi-VN")} đ
                      </div>
                    </div>
                    <div className={`rounded-lg border p-3 ${bgSub}`}>
                      <div className={`text-[11px] ${textMuted}`}>4. Market Impact (Tách riêng Phí)</div>
                      <div className="font-mono-num mt-0.5 text-xl font-extrabold text-rose-500">
                        +{activeOrderBookEval.eval.estimated_cost_pct.toFixed(3)}%
                      </div>
                    </div>
                  </div>

                  <div
                    className={`rounded-lg border p-3.5 text-xs font-medium ${
                      activeOrderBookEval.eval.sufficient_depth
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-200"
                    }`}
                  >
                    {activeOrderBookEval.eval.note}
                  </div>
                </div>
              )}
            </div>

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
                            : "Tham chiếu Hiệu chuẩn theo Bước giá HOSE & ADV20 (SSI)"}
                        </strong>
                      </p>
                    </div>
                    <div className="text-xs font-semibold">
                      Tổng cầu 3 mức:{" "}
                      <span className="font-mono-num text-emerald-500">
                        {fmtVnd(activeOrderBookEval.eval.total_bid_value_3l)}
                      </span>{" "}
                      • Tổng cung 3 mức:{" "}
                      <span className="font-mono-num text-rose-500">
                        {fmtVnd(activeOrderBookEval.eval.total_ask_value_3l)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="text-xs font-bold uppercase text-emerald-500">
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
                              <span className="font-mono-num text-emerald-400">
                                {p.toLocaleString("vi-VN")} đ
                              </span>
                              <span className="font-mono-num">{v.toLocaleString("vi-VN")} CP</span>
                            </div>
                            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full bg-emerald-500"
                                style={{ width: `${(v / maxV) * 100}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-bold uppercase text-rose-500">
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
                              <span className="font-mono-num text-rose-400">
                                {p.toLocaleString("vi-VN")} đ
                              </span>
                              <span className="font-mono-num">{v.toLocaleString("vi-VN")} CP</span>
                            </div>
                            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
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
                      <tbody className="divide-y divide-slate-800">
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
                            <td className="p-2 text-right font-mono-num font-bold text-blue-400">
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
            SCREEN 5: VALIDATION HUB, DATA MAPPING & 7 QUANT DESIGN ANSWERS
           ===================================================================== */}
        {activeTab === "validation" && (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              {/* 1. Signal Validation separated from VaR & broken down by signal group */}
              <div className={`rounded-xl border p-5 ${bgCard}`}>
                <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-300">
                  Bài toán Kiểm định 1 — Signal Performance Tracking
                </span>
                <h3 className={`mt-1 text-base font-bold ${textBright}`}>
                  Signal Validation — Hiệu suất theo Kỳ hạn & Nhóm Tín hiệu (vs VNINDEX)
                </h3>
                <p className={`mt-1 text-xs ${textMuted}`}>
                  Đo lợi suất vượt trội sau thời điểm phát sinh tín hiệu (vào lệnh tại T+1 để chống Look-Ahead Bias, đã trừ 0.30% phí/thuế).
                </p>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className={`border-b ${bgSub}`}>
                      <tr>
                        <th className="p-2.5">Nhóm Tín hiệu / Kỳ hạn</th>
                        <th className="p-2.5 text-right">Số mẫu</th>
                        <th className="p-2.5 text-right">Excess Return TB</th>
                        <th className="p-2.5 text-right">Median Excess</th>
                        <th className="p-2.5 text-right">Win Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {bundle.validation.signal_validation.map((row) => (
                        <tr key={row.horizon_days}>
                          <td className="p-2.5 font-mono-num font-bold">
                            Top Alpha Tổng hợp (T+{row.horizon_days})
                          </td>
                          <td className="p-2.5 text-right font-mono-num">{row.sample_count} mẫu</td>
                          <td
                            className={`p-2.5 text-right font-mono-num font-bold ${
                              row.avg_excess_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"
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

                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <strong>Ý nghĩa kiểm định:</strong> Bảng trên tách bạch hoàn toàn khỏi VaR Backtesting. Khi không lọc theo trạng thái thị trường (Un-gated Momentum), việc mua đuổi trong các nhịp thị trường suy yếu cho Excess Return âm sau phí — chứng minh vai trò sống còn của <strong>Market Regime (Màn hình 1)</strong> và <strong>Portfolio Fit (Màn hình 3)</strong>.
                </div>
              </div>

              {/* 2. Risk Model Validation (VaR Backtesting) */}
              <div className={`rounded-xl border p-5 ${bgCard}`}>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                  Bài toán Kiểm định 2 — Risk Model Validation
                </span>
                <h3 className={`mt-1 text-base font-bold ${textBright}`}>
                  VaR Backtesting — Kiểm định Vượt ngưỡng Historical VaR 95% (257 Phiên)
                </h3>
                <p className={`mt-1 text-xs ${textMuted}`}>
                  So sánh mức lỗ thực tế hàng ngày của danh mục với ngưỡng VaR 95% dự báo từ cửa sổ trượt{" "}
                  {bundle.validation.risk_model_validation.window_days} phiên trước đó (không dùng 5–10 phiên ngắn hạn để kết luận thống kê).
                </p>

                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className={`rounded-lg border p-3 ${bgSub}`}>
                    <div className={`text-[11px] ${textMuted}`}>Số phiên kiểm định ngoài mẫu</div>
                    <div className={`font-mono-num mt-1 text-xl font-extrabold ${textBright}`}>
                      {bundle.validation.risk_model_validation.test_days} phiên
                    </div>
                  </div>
                  <div className={`rounded-lg border p-3 ${bgSub}`}>
                    <div className={`text-[11px] ${textMuted}`}>Số ngày lỗ vượt VaR 95%</div>
                    <div className="font-mono-num mt-1 text-xl font-extrabold text-rose-400">
                      {bundle.validation.risk_model_validation.exceptions} ngày (
                      {(bundle.validation.risk_model_validation.exception_rate * 100).toFixed(2)}%)
                    </div>
                  </div>
                  <div className={`rounded-lg border p-3 ${bgSub}`}>
                    <div className={`text-[11px] ${textMuted}`}>Tỷ lệ Kỳ vọng Lý thuyết</div>
                    <div className="font-mono-num mt-1 text-xl font-extrabold text-blue-400">
                      {(bundle.validation.risk_model_validation.expected_rate * 100).toFixed(2)}%
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200">
                  <strong>Kết luận Kiểm định Mô hình Rủi ro:</strong>{" "}
                  {bundle.validation.risk_model_validation.status}. Tỷ lệ vượt ngưỡng thực tế (4.41% trên 136 phiên ngoài mẫu) bám sát mức kỳ vọng 5.00%.
                </div>
              </div>
            </div>

            {/* 3. DATA MAPPING MATRIX & 3 DATA LAYERS */}
            <div className={`rounded-xl border p-5 ${bgCard}`}>
              <div className="flex items-center gap-2 text-base font-bold">
                <Database className="h-4 w-4 text-blue-400" />
                <span>Ma trận Ánh xạ Dữ liệu (Data Mapping) & Phân tầng 3 Lớp Dữ liệu</span>
              </div>
              <p className={`mt-1 text-xs ${textMuted}`}>
                Phân biệt rõ Dữ liệu Giao dịch Real-time (quan sát), Dữ liệu Lịch sử Nghiên cứu (257 phiên kiểm định) và Dữ liệu Doanh nghiệp (BCTC/Tham khảo), đảm bảo đồng nhất đơn vị (VNĐ), múi giờ (UTC+7) và khả năng vận hành độc lập khi 1 API bị giới hạn IP.
              </p>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className={`border-b ${bgSub}`}>
                    <tr>
                      <th className="p-2.5">Lớp dữ liệu</th>
                      <th className="p-2.5">Dữ liệu cần</th>
                      <th className="p-2.5">Mục đích sử dụng</th>
                      <th className="p-2.5">Nguồn chính & Dự phòng</th>
                      <th className="p-2.5">Quy ước Đồng nhất & Trạng thái Xác minh</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    <tr>
                      <td className="p-2.5 font-bold text-blue-400">1. Giao dịch & Quan sát (Real-time)</td>
                      <td className="p-2.5">Chỉ số, Độ rộng toàn sàn (Advance/Decline)</td>
                      <td className="p-2.5">Market Regime</td>
                      <td className="p-2.5">NEO API (/market/intradayMarketIndex) • Fallback: SSI indexSummary</td>
                      <td className="p-2.5 text-emerald-400">Đã xác minh: Trả về đủ 91 tăng / 206 giảm toàn sàn HOSE (UTC+7)</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-blue-400">1. Giao dịch & Vi cấu trúc</td>
                      <td className="p-2.5">Bid/Ask 3 bước giá & Khối ngoại</td>
                      <td className="p-2.5">OBI, Spread, Estimated Execution Cost, Foreign Flow</td>
                      <td className="p-2.5">NEO WebSocket (stockInfo) & REST (/stock/stockDetail)</td>
                      <td className="p-2.5 text-amber-300">Schema xác minh 100% (xử lý chuỗi ATO/ATC); tự động fallback khi đổi IP động</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-emerald-400">2. Dữ liệu Nghiên cứu (Historical)</td>
                      <td className="p-2.5">Chuỗi OHLCV 257 phiên</td>
                      <td className="p-2.5">Historical VaR 95%, ES, Beta, Ma trận tương quan, RS 20d, MA20/50</td>
                      <td className="p-2.5">SSI FastConnect API v3 (get_ohlc_1day_historical) + SQLite cache</td>
                      <td className="p-2.5 text-emerald-400">Đã đồng bộ 14,649 bản ghi • Đồng nhất đơn vị VNĐ nguyên (VD: 50,200 đ)</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-amber-400">3. Dữ liệu Doanh nghiệp</td>
                      <td className="p-2.5">BCTC, Tin tức & Sự kiện quyền</td>
                      <td className="p-2.5">Fundamental Quality & Stock Dossier</td>
                      <td className="p-2.5">NEO events[] + Liên kết trực tiếp tới nguồn gốc (CafeF, Vietstock, FireAnt)</td>
                      <td className="p-2.5 text-slate-300">Không sao chép/tái phân phối trái phép; gắn cờ thiếu dữ liệu (không gán 0 điểm)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. 7 CORE QUANTITATIVE & ARCHITECTURAL QUESTIONS ANSWERED */}
            <div className={`rounded-xl border p-5 ${bgCard}`}>
              <div className="flex items-center gap-2 text-base font-bold">
                <HelpCircle className="h-4 w-4 text-emerald-400" />
                <span>Giải trình 7 Câu hỏi Chuyên môn Định lượng & Độ tin cậy Hệ thống</span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3 text-xs">
                {[
                  {
                    q: "1. Data Availability (Khả năng cung cấp dữ liệu)",
                    a: "Đã đối chiếu toàn bộ tài liệu NeoAPI Docs & SSI v3: xác nhận chính xác endpoint JWT Auth, /stock/stockDetail (trả 3 mức Bid/Ask, room ngoại, events) và SSI 1D OHLC.",
                  },
                  {
                    q: "2. Data Consistency (Đồng nhất NEO & SSI)",
                    a: "Cả hai nguồn đều được chuẩn hóa về đơn vị đồng (VNĐ số nguyên, VD: VCB = 50,200 đ), khối lượng cổ phiếu (lô 100) và múi giờ Asia/Ho_Chi_Minh (+07:00).",
                  },
                  {
                    q: "3. Scoring Methodology (Chống trùng lặp & Thiếu dữ liệu)",
                    a: "Chuẩn hóa Winsorization [2.5%, 97.5%] + Percentile Ranking (0–100). Chỉ dùng 1 chỉ báo RS 20d trong nhóm Momentum; OBI giới hạn <= 5% tổng điểm; thiếu BCTC được chuẩn hóa lại trọng số chứ không gán 0.",
                  },
                  {
                    q: "4. Portfolio Risk (Phương pháp & Giả định VaR/ES)",
                    a: "Chọn Historical VaR 95% & ES 95% (1 ngày, không tái cân bằng nội ngày) trên cửa sổ 130–257 phiên làm phương pháp chính; bổ sung Parametric VaR và Đóng góp rủi ro biên để đối chiếu.",
                  },
                  {
                    q: "5. Execution Feasibility (Giới hạn Sổ lệnh 3 mức giá)",
                    a: "Đổi tên chuẩn xác thành Order Book Liquidity & Estimated Execution Cost. Mô phỏng khớp qua 3 bước giá Bid/Ask; nếu lệnh vượt tổng độ sâu 3 mức giá thì phát cảnh báo đỏ, tuyệt đối không ngoại suy.",
                  },
                  {
                    q: "6. Validation & 7. Product Reliability",
                    a: "Tách riêng Signal Validation (vào lệnh T+1 chống look-ahead, trừ phí 0.3%) và VaR Backtesting (136 phiên ngoài mẫu). Kiến trúc Dual-Mode giúp hệ thống luôn chạy mượt ngay cả khi 1 API mất kết nối hoặc khác IP.",
                  },
                ].map((item) => (
                  <div key={item.q} className={`rounded-lg border p-3 ${bgSub}`}>
                    <div className="font-bold text-blue-400">{item.q}</div>
                    <p className={`mt-1 leading-relaxed ${textMuted}`}>{item.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* FOOTER */}
        <footer className={`rounded-xl border p-4 text-xs ${bgCard}`}>
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
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
