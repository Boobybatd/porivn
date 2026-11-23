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
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Upload,
} from "lucide-react";
import type { DiscoveryStock, PortfolioHealth, SnapshotBundle, WhatIfResult } from "@/types/radar";

type TabId = "regime" | "discovery" | "portfolio" | "orderbook" | "validation";

// Live backend only when explicitly configured (Vercel env) or when running locally.
const resolveApiBase = (): string => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "http://127.0.0.1:8000";
  }
  return "";
};
const API_BASE = resolveApiBase();

const fmtVnd = (n: number) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n) + " đ";

const fmtBillion = (n: number) => (n / 1e9).toFixed(1) + " tỷ";

const regimeBadgeClass = (regime: string) => {
  switch (regime) {
    case "Positive":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    case "Neutral":
      return "bg-sky-500/15 text-sky-300 border-sky-500/40";
    case "Defensive":
      return "bg-amber-500/15 text-amber-300 border-amber-500/40";
    default:
      return "bg-rose-500/15 text-rose-300 border-rose-500/40";
  }
};

export default function HomePage() {
  const [bundle, setBundle] = useState<SnapshotBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("regime");
  const [backendOnline, setBackendOnline] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Discovery filters & selected stock dossier
  const [sectorFilter, setSectorFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [minScore, setMinScore] = useState<number>(0);
  const [selectedStock, setSelectedStock] = useState<DiscoveryStock | null>(null);

  // Portfolio & What-If state
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [cashVnd, setCashVnd] = useState<number>(100_000_000);
  const [liveHealth, setLiveHealth] = useState<PortfolioHealth | null>(null);
  const [whatIfSymbol, setWhatIfSymbol] = useState<string>("VND");
  const [whatIfAmount, setWhatIfAmount] = useState<number>(50_000_000);
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const [newPosSym, setNewPosSym] = useState<string>("ACB");
  const [newPosAmt, setNewPosAmt] = useState<number>(100_000_000);
  const [portfolioMsg, setPortfolioMsg] = useState<string | null>(null);

  // Orderbook Execution Cost state
  const [obSymbol, setObSymbol] = useState<string>("HPG");
  const [obAmount, setObAmount] = useState<number>(200_000_000);
  const [obSide, setObSide] = useState<"buy" | "sell">("buy");
  const [obResult, setObResult] = useState<Record<string, unknown> | null>(null);
  const [obError, setObError] = useState<string | null>(null);

  const fetchLatestBundle = async () => {
    setRefreshing(true);
    try {
      let loaded: SnapshotBundle | null = null;
      try {
        if (!API_BASE) throw new Error("No live backend configured");
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1800);
        const liveRes = await fetch(`${API_BASE}/api/dashboard`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (liveRes.ok) {
          loaded = await liveRes.json();
          setBackendOnline(true);
        }
      } catch {
        setBackendOnline(false);
      }

      if (!loaded) {
        const snapRes = await fetch(`/data/snapshot.json?t=${Date.now()}`);
        if (!snapRes.ok) throw new Error("Không tìm thấy dữ liệu snapshot.json");
        loaded = await snapRes.json();
      }

      if (loaded) {
        setBundle(loaded);
        setLiveHealth(loaded.default_portfolio.health);
        if (!selectedStock && loaded.discovery.length > 0) {
          setPositions(loaded.default_portfolio.positions);
          setCashVnd(loaded.default_portfolio.cash_vnd);
          setSelectedStock(loaded.discovery[0]);
          setWhatIfSymbol(loaded.discovery[0].symbol);
          const pre = loaded.default_portfolio.what_if_50m[loaded.discovery[0].symbol];
          if (pre) setWhatIfResult(pre);
        }
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
    const id = setInterval(() => {
      fetchLatestBundle();
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const sectors = useMemo(() => {
    if (!bundle) return ["ALL"];
    const unique = Array.from(new Set(bundle.discovery.map((d) => d.sector))).sort();
    return ["ALL", ...unique];
  }, [bundle]);

  const filteredDiscovery = useMemo(() => {
    if (!bundle) return [];
    return bundle.discovery.filter((item) => {
      if (sectorFilter !== "ALL" && item.sector !== sectorFilter) return false;
      if (searchQuery && !item.symbol.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if ((item.alpha_score ?? 0) < minScore) return false;
      return true;
    });
  }, [bundle, sectorFilter, searchQuery, minScore]);

  const bestFitEntry = useMemo(() => {
    if (!bundle) return null;
    const entries = Object.values(bundle.default_portfolio.what_if_50m || {});
    if (entries.length === 0) return null;
    return entries.sort((a, b) => b.portfolio_fit_score - a.portfolio_fit_score)[0];
  }, [bundle]);

  const exportDiscoveryCsv = () => {
    const header = ["Symbol", "Sector", "ClosePrice", "RS_20D_Pct", "ADV_20D_VND", "AlphaScore", "DataFlag"];
    const rows = filteredDiscovery.map((r) => [
      r.symbol,
      r.sector,
      r.close_price,
      (r.rs_20d * 100).toFixed(2),
      r.adv_20_val,
      r.alpha_score ?? "",
      `"${r.data_flag}"`,
    ]);
    const csv = [header.join(","), ...rows.map((x) => x.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pori_discovery_${bundle?.latest_trading_date || "latest"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const recalculatePortfolioHealth = async (nextPos: Record<string, number>, nextCash: number) => {
    setPositions(nextPos);
    setCashVnd(nextCash);
    setPortfolioMsg(null);
    if (!backendOnline) {
      setPortfolioMsg("Đã cập nhật danh mục trên giao diện. Bật FastAPI Backend để tính lại VaR/HHI động cho danh mục tùy chỉnh.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/portfolio/health`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: nextPos, cash_vnd: nextCash }),
      });
      if (res.ok) {
        setLiveHealth(await res.json());
        setPortfolioMsg("Đã tính lại Health Score & Historical VaR cho danh mục mới.");
      } else {
        const err = await res.json();
        setPortfolioMsg(err.detail || "Không tính lại được danh mục.");
      }
    } catch {
      setPortfolioMsg("Lỗi kết nối FastAPI Backend.");
    }
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
        recalculatePortfolioHealth(nextPos, cashVnd);
      } else {
        setPortfolioMsg("File CSV cần định dạng: symbol,value_vnd (ví dụ: VCB,150000000).");
      }
    };
    reader.readAsText(file);
  };

  const runWhatIf = async (sym: string, amount: number) => {
    setWhatIfSymbol(sym);
    setWhatIfAmount(amount);
    setActiveTab("portfolio");

    if (!bundle) return;
    if (backendOnline) {
      setWhatIfLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/portfolio/what-if`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            positions,
            cash_vnd: cashVnd,
            candidate_symbol: sym,
            add_amount_vnd: amount,
          }),
        });
        if (res.ok) {
          setWhatIfResult(await res.json());
          setWhatIfLoading(false);
          return;
        }
      } catch {
        // Fallback to snapshot
      }
      setWhatIfLoading(false);
    }

    const pre = bundle.default_portfolio.what_if_50m[sym];
    if (pre) {
      setWhatIfResult(pre);
    } else {
      setWhatIfResult(null);
    }
  };

  const checkOrderBook = async () => {
    setObError(null);
    setObResult(null);
    if (!backendOnline) {
      setObError(
        "Chức năng Sổ lệnh 3 bước giá cần kết nối FastAPI Backend đang chạy dữ liệu NEO API (WebSocket/REST). Hiện trang đang chạy ở Snapshot Mode."
      );
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/orderbook/execution-cost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: obSymbol,
          order_value_vnd: obAmount,
          side: obSide,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setObError(data.detail || "Chưa có dữ liệu sổ lệnh NEO API cho mã này.");
      } else {
        setObResult(data);
      }
    } catch {
      setObError("Không kết nối được FastAPI Backend.");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060b14] text-slate-300">
        <div className="flex items-center gap-3 text-sm">
          <RefreshCw className="h-5 w-5 animate-spin text-emerald-400" />
          Đang tải hệ thống VN Alpha Radar & Portfolio Cockpit...
        </div>
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060b14] p-6 text-rose-300">
        <div className="max-w-md rounded-xl border border-rose-500/30 bg-rose-950/20 p-6">
          <h2 className="mb-2 text-lg font-semibold">Lỗi khởi tạo dữ liệu</h2>
          <p className="text-sm text-rose-200/80">{error || "Không có dữ liệu hiển thị."}</p>
        </div>
      </div>
    );
  }

  const regime = bundle.market_regime;
  const health = liveHealth || bundle.default_portfolio.health;

  return (
    <div className="min-h-screen bg-[#060b14] text-slate-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#080f1d]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                <Compass className="h-4 w-4" />
              </span>
              <h1 className="text-lg font-bold tracking-tight text-white">
                Pori <span className="font-normal text-slate-400">• Portfolio & Risk Cockpit</span>
              </h1>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Đối tượng: Nhà đầu tư cá nhân • Dữ liệu cốt lõi: VPBankS NEO API & SSI FastConnect v3
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${
                backendOnline
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  backendOnline ? "bg-emerald-400 animate-pulse" : "bg-sky-400"
                }`}
              />
              {backendOnline ? "Live FastAPI Mode" : "Snapshot Mode (Reproducible)"}
            </span>

            <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
              Phiên: <strong className="text-white">{bundle.latest_trading_date}</strong> ({bundle.sessions_count} phiên)
            </span>

            <span className={`rounded-full border px-3 py-1 font-semibold ${regimeBadgeClass(regime.regime)}`}>
              Regime: {regime.regime}
            </span>

            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`rounded-full border px-3 py-1 font-medium transition ${
                autoRefresh
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}
              title="Tự động cập nhật mỗi 60 giây"
            >
              Auto-Refresh: {autoRefresh ? "BẬT (60s)" : "TẮT"}
            </button>

            <button
              onClick={fetchLatestBundle}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              Cập nhật
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
          {[
            { id: "regime", label: "1. Nhịp Thị Trường", icon: Activity },
            { id: "discovery", label: "2. Tầm Soát & Hồ Sơ Mã", icon: Search },
            { id: "portfolio", label: "3. Khám Danh Mục & What-If", icon: ShieldCheck },
            { id: "orderbook", label: "4. Sổ Lệnh & Chi Phí Khớp", icon: Layers },
            { id: "validation", label: "5. Kiểm Chứng Mô Hình", icon: BarChart3 },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabId)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                  active
                    ? "border-emerald-400 text-emerald-300"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* TAB 1: MARKET REGIME */}
        {activeTab === "regime" && (
          <div className="space-y-6">
            {/* 30-Second Executive Brief */}
            <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/30 via-[#0d1526] to-sky-950/30 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Pori • Tóm tắt hành động 30 giây ({bundle.latest_trading_date})
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-3">
                  <div className="text-xs text-slate-400">1. Bối cảnh thị trường</div>
                  <div className="mt-1 font-semibold text-white">
                    {regime.regime} ({regime.positive_pillars}/3 trụ cột tích cực)
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-3">
                  <div className="text-xs text-slate-400">2. Top 3 Alpha Score nổi bật</div>
                  <div className="mt-1 font-semibold text-emerald-300">
                    {bundle.discovery
                      .slice(0, 3)
                      .map((d) => `${d.symbol} (${d.alpha_score})`)
                      .join(" • ")}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-3">
                  <div className="text-xs text-slate-400">3. Best Portfolio Fit (Thêm 50tr)</div>
                  <div className="mt-1 font-semibold text-sky-300">
                    {bestFitEntry
                      ? `${bestFitEntry.candidate_symbol} (Fit ${bestFitEntry.portfolio_fit_score}/100, ΔVaR ${fmtVnd(bestFitEntry.delta_var_vnd)})`
                      : "Xem ở Tab Khám Danh Mục"}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span className="text-xs uppercase tracking-wider text-slate-400">
                    Đánh giá Bối cảnh Thị trường ({bundle.breadth_scope})
                  </span>
                  <h2 className="mt-1 flex items-center gap-3 text-2xl font-bold text-white">
                    Trạng thái:{" "}
                    <span className={`rounded-lg border px-3 py-0.5 text-lg ${regimeBadgeClass(regime.regime)}`}>
                      {regime.regime}
                    </span>
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-slate-300">{regime.summary}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-3 text-right">
                  <div className="text-xs text-slate-400">Đồng thuận 3 trụ cột</div>
                  <div className="text-2xl font-bold text-white">{regime.positive_pillars} / 3 tích cực</div>
                  <div className="text-xs text-slate-400">Điểm đồng thuận: {regime.consensus_score}</div>
                </div>
              </div>
            </div>

            {/* 4 KPI Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                <div className="text-xs text-slate-400">VNINDEX Hiện tại</div>
                <div className="mt-1 text-2xl font-bold text-white">{regime.vnindex_close.toLocaleString()}</div>
                <div className="mt-1 text-xs text-slate-400">
                  MA20: {regime.ma20} • MA50: {regime.ma50}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                <div className="text-xs text-slate-400">Độ rộng (A/D Ratio)</div>
                <div className="mt-1 text-2xl font-bold text-white">{regime.ad_ratio.toFixed(2)}</div>
                <div className="mt-1 text-xs text-slate-400">
                  Mã trên MA20: {(regime.pct_above_ma20 * 100).toFixed(1)}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                <div className="text-xs text-slate-400">Nhịp Thanh khoản (Vol Pace)</div>
                <div className="mt-1 text-2xl font-bold text-white">{regime.volume_pace.toFixed(2)}x</div>
                <div className="mt-1 text-xs text-slate-400">So với TB 20 phiên gần nhất</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                <div className="text-xs text-slate-400">Sức khỏe Danh mục mẫu</div>
                <div className="mt-1 text-2xl font-bold text-emerald-400">{health.health_score} / 100</div>
                <div className="mt-1 text-xs text-slate-400">VaR 95% (1d): {fmtVnd(health.hist_var_95_vnd)}</div>
              </div>
            </div>

            {/* 3 Pillars Detail */}
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { title: "Trụ cột 1: Xu hướng (Trend)", desc: regime.trend_status, icon: TrendingUp },
                { title: "Trụ cột 2: Độ lan tỏa (Breadth)", desc: regime.breadth_status, icon: Activity },
                { title: "Trụ cột 3: Dòng tiền & Ngoại", desc: regime.liquidity_status, icon: BarChart3 },
              ].map((p) => {
                const Icon = p.icon;
                return (
                  <div key={p.title} className="rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <Icon className="h-4 w-4 text-emerald-400" />
                      {p.title}
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{p.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: SMART DISCOVERY & STOCK DOSSIER */}
        {activeTab === "discovery" && (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left: Table */}
            <div className="space-y-4 lg:col-span-7">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                <input
                  type="text"
                  placeholder="Tìm mã (VD: FPT, STB)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <select
                  value={sectorFilter}
                  onChange={(e) => setSectorFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  {sectors.map((s) => (
                    <option key={s} value={s}>
                      {s === "ALL" ? "Tất cả ngành" : s}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <span>Điểm tối thiểu: {minScore}</span>
                  <input
                    type="range"
                    min={0}
                    max={85}
                    step={5}
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value))}
                  />
                </div>
                <button
                  onClick={exportDiscoveryCsv}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-emerald-500/50"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-400" />
                  Xuất CSV
                </button>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0d1526]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-800 bg-slate-900/70 text-xs uppercase text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Mã</th>
                        <th className="px-3 py-3">Ngành</th>
                        <th className="px-3 py-3 text-right">Giá</th>
                        <th className="px-3 py-3 text-right">RS 20d</th>
                        <th className="px-3 py-3 text-right">GTGD TB</th>
                        <th className="px-4 py-3 text-right">Alpha Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {filteredDiscovery.slice(0, 20).map((item) => {
                        const isSel = selectedStock?.symbol === item.symbol;
                        return (
                          <tr
                            key={item.symbol}
                            onClick={() => setSelectedStock(item)}
                            className={`cursor-pointer transition ${
                              isSel ? "bg-emerald-500/10" : "hover:bg-slate-800/40"
                            }`}
                          >
                            <td className="px-4 py-2.5 font-semibold text-white">{item.symbol}</td>
                            <td className="px-3 py-2.5 text-xs text-slate-400">{item.sector}</td>
                            <td className="px-3 py-2.5 text-right text-slate-200">
                              {item.close_price.toLocaleString()}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-medium ${
                                item.rs_20d >= 0 ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {(item.rs_20d * 100).toFixed(1)}%
                            </td>
                            <td className="px-3 py-2.5 text-right text-xs text-slate-300">
                              {fmtBillion(item.adv_20_val)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-300">
                                {item.alpha_score ?? "N/A"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right: Stock Dossier ("Why This Stock?") */}
            <div className="lg:col-span-5">
              {selectedStock ? (
                <div className="sticky top-28 space-y-4 rounded-xl border border-slate-800 bg-[#0d1526] p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs text-slate-400">Hồ sơ 360° & Giải thích</span>
                      <h3 className="text-2xl font-bold text-white">
                        {selectedStock.symbol}{" "}
                        <span className="text-sm font-normal text-slate-400">({selectedStock.sector})</span>
                      </h3>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">Alpha Score</div>
                      <div className="text-2xl font-bold text-emerald-400">
                        {selectedStock.alpha_score ?? "N/A"} / 100
                      </div>
                    </div>
                  </div>

                  {/* Component breakdown */}
                  <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-3.5 text-xs">
                    <div className="font-semibold text-slate-200">Phân rã 4 cấu phần (Đủ dữ liệu: {Math.round(selectedStock.data_completeness * 100)}%)</div>
                    {[
                      { label: "Trend & Momentum", val: selectedStock.trend_score },
                      { label: "Liquidity & Quality", val: selectedStock.liquidity_score },
                      { label: "Foreign Flow (NEO)", val: selectedStock.foreign_score },
                      { label: "Fundamental Quality", val: selectedStock.fundamental_score },
                    ].map((c) => (
                      <div key={c.label}>
                        <div className="mb-1 flex justify-between text-slate-300">
                          <span>{c.label}</span>
                          <span>{c.val !== null ? `${c.val}/100` : "Chưa có dữ liệu"}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full bg-emerald-400"
                            style={{ width: `${c.val ?? 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="pt-1 text-[11px] text-amber-300/90">Cờ dữ liệu: {selectedStock.data_flag}</div>
                  </div>

                  {/* Why this stock */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Vì sao cổ phiếu này xuất hiện?
                    </div>
                    <ul className="space-y-1 text-sm text-slate-200">
                      {selectedStock.reasons.map((r, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Direct Research Links */}
                  <div className="space-y-2 border-t border-slate-800 pt-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                      <BookOpen className="h-3.5 w-3.5 text-sky-400" />
                      Tài liệu & Tin tức chính thống ({selectedStock.symbol})
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {[
                        {
                          name: "CafeF Hồ sơ & BCTC",
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
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-sky-300 hover:border-sky-500/50"
                        >
                          {lnk.name}
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => runWhatIf(selectedStock.symbol, whatIfAmount)}
                    className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                  >
                    Thử thêm {selectedStock.symbol} vào Danh mục (What-If) →
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* TAB 3: PORTFOLIO HEALTH & WHAT-IF */}
        {activeTab === "portfolio" && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                <div className="text-xs text-slate-400">Tổng NAV & Tiền mặt</div>
                <div className="mt-1 text-xl font-bold text-white">{fmtVnd(health.total_nav_vnd)}</div>
                <div className="mt-1 text-xs text-slate-400">
                  Tiền mặt: {fmtVnd(health.cash_vnd)} ({(health.cash_weight * 100).toFixed(1)}%)
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                <div className="text-xs text-slate-400">Tập trung (HHI Cổ phiếu / Ngành)</div>
                <div className="mt-1 text-xl font-bold text-white">
                  {health.hhi_stock.toFixed(3)} / {health.hhi_sector.toFixed(3)}
                </div>
                <div className="mt-1 text-xs text-slate-400">N hiệu dụng: {health.n_effective_stock} mã</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                <div className="text-xs text-slate-400">Historical VaR 95% & ES 95% (1d)</div>
                <div className="mt-1 text-xl font-bold text-rose-400">{fmtVnd(health.hist_var_95_vnd)}</div>
                <div className="mt-1 text-xs text-slate-400">
                  ({(health.hist_var_95_pct * 100).toFixed(2)}%) • ES: {fmtVnd(health.hist_es_95_vnd)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-4">
                <div className="text-xs text-slate-400">Beta Danh mục & Health Score</div>
                <div className="mt-1 text-xl font-bold text-emerald-400">
                  β = {health.portfolio_beta} • {health.health_score}/100
                </div>
                <div className="mt-1 text-xs text-slate-400">Vol năm: {(health.annualized_vol_pct * 100).toFixed(1)}%</div>
              </div>
            </div>

            {/* Custom Portfolio Editor & CSV Upload */}
            <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Danh mục Đang nắm giữ (Tùy chỉnh / Upload CSV)</h3>
                  <p className="text-xs text-slate-400">
                    Thêm/xóa mã hoặc tải file CSV định dạng <code className="text-slate-300">symbol,value_vnd</code> để khám danh mục của chính bạn.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500/50">
                  <Upload className="h-3.5 w-3.5 text-sky-400" />
                  Tải lên CSV
                  <input type="file" accept=".csv,.txt" onChange={handleCsvUpload} className="hidden" />
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(positions).map(([sym, val]) => (
                  <div
                    key={sym}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs"
                  >
                    <span className="font-bold text-white">{sym}</span>
                    <span className="text-slate-300">{fmtVnd(val)}</span>
                    <button
                      onClick={() => {
                        const copy = { ...positions };
                        delete copy[sym];
                        if (Object.keys(copy).length > 0) recalculatePortfolioHealth(copy, cashVnd);
                      }}
                      className="text-slate-500 hover:text-rose-400"
                      title="Xóa mã"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <input
                  type="text"
                  placeholder="Mã (VD: ACB)"
                  value={newPosSym}
                  onChange={(e) => setNewPosSym(e.target.value.toUpperCase())}
                  className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
                />
                <input
                  type="number"
                  step={10_000_000}
                  value={newPosAmt}
                  onChange={(e) => setNewPosAmt(Number(e.target.value))}
                  className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
                />
                <button
                  onClick={() => {
                    if (!newPosSym || newPosAmt <= 0) return;
                    recalculatePortfolioHealth({ ...positions, [newPosSym]: newPosAmt }, cashVnd);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Thêm / Cập nhật mã
                </button>
              </div>
              {portfolioMsg && <p className="mt-2 text-xs text-amber-300">{portfolioMsg}</p>}
            </div>

            {/* Warnings */}
            {health.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                  <AlertTriangle className="h-4 w-4" />
                  Cảnh báo cấu trúc rủi ro danh mục
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100/90">
                  {health.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* What-If Simulator */}
            <div className="rounded-xl border border-emerald-500/30 bg-[#0d1526] p-5">
              <h3 className="text-base font-bold text-white">
                Mô phỏng Tác động Danh mục (What-If Portfolio Fit)
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Kiểm tra xem việc bổ sung thêm tiền vào một cổ phiếu mới làm thay đổi VaR và độ tập trung (HHI) ra sao.
              </p>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Mã dự kiến mua thêm</label>
                  <select
                    value={whatIfSymbol}
                    onChange={(e) => setWhatIfSymbol(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    {bundle.discovery.map((d) => (
                      <option key={d.symbol} value={d.symbol}>
                        {d.symbol} ({d.sector})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Số tiền bổ sung (VND)</label>
                  <input
                    type="number"
                    step={10_000_000}
                    value={whatIfAmount}
                    onChange={(e) => setWhatIfAmount(Number(e.target.value))}
                    className="w-48 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <button
                  onClick={() => runWhatIf(whatIfSymbol, whatIfAmount)}
                  disabled={whatIfLoading}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {whatIfLoading ? "Đang tính..." : "Tính tác động Trước/Sau"}
                </button>
              </div>

              {whatIfResult ? (
                <div className="mt-5 grid gap-4 md:grid-cols-4">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                    <div className="text-xs text-slate-400">Portfolio Fit Score</div>
                    <div className="mt-1 text-2xl font-bold text-emerald-400">
                      {whatIfResult.portfolio_fit_score} / 100
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                    <div className="text-xs text-slate-400">Thay đổi VaR 95% (ΔVaR)</div>
                    <div
                      className={`mt-1 text-lg font-bold ${
                        whatIfResult.delta_var_vnd <= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {whatIfResult.delta_var_vnd >= 0 ? "+" : ""}
                      {fmtVnd(whatIfResult.delta_var_vnd)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {fmtVnd(whatIfResult.var_95_before_vnd)} → {fmtVnd(whatIfResult.var_95_after_vnd)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                    <div className="text-xs text-slate-400">Thay đổi HHI (ΔHHI)</div>
                    <div className="mt-1 text-lg font-bold text-white">
                      {whatIfResult.hhi_stock_before.toFixed(3)} → {whatIfResult.hhi_stock_after.toFixed(3)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Tương quan TB: {whatIfResult.avg_corr_with_portfolio}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
                    <div className="mb-1 font-semibold text-white">Giải thích:</div>
                    {whatIfResult.explanation}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-amber-300">
                  Trong Snapshot Mode chỉ lưu sẵn kết quả What-If (50 triệu) cho Top 10 mã. Chạy FastAPI Backend để mô phỏng bất kỳ mã và số tiền nào.
                </p>
              )}
            </div>

            {/* Sector Allocation & Correlation & Stress Test */}
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-5">
                <h3 className="mb-3 text-sm font-semibold text-white">Phân bổ Ngành & Ngày thoát hàng (DTL @10% ADV)</h3>
                <div className="space-y-2.5">
                  {Object.entries(health.sector_weights).map(([sec, w]) => (
                    <div key={sec} className="text-xs">
                      <div className="mb-1 flex justify-between text-slate-300">
                        <span>{sec}</span>
                        <span>{(w * 100).toFixed(1)}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-sky-400" style={{ width: `${w * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 border-t border-slate-800 pt-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase text-slate-400">Stress-Test Kịch bản Thị trường</h4>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    {Object.entries(health.stress_tests).map(([scen, loss]) => (
                      <div key={scen} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                        <div className="text-slate-400">{scen}</div>
                        <div className="mt-1 font-bold text-rose-400">{fmtVnd(loss)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-5">
                <h3 className="mb-3 text-sm font-semibold text-white">Ma trận Tương quan Lợi suất (120–250 phiên)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-center text-xs">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="p-2 text-left">Mã</th>
                        {Object.keys(health.correlation_matrix).map((c) => (
                          <th key={c} className="p-2">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(health.correlation_matrix).map(([rowSym, cols]) => (
                        <tr key={rowSym} className="border-t border-slate-800/70">
                          <td className="p-2 text-left font-semibold text-white">{rowSym}</td>
                          {Object.entries(cols).map(([colSym, val]) => (
                            <td
                              key={colSym}
                              className={`p-2 font-mono ${
                                val >= 0.7 && rowSym !== colSym
                                  ? "text-rose-300"
                                  : val < 0.35
                                  ? "text-emerald-300"
                                  : "text-slate-300"
                              }`}
                            >
                              {val.toFixed(2)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: ORDER BOOK LIQUIDITY & EXECUTION COST */}
        {activeTab === "orderbook" && (
          <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-6">
            <h2 className="text-lg font-bold text-white">
              Order Book Liquidity & Estimated Execution Cost (NEO API 3-Level Bid/Ask)
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Đo mất cân bằng sổ lệnh 3 mức giá (OBI), Spread % và ước lượng giá khớp bình quân theo quy mô lệnh giả định (không ngoại suy vượt quá độ sâu 3 bước giá).
            </p>

            <div className="mt-5 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Mã cổ phiếu</label>
                <input
                  type="text"
                  value={obSymbol}
                  onChange={(e) => setObSymbol(e.target.value.toUpperCase())}
                  className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Chiều lệnh</label>
                <select
                  value={obSide}
                  onChange={(e) => setObSide(e.target.value as "buy" | "sell")}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                >
                  <option value="buy">Mua (Quét Ask 1→3)</option>
                  <option value="sell">Bán (Quét Bid 1→3)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Quy mô lệnh giả định (VND)</label>
                <input
                  type="number"
                  step={50_000_000}
                  value={obAmount}
                  onChange={(e) => setObAmount(Number(e.target.value))}
                  className="w-48 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </div>
              <button
                onClick={checkOrderBook}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Ước lượng Chi phí Khớp lệnh
              </button>
            </div>

            {obError && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">
                {obError}
              </div>
            )}

            {obResult && (
              <pre className="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-emerald-300">
                {JSON.stringify(obResult, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* TAB 5: VALIDATION HUB */}
        {activeTab === "validation" && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Signal Validation */}
            <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-5">
              <h3 className="text-base font-bold text-white">1. Signal Validation (Hiệu suất Bộ lọc Alpha Score)</h3>
              <p className="mt-1 text-xs text-slate-400">
                Kiểm chứng ngoài mẫu không nhìn trước dữ liệu tương lai (vào lệnh tại phiên T+1, đã trừ 0.30% phí/thuế giả định, so với VNINDEX).
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-800 text-xs text-slate-400">
                    <tr>
                      <th className="py-2">Kỳ hạn</th>
                      <th className="py-2 text-right">Số mẫu</th>
                      <th className="py-2 text-right">Excess Return TB</th>
                      <th className="py-2 text-right">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {bundle.validation.signal_validation.map((row) => (
                      <tr key={row.horizon_days}>
                        <td className="py-2.5 font-semibold text-white">T+{row.horizon_days}</td>
                        <td className="py-2.5 text-right text-slate-300">{row.sample_count}</td>
                        <td
                          className={`py-2.5 text-right font-semibold ${
                            row.avg_excess_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {row.avg_excess_return_pct >= 0 ? "+" : ""}
                          {row.avg_excess_return_pct}%
                        </td>
                        <td className="py-2.5 text-right text-slate-200">{row.win_rate_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                * Ghi chú trung thực: Kết quả trên đo bộ lọc động lượng thuần chưa bật bộ lọc Market Regime. Khi thị trường chung suy yếu, tín hiệu mua thuần động lượng thường âm — đó là lý do hệ thống cần Regime-Gating ở Tab 1.
              </p>
            </div>

            {/* Risk Model Validation */}
            <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-5">
              <h3 className="text-base font-bold text-white">2. Risk Model Validation (Backtesting Historical VaR 95%)</h3>
              <p className="mt-1 text-xs text-slate-400">
                Kiểm định trượt (Rolling Out-of-Sample) so sánh mức lỗ thực tế của danh mục mẫu với ngưỡng VaR dự báo ngày hôm trước.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="text-xs text-slate-400">Cửa sổ ước lượng / Số phiên test</div>
                  <div className="mt-1 font-bold text-white">
                    {bundle.validation.risk_model_validation.window_days} /{" "}
                    {bundle.validation.risk_model_validation.test_days} phiên
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <div className="text-xs text-slate-400">Số ngày vượt ngưỡng VaR</div>
                  <div className="mt-1 font-bold text-white">
                    {bundle.validation.risk_model_validation.exceptions} ngày (
                    {(bundle.validation.risk_model_validation.exception_rate * 100).toFixed(2)}%)
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3.5 text-sm text-emerald-200">
                <strong>Kết luận kiểm định:</strong> {bundle.validation.risk_model_validation.status} (Kỳ vọng lý thuyết:{" "}
                {(bundle.validation.risk_model_validation.expected_rate * 100).toFixed(1)}%).
              </div>
            </div>
          </div>
        )}

        {/* Footer Disclaimer & Methodology */}
        <footer className="rounded-xl border border-slate-800/80 bg-[#080f1d] p-4 text-xs text-slate-400">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>
              <strong className="text-slate-200">Phương pháp, Giới hạn & Tuyên bố Miễn trừ:</strong>{" "}
              {bundle.disclaimer} Dữ liệu cập nhật lúc {bundle.generated_at} (UTC+7). Mô hình Historical VaR dùng cửa sổ 257 phiên; Estimated Execution Cost chỉ phản ánh 3 mức giá Bid/Ask tại thời điểm ghi nhận và không ngoại suy vượt độ sâu sổ lệnh.
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
