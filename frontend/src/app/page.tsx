"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Download,
  HelpCircle,
  History,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  ShieldAlert,
  Trash2,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type {
  DiscoveryStock,
  PortfolioHealth,
  SnapshotBundle,
  VnindexPoint,
  WhatIfResult,
} from "@/types/radar";
import {
  computeCapitalAllocationAdvice,
  computeClientPortfolioHealth,
  computeClientWhatIf,
  evaluateClientOrderBook,
  vnSectorName,
} from "@/lib/quant";
import {
  fetchLiveSnapshotFromSupabase,
  isSupabaseConfigured,
  loadCloudWorkspace,
  saveCloudWorkspace,
  supabase,
  type SimulationHistoryItem,
} from "@/lib/supabase";

const LOCAL_WORKSPACE_KEY = "pori_guest_workspace_v1";

type TabId = "regime" | "discovery" | "portfolio" | "orderbook" | "validation" | "guide";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Be Vietnam Pro', sans-serif";

const REGIME_VN_MAP: Record<string, string> = {
  Positive: "Tích cực (Thuận lợi)",
  Neutral: "Trung tính (Phân hóa)",
  Defensive: "Phòng thủ (Thận trọng)",
  "High Risk": "Rủi ro cao",
};

const vnRegime = (r: string) => REGIME_VN_MAP[r] || r;

const fmtVnd = (n: number) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(n)) + " đ";

const fmtBillion = (n: number) => (n / 1e9).toFixed(1) + " tỷ";

/* ============================================================================
   SALX POINTER-REACTIVE AMBIENT SPOTLIGHT + COORDINATE GRID
   ============================================================================ */
function CursorAmbientGlow() {
  const glowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const glowEl = glowRef.current;
    const gridEl = gridRef.current;
    if (!glowEl || !gridEl) return;

    let frame = 0;
    let targetX = 50;
    let targetY = 28;
    let currentX = 50;
    let currentY = 28;

    const applyPos = (x: number, y: number) => {
      const mx = `${x.toFixed(2)}%`;
      const my = `${y.toFixed(2)}%`;
      glowEl.style.setProperty("--mx", mx);
      glowEl.style.setProperty("--my", my);
      gridEl.style.setProperty("--mx", mx);
      gridEl.style.setProperty("--my", my);
    };

    const tick = () => {
      frame = 0;
      currentX += (targetX - currentX) * 0.16;
      currentY += (targetY - currentY) * 0.16;
      applyPos(currentX, currentY);
      if (Math.abs(targetX - currentX) > 0.08 || Math.abs(targetY - currentY) > 0.08) {
        frame = requestAnimationFrame(tick);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      targetX = Math.max(0, Math.min(100, (e.clientX / Math.max(1, window.innerWidth)) * 100));
      targetY = Math.max(0, Math.min(100, (e.clientY / Math.max(1, window.innerHeight)) * 100));
      if (!frame) frame = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div ref={gridRef} className="cursor-ambient-grid" aria-hidden="true" />
      <div ref={glowRef} className="cursor-ambient-glow" aria-hidden="true" />
    </>
  );
}

/* ============================================================================
   SALX DASHBOARD KIT BUILDING BLOCKS (StatCard, SectionLabel)
   ============================================================================ */
function SectionLabel({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "var(--mut)",
        }}
      >
        {children}
      </span>
      {right}
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  sub,
  accent,
  danger,
}: {
  label: string;
  value: string | number;
  unit?: string;
  sub?: React.ReactNode;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="salx-card salx-card--interactive" style={{ padding: "16px 18px" }}>
      <span
        style={{
          display: "block",
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: ".13em",
          textTransform: "uppercase",
          color: "var(--mut)",
          marginBottom: 10,
        }}
      >
        {label}
      </span>
      <div>
        <strong
          className="font-mono-num"
          style={{
            fontSize: 23,
            fontWeight: 800,
            color: danger ? "var(--avax)" : accent ? "var(--g)" : "var(--ink)",
            letterSpacing: "-.02em",
          }}
        >
          {value}
        </strong>
        {unit && (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              color: "var(--mut)",
              marginLeft: 6,
            }}
          >
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            color: "var(--mut)",
            marginTop: 6,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   SVG CHART 1: VNINDEX + MA20 + MA50 + VOLUME WITH ZOOM & PAN (KÉO RA / KÉO VÀO)
   ============================================================================ */
function VnindexChart({ data, dark }: { data: VnindexPoint[]; dark: boolean }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [winSize, setWinSize] = useState<number>(data?.length || 90);
  const [startIdx, setStartIdx] = useState<number>(0);
  const dragRef = useRef<{ active: boolean; startX: number; origStart: number }>({
    active: false,
    startX: 0,
    origStart: 0,
  });

  useEffect(() => {
    if (data && data.length > 0) {
      setWinSize(data.length);
      setStartIdx(0);
    }
  }, [data]);

  if (!data || data.length < 5) return null;

  const totalLen = data.length;
  const clampedWin = Math.max(15, Math.min(totalLen, winSize));
  const clampedStart = Math.max(0, Math.min(totalLen - clampedWin, startIdx));
  const slice = data.slice(clampedStart, clampedStart + clampedWin);

  const w = 860;
  const h = 290;
  const padL = 52;
  const padR = 18;
  const padT = 22;
  const padB = 34;

  const allVals = slice.flatMap((d) =>
    [d.close, d.ma20 ?? d.close, d.ma50 ?? d.close].filter((v): v is number => v !== null)
  );
  const minP = Math.min(...allVals) * 0.996;
  const maxP = Math.max(...allVals) * 1.004;
  const maxV = Math.max(...slice.map((d) => d.volume || 1));

  const xAt = (i: number) => padL + (i / Math.max(1, slice.length - 1)) * (w - padL - padR);
  const yAt = (p: number) => padT + (1 - (p - minP) / Math.max(1, maxP - minP)) * (h - padT - padB);

  const linePath = (getter: (d: VnindexPoint) => number | null) => {
    const pts: string[] = [];
    slice.forEach((d, i) => {
      const v = getter(d);
      if (v !== null) {
        pts.push(`${pts.length === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
      }
    });
    return pts.join(" ");
  };

  const closePath = linePath((d) => d.close);
  const areaPath = `${closePath} L${xAt(slice.length - 1).toFixed(1)},${h - padB} L${xAt(0).toFixed(1)},${h - padB} Z`;
  const ma20Path = linePath((d) => d.ma20);
  const ma50Path = linePath((d) => d.ma50);

  const yTicks = [minP, (minP + maxP) / 2, maxP];
  const xIdxs = [0, Math.floor(slice.length / 2), slice.length - 1];

  const activeIdx =
    hoverIdx !== null && hoverIdx < slice.length ? hoverIdx : slice.length - 1;
  const activePt = slice[activeIdx];
  const globalIdx = clampedStart + activeIdx;
  const prevPt = globalIdx > 0 ? data[globalIdx - 1] : activePt;
  const chgPct =
    prevPt && prevPt.close > 0 ? ((activePt.close - prevPt.close) / prevPt.close) * 100 : 0;

  const setPresetWindow = (size: number) => {
    const nw = Math.max(15, Math.min(totalLen, size));
    setWinSize(nw);
    setStartIdx(Math.max(0, totalLen - nw));
    setHoverIdx(null);
  };

  const zoomBy = (delta: number) => {
    const nw = Math.max(15, Math.min(totalLen, clampedWin + delta));
    const center = clampedStart + Math.floor(clampedWin / 2);
    const ns = Math.max(0, Math.min(totalLen - nw, center - Math.floor(nw / 2)));
    setWinSize(nw);
    setStartIdx(ns);
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    zoomBy(e.deltaY > 0 ? 10 : -10);
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    dragRef.current = { active: true, startX: e.clientX, origStart: clampedStart };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (dragRef.current.active && clampedWin < totalLen) {
      const dxPx = e.clientX - dragRef.current.startX;
      const barsShift = Math.round((-dxPx / Math.max(1, rect.width)) * clampedWin);
      const ns = Math.max(0, Math.min(totalLen - clampedWin, dragRef.current.origStart + barsShift));
      setStartIdx(ns);
      return;
    }
    const relX = ((e.clientX - rect.left) / rect.width) * w;
    const ratio = (relX - padL) / (w - padL - padR);
    const idx = Math.min(slice.length - 1, Math.max(0, Math.round(ratio * (slice.length - 1))));
    setHoverIdx(idx);
  };

  const stopDrag = () => {
    dragRef.current.active = false;
  };

  const primaryStroke = dark ? "#00D2FF" : "#0284C7";
  const ma20Stroke = dark ? "#818CF8" : "#4338CA";
  const ma50Stroke = dark ? "#F59E0B" : "#D97706";
  const posCol = dark ? "#10B981" : "#047857";
  const negCol = dark ? "#F43F5E" : "#BE123C";

  return (
    <div className="space-y-2.5">
      {/* Zoom & Pan Control Toolbar */}
      <div
        className="flex flex-wrap items-center justify-between gap-2"
        style={{ fontFamily: MONO, fontSize: 10.5 }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span style={{ color: "var(--mut)", fontWeight: 700, marginRight: 4 }}>
            KHUNG NHÌN ({clampedWin} PHIÊN):
          </span>
          {[
            { label: "30P", val: 30 },
            { label: "45P", val: 45 },
            { label: "60P", val: 60 },
            { label: `90P (TOÀN BỘ)`, val: totalLen },
          ].map((btn) => {
            const isAct = clampedWin === btn.val;
            return (
              <button
                key={btn.label}
                onClick={() => setPresetWindow(btn.val)}
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "3px 9px",
                  borderRadius: 5,
                  border: `1px solid ${isAct ? "var(--g)" : "var(--bd-mid)"}`,
                  background: isAct ? "var(--g)" : "var(--surf2)",
                  color: isAct ? "var(--g-contrast)" : "var(--ink)",
                  cursor: "pointer",
                }}
              >
                {btn.label}
              </button>
            );
          })}
          <button
            onClick={() => zoomBy(-12)}
            disabled={clampedWin <= 15}
            title="Phóng to (Zoom In)"
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 800,
              padding: "3px 8px",
              borderRadius: 5,
              border: "1px solid var(--bd-mid)",
              background: "var(--surf2)",
              color: "var(--ink)",
              cursor: clampedWin <= 15 ? "not-allowed" : "pointer",
              opacity: clampedWin <= 15 ? 0.45 : 1,
            }}
          >
            + PHÓNG TO
          </button>
          <button
            onClick={() => zoomBy(12)}
            disabled={clampedWin >= totalLen}
            title="Thu nhỏ (Zoom Out)"
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 800,
              padding: "3px 8px",
              borderRadius: 5,
              border: "1px solid var(--bd-mid)",
              background: "var(--surf2)",
              color: "var(--ink)",
              cursor: clampedWin >= totalLen ? "not-allowed" : "pointer",
              opacity: clampedWin >= totalLen ? 0.45 : 1,
            }}
          >
            - THU NHỎ
          </button>
        </div>

        {/* Pan Slider when zoomed in */}
        {clampedWin < totalLen ? (
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--g)", fontWeight: 700, fontSize: 10 }}>
              KÉO TRƯỢT THỜI GIAN:
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(1, totalLen - clampedWin)}
              value={clampedStart}
              onChange={(e) => setStartIdx(Number(e.target.value))}
              className="w-28 accent-[var(--g)] cursor-pointer"
            />
          </div>
        ) : (
          <span style={{ color: "var(--mut)", fontSize: 10 }}>
            💡 LĂN CHUỘT TRÊN ĐỒ THỊ ĐỂ PHÓNG TO / KÉO TRÁI-PHẢI ĐỂ TRƯỢT
          </span>
        )}
      </div>

      {/* Live Hover HUD Bar */}
      <div
        className="salx-sub"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "9px 14px",
          fontFamily: MONO,
          fontSize: 11.5,
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span style={{ color: "var(--g)", fontWeight: 800 }}>[{activePt.date}]</span>
          <span>
            VNINDEX:{" "}
            <strong style={{ color: "var(--ink)", fontSize: 13 }}>
              {activePt.close.toLocaleString("vi-VN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </strong>{" "}
            <span style={{ color: chgPct >= 0 ? "var(--pos)" : "var(--avax)", fontWeight: 700 }}>
              ({chgPct >= 0 ? "+" : ""}
              {chgPct.toFixed(2)}%)
            </span>
          </span>
          {activePt.ma20 !== null && (
            <span>
              MA20: <strong style={{ color: "var(--cyan)" }}>{activePt.ma20.toFixed(2)}</strong>
            </span>
          )}
          {activePt.ma50 !== null && (
            <span>
              MA50: <strong style={{ color: "var(--org)" }}>{activePt.ma50.toFixed(2)}</strong>
            </span>
          )}
        </div>
        <div style={{ color: "var(--mut)", fontSize: 10.5, fontWeight: 600 }}>
          KL: <strong style={{ color: "var(--ink)" }}>{((activePt.volume || 0) / 1e6).toFixed(1)}M CP</strong> •{" "}
          {slice[0]?.date} → {slice[slice.length - 1]?.date}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={`w-full h-auto select-none ${
          clampedWin < totalLen ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"
        }`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={() => {
          stopDrag();
          setHoverIdx(null);
        }}
      >
        <defs>
          <linearGradient id="salxVniGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryStroke} stopOpacity={dark ? 0.30 : 0.22} />
            <stop offset="100%" stopColor={primaryStroke} stopOpacity={0.0} />
          </linearGradient>
        </defs>

        {yTicks.map((tv, idx) => (
          <g key={idx}>
            <line
              x1={padL}
              x2={w - padR}
              y1={yAt(tv)}
              y2={yAt(tv)}
              stroke={dark ? "rgba(148,163,184,0.16)" : "rgba(15,23,42,0.14)"}
              strokeDasharray="3 3"
            />
            <text
              x={padL - 6}
              y={yAt(tv) + 4}
              textAnchor="end"
              fontSize="10.5"
              fontWeight="600"
              fontFamily={MONO}
              fill={dark ? "#A3B8CC" : "#334155"}
            >
              {tv.toFixed(0)}
            </text>
          </g>
        ))}

        {slice.map((d, i) => {
          const bh = ((d.volume || 0) / maxV) * 48;
          const gIdx = clampedStart + i;
          const prev = gIdx > 0 ? data[gIdx - 1].close : d.close;
          const up = d.close >= prev;
          const isHovered = i === activeIdx;
          const barW = Math.max(3, Math.min(10, (w - padL - padR) / slice.length - 2));
          return (
            <rect
              key={d.date}
              x={xAt(i) - barW / 2}
              y={h - padB - bh}
              width={barW}
              height={Math.max(1, bh)}
              fill={up ? posCol : negCol}
              opacity={isHovered ? 0.9 : dark ? 0.32 : 0.42}
            />
          );
        })}

        <path d={areaPath} fill="url(#salxVniGrad)" />
        <path d={ma50Path} fill="none" stroke={ma50Stroke} strokeWidth="1.8" strokeDasharray="4 3" />
        <path d={ma20Path} fill="none" stroke={ma20Stroke} strokeWidth="2.0" />
        <path d={closePath} fill="none" stroke={primaryStroke} strokeWidth="2.5" />

        {/* Crosshair */}
        <line
          x1={xAt(activeIdx)}
          x2={xAt(activeIdx)}
          y1={padT}
          y2={h - padB}
          stroke={primaryStroke}
          strokeWidth="1.2"
          strokeDasharray="3 3"
        />
        <line
          x1={padL}
          x2={w - padR}
          y1={yAt(activePt.close)}
          y2={yAt(activePt.close)}
          stroke={dark ? "#64748b" : "#475569"}
          strokeWidth="0.9"
          strokeDasharray="2 3"
        />

        {activePt.ma50 !== null && (
          <circle cx={xAt(activeIdx)} cy={yAt(activePt.ma50)} r="3.5" fill={ma50Stroke} />
        )}
        {activePt.ma20 !== null && (
          <circle cx={xAt(activeIdx)} cy={yAt(activePt.ma20)} r="3.5" fill={ma20Stroke} />
        )}
        <circle
          cx={xAt(activeIdx)}
          cy={yAt(activePt.close)}
          r="5"
          fill={primaryStroke}
          stroke={dark ? "#050914" : "#FFFFFF"}
          strokeWidth="2"
        />

        {/* Floating Price Tag */}
        <g
          transform={`translate(${Math.min(w - 174, Math.max(padL + 6, xAt(activeIdx) + 8))}, ${Math.max(
            padT + 4,
            Math.min(h - padB - 48, yAt(activePt.close) - 22)
          )})`}
        >
          <rect
            width="162"
            height="42"
            rx="6"
            fill={dark ? "#0A1224" : "#FFFFFF"}
            stroke={primaryStroke}
            strokeWidth="1.3"
            opacity="0.97"
          />
          <text
            x="8"
            y="15"
            fontSize="10"
            fontFamily={MONO}
            fontWeight="800"
            fill={dark ? "#F8FAFC" : "#0F172A"}
          >
            {activePt.date} • {activePt.close.toFixed(2)}
          </text>
          <text
            x="8"
            y="31"
            fontSize="9.5"
            fontFamily={MONO}
            fontWeight="600"
            fill={dark ? "#A3B8CC" : "#334155"}
          >
            MA20: {activePt.ma20?.toFixed(1) ?? "-"} | MA50: {activePt.ma50?.toFixed(1) ?? "-"}
          </text>
        </g>

        {xIdxs.map((idx) => (
          <text
            key={idx}
            x={xAt(idx)}
            y={h - 10}
            textAnchor={idx === 0 ? "start" : idx === slice.length - 1 ? "end" : "middle"}
            fontSize="10.5"
            fontWeight="600"
            fontFamily={MONO}
            fill={dark ? "#A3B8CC" : "#334155"}
          >
            {slice[idx]?.date}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ============================================================================
   SVG CHART 2: STOCK 60D MINI CHART WITH HOVER CROSSHAIR
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
  const strokeCol = isUp ? (dark ? "#00D2FF" : "#0284C7") : (dark ? "#F43F5E" : "#BE123C");

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
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          fontFamily: MONO,
          fontSize: 10.5,
        }}
      >
        <span style={{ color: "var(--g)", fontWeight: 700 }}>
          {symbol} [{activeDate}]
        </span>
        <span>
          GIÁ: <strong style={{ color: "var(--ink)" }}>{activeClose.toLocaleString("vi-VN")} đ</strong>
          {activeMa20 !== null && (
            <>
              {" "}
              • MA20: <strong style={{ color: "var(--org)" }}>{activeMa20.toLocaleString("vi-VN")}</strong> (
              <span style={{ color: diffMa20Pct >= 0 ? "var(--g)" : "var(--avax)", fontWeight: 700 }}>
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
              stroke={dark ? "rgba(148,163,184,0.14)" : "rgba(15,23,42,0.10)"}
              strokeDasharray="2 2"
            />
            <text
              x={padL - 5}
              y={yAt(tv) + 4}
              textAnchor="end"
              fontSize="9.5"
              fontFamily={MONO}
              fill={dark ? "#94a3b8" : "#64748b"}
            >
              {(tv / 1000).toFixed(1)}k
            </text>
          </g>
        ))}
        <path d={mPts.join(" ")} fill="none" stroke="#F59E0B" strokeWidth="1.4" strokeDasharray="3 2" />
        <path d={cPts} fill="none" stroke={strokeCol} strokeWidth="2.2" />

        <line
          x1={xAt(activeIdx)}
          x2={xAt(activeIdx)}
          y1={padT}
          y2={h - padB}
          stroke={strokeCol}
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        {activeMa20 !== null && (
          <circle cx={xAt(activeIdx)} cy={yAt(activeMa20)} r="3" fill="#F59E0B" />
        )}
        <circle
          cx={xAt(activeIdx)}
          cy={yAt(activeClose)}
          r="4.5"
          fill={strokeCol}
          stroke="#050A14"
          strokeWidth="1.5"
        />

        <text x={padL} y={h - 6} fontSize="9.5" fontFamily={MONO} fill={dark ? "#94a3b8" : "#64748b"}>
          {dates[0]}
        </text>
        <text x={w - padR} y={h - 6} textAnchor="end" fontSize="9.5" fontFamily={MONO} fill={dark ? "#94a3b8" : "#64748b"}>
          {dates[dates.length - 1]}
        </text>
      </svg>
    </div>
  );
}

/* ============================================================================
   SVG CHART 3: RETURN DISTRIBUTION & VaR / ES 95%
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
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mut)" }}>
        {bIdx !== null ? (
          <span>
            BIÊN LỢI SUẤT: <strong style={{ color: "var(--ink)" }}>{bLow}% → {bHigh}%</strong> • TẦN SUẤT:{" "}
            <strong style={{ color: "var(--g)" }}>{counts[bIdx]} PHIÊN</strong> (
            {((counts[bIdx] / returns.length) * 100).toFixed(1)}%)
          </span>
        ) : (
          <span>RÊ CHUỘT VÀO CỘT HISTOGRAM ĐỂ XEM TẦN SUẤT PHÂN PHỐI LỢI SUẤT NGÀY</span>
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
              fill={isTail ? (dark ? "#F43F5E" : "#BE123C") : (dark ? "#00D2FF" : "#0284C7")}
              opacity={isHov ? 1.0 : isTail ? 0.88 : dark ? 0.65 : 0.75}
              className="cursor-pointer"
              onMouseEnter={() => setHoverBin(i)}
              onMouseLeave={() => setHoverBin(null)}
            />
          );
        })}
        <line x1={varX} x2={varX} y1={padT} y2={h - padB} stroke="#F59E0B" strokeWidth="2" strokeDasharray="4 2" />
        <text x={varX + 4} y={padT + 10} fontSize="10" fontFamily={MONO} fontWeight="700" fill="#F59E0B">
          VaR 95%: -{(var95Pct * 100).toFixed(2)}%
        </text>
        <line x1={esX} x2={esX} y1={padT + 14} y2={h - padB} stroke="#E84142" strokeWidth="2" />
        <text x={Math.max(padL, esX - 4)} y={padT + 24} textAnchor="end" fontSize="10" fontFamily={MONO} fontWeight="700" fill="#E84142">
          ES: -{(es95Pct * 100).toFixed(2)}%
        </text>
        {[-0.04, -0.02, 0, 0.02, 0.04].map((rv) => (
          <text
            key={rv}
            x={xForR(rv)}
            y={h - 8}
            textAnchor="middle"
            fontSize="10"
            fontFamily={MONO}
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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Sync [data-theme="light"] on <html> exactly like SALX ThemeContext
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Discovery controls
  const [sectorFilter, setSectorFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [minScore, setMinScore] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"TOP10" | "ALL">("ALL");
  const [selectedStock, setSelectedStock] = useState<DiscoveryStock | null>(null);

  // Portfolio, Capital Advisor & What-If state
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [cashVnd, setCashVnd] = useState<number>(100_000_000);
  const [targetCapitalVnd, setTargetCapitalVnd] = useState<number>(200_000_000);
  const [whatIfSymbol, setWhatIfSymbol] = useState<string>("VND");
  const [whatIfAmount, setWhatIfAmount] = useState<number>(50_000_000);
  const [newPosSym, setNewPosSym] = useState<string>("ACB");
  const [posInputMode, setPosInputMode] = useState<"SHARES" | "VND">("SHARES");
  const [newPosShares, setNewPosShares] = useState<number>(2000);
  const [newPosAmt, setNewPosAmt] = useState<number>(100_000_000);
  const [portfolioMsg, setPortfolioMsg] = useState<string | null>(null);
  const [simulations, setSimulations] = useState<SimulationHistoryItem[]>([]);
  const [showPoriGuide, setShowPoriGuide] = useState<boolean>(false);

  // Auth & Cloud Persistence state (Guest-first + Email/Password via Supabase)
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authTab, setAuthTab] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [cloudSyncState, setCloudSyncState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const workspaceInitializedRef = useRef<boolean>(false);

  // Orderbook state
  const [obSymbol, setObSymbol] = useState<string>("HPG");
  const [obAmount, setObAmount] = useState<number>(200_000_000);
  const [obSide, setObSide] = useState<"buy" | "sell">("buy");

  // Interactive Pillar Explanation & Sector Hover Popup state
  const [openPillarInfo, setOpenPillarInfo] = useState<number | null>(null);
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);

  const pushSimulationLog = (
    actionType: SimulationHistoryItem["actionType"],
    summary: string,
    symbol?: string,
    amountVnd?: number
  ) => {
    const entry: SimulationHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      }),
      actionType,
      symbol,
      amountVnd,
      summary,
    };
    setSimulations((prev) => [entry, ...prev].slice(0, 25));
  };

  const fetchLatestBundle = async () => {
    setRefreshing(true);
    try {
      const [snapRes, liveCloud] = await Promise.all([
        fetch(`/data/snapshot.json?t=${Date.now()}`),
        fetchLiveSnapshotFromSupabase<SnapshotBundle>(),
      ]);
      if (!snapRes.ok && !liveCloud) throw new Error("Không tìm thấy dữ liệu snapshot.json");
      const staticLoaded: SnapshotBundle | null = snapRes.ok ? await snapRes.json() : null;

      let loaded: SnapshotBundle;
      if (liveCloud && staticLoaded) {
        const cloudTs = Date.parse(liveCloud.generated_at || "") || 0;
        const staticTs = Date.parse(staticLoaded.generated_at || "") || 0;
        loaded = cloudTs >= staticTs ? liveCloud : staticLoaded;
      } else {
        loaded = (liveCloud || staticLoaded)!;
      }
      setBundle(loaded);

      if (!workspaceInitializedRef.current) {
        let restoredFromLocal = false;
        try {
          const raw = localStorage.getItem(LOCAL_WORKSPACE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.positions === "object") {
              setPositions(parsed.positions);
              setCashVnd(Number(parsed.cashVnd ?? loaded.default_portfolio.cash_vnd));
              setTargetCapitalVnd(Number(parsed.targetCapitalVnd ?? 200_000_000));
              setSimulations(Array.isArray(parsed.simulations) ? parsed.simulations : []);
              restoredFromLocal = true;
            }
          }
        } catch {
          // ignore corrupted storage
        }
        if (!restoredFromLocal) {
          setPositions(loaded.default_portfolio.positions);
          setCashVnd(loaded.default_portfolio.cash_vnd);
          const defNav =
            Object.values(loaded.default_portfolio.positions).reduce((a, b) => a + b, 0) +
            loaded.default_portfolio.cash_vnd;
          setTargetCapitalVnd(defNav);
        }
        workspaceInitializedRef.current = true;
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

  // Supabase Email/Password session restore + cloud workspace sync
  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const syncFromCloud = async (user: User) => {
      const cloud = await loadCloudWorkspace(user.id);
      if (!active) return;
      if (cloud) {
        setPositions(cloud.positions);
        setCashVnd(cloud.cashVnd);
        setTargetCapitalVnd(cloud.targetCapitalVnd);
        setSimulations(cloud.simulations);
        workspaceInitializedRef.current = true;
        setCloudSyncState("saved");
        setPortfolioMsg(`Đã tự động đồng bộ danh mục & lịch sử mô phỏng của ${user.email}.`);
      } else if (workspaceInitializedRef.current) {
        setCloudSyncState("saving");
        const res = await saveCloudWorkspace(user.id, user.email, {
          positions,
          cashVnd,
          targetCapitalVnd,
          simulations,
        });
        if (active) setCloudSyncState(res.ok ? "saved" : "error");
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const u = data.session?.user ?? null;
      setAuthUser(u);
      if (u) syncFromCloud(u);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      const u = session?.user ?? null;
      setAuthUser(u);
      if (event === "SIGNED_IN" && u) {
        syncFromCloud(u);
      } else if (event === "SIGNED_OUT") {
        setCloudSyncState("idle");
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save to localStorage (for all guests) + debounced save to Supabase (for logged-in users)
  useEffect(() => {
    if (!workspaceInitializedRef.current) return;
    try {
      localStorage.setItem(
        LOCAL_WORKSPACE_KEY,
        JSON.stringify({ positions, cashVnd, targetCapitalVnd, simulations })
      );
    } catch {
      // ignore storage quota errors
    }

    if (!authUser || !supabase) return;
    setCloudSyncState("saving");
    const timer = setTimeout(async () => {
      const res = await saveCloudWorkspace(authUser.id, authUser.email, {
        positions,
        cashVnd,
        targetCapitalVnd,
        simulations,
      });
      setCloudSyncState(res.ok ? "saved" : "error");
    }, 850);
    return () => clearTimeout(timer);
  }, [positions, cashVnd, targetCapitalVnd, simulations, authUser]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setAuthError("Chưa gắn biến môi trường Supabase trên Vercel (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).");
      return;
    }
    setAuthError(null);
    setAuthSuccess(null);
    setAuthBusy(true);
    try {
      if (authTab === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (err) throw err;
        setAuthModalOpen(false);
        setAuthPassword("");
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (err) throw err;
        if (data.session) {
          setAuthModalOpen(false);
          setAuthPassword("");
        } else {
          setAuthSuccess(
            "Đã tạo tài khoản! Nếu dự án Supabase có bật xác thực email, vui lòng kiểm tra hộp thư để kích hoạt rồi đăng nhập."
          );
        }
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Đăng nhập thất bại. Vui lòng kiểm tra lại Email/Mật khẩu.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthUser(null);
    setCloudSyncState("idle");
    setPortfolioMsg("Đã đăng xuất. Danh mục hiện tại vẫn được giữ tạm trên trình duyệt này.");
  };

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchLatestBundle, 15_000);
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

  const capitalAdvice = useMemo(() => {
    if (!bundle || !activeHealth) return null;
    return computeCapitalAllocationAdvice(
      targetCapitalVnd,
      positions,
      activeHealth,
      bundle.market_regime.regime,
      bundle.discovery,
      portfolioFitBySymbol
    );
  }, [bundle, activeHealth, targetCapitalVnd, positions, portfolioFitBySymbol]);

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
        vnSectorName(r.sector),
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
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--mut)",
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: ".1em",
        }}
      >
        ĐANG KHỞI TẠO HỆ THỐNG ĐỊNH LƯỢNG PORI…
      </div>
    );
  }

  if (error || !bundle || !activeHealth) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--avax)",
          fontFamily: MONO,
          padding: 24,
        }}
      >
        LỖI KHỞI TẠO DỮ LIỆU: {error || "Không có dữ liệu hiển thị."}
      </div>
    );
  }

  const regime = bundle.market_regime;
  const selectedSeries = selectedStock
    ? bundle.quant_client_data?.stock_series?.[selectedStock.symbol]
    : null;
  const selectedFit = selectedStock ? portfolioFitBySymbol[selectedStock.symbol] : null;
  const isRiskRegime = regime.regime === "High Risk" || regime.regime === "Defensive";

  const navLinkStyle = (isActive: boolean): React.CSSProperties => ({
    background: "none",
    border: "none",
    borderBottom: `2px solid ${isActive ? "var(--g)" : "transparent"}`,
    cursor: "pointer",
    padding: "7px 2px",
    color: isActive ? "var(--ink)" : "var(--mut)",
    fontFamily: MONO,
    fontSize: 10.5,
    fontWeight: isActive ? 800 : 600,
    letterSpacing: ".03em",
    textTransform: "uppercase",
    transition: "color .2s, border-color .2s",
    whiteSpace: "nowrap",
    flexShrink: 0,
  });

  const chipBtnStyle: React.CSSProperties = {
    background: "none",
    border: "1px solid var(--bd)",
    color: "var(--ink)",
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: ".04em",
    padding: "5px 9px",
    borderRadius: 7,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const shortRegimeBadge =
    regime.regime === "High Risk"
      ? "RỦI RO CAO"
      : regime.regime === "Defensive"
      ? "PHÒNG THỦ"
      : regime.regime === "Positive"
      ? "TÍCH CỰC"
      : "TRUNG TÍNH";

  return (
    <div style={{ position: "relative", minHeight: "100dvh", background: "var(--bg)", color: "var(--ink)" }}>
      {/* Pointer-Reactive Ambient Glow & Tech Grid */}
      <CursorAmbientGlow />

      {/* ── SLEEK SINGLE-ROW STICKY HEADER ── */}
      <header className="app-hdr">
        {/* Col 1 — Brand with Custom Vector PORI Logo */}
        <div
          onClick={() => setActiveTab("regime")}
          style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", flexShrink: 0 }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 64 64"
            fill="none"
            aria-label="PORI Logo"
            style={{
              filter: darkMode ? "drop-shadow(0 0 10px rgba(0, 210, 255, 0.25))" : "drop-shadow(0 2px 6px rgba(2, 132, 199, 0.2))",
              flexShrink: 0,
            }}
          >
            <defs>
              <linearGradient id="hdrPoriBg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor={darkMode ? "#0A162D" : "#0F172A"} />
                <stop offset="100%" stopColor={darkMode ? "#050914" : "#1E293B"} />
              </linearGradient>
              <linearGradient id="hdrPoriGrad" x1="12" y1="10" x2="52" y2="54" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#00D2FF" />
                <stop offset="55%" stopColor="#38BDF8" />
                <stop offset="100%" stopColor="#6366F1" />
              </linearGradient>
              <linearGradient id="hdrPoriPulse" x1="25" y1="45" x2="50" y2="24" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#818CF8" />
                <stop offset="100%" stopColor="#00D2FF" />
              </linearGradient>
            </defs>
            <rect x="3" y="3" width="58" height="58" rx="15" fill="url(#hdrPoriBg)" stroke="url(#hdrPoriGrad)" strokeWidth="2.6" />
            <line x1="12" y1="32" x2="52" y2="32" stroke="#00D2FF" strokeOpacity="0.14" strokeWidth="1" strokeDasharray="2 3" />
            <line x1="32" y1="12" x2="32" y2="52" stroke="#6366F1" strokeOpacity="0.14" strokeWidth="1" strokeDasharray="2 3" />
            <rect x="17" y="16" width="6.5" height="32" rx="3.25" fill="url(#hdrPoriGrad)" />
            <path
              d="M 22.5 19.25 H 35.5 C 42.2 19.25 46.5 23.1 46.5 28.1 C 46.5 33.1 42.2 36.8 35.5 36.8 H 27.5"
              stroke="url(#hdrPoriGrad)"
              strokeWidth="5.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 28.5 46 L 34.5 40.5 L 39 43.2 L 46.8 33.5"
              stroke="url(#hdrPoriPulse)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="47" cy="33.2" r="3.2" fill="#00D2FF" />
          </svg>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              style={{
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: 19,
                letterSpacing: "-.03em",
                color: "var(--ink)",
              }}
            >
              PORI
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                padding: "2px 6px",
                borderRadius: 4,
                background: "var(--gb)",
                color: "var(--g)",
                border: "1px solid var(--gd)",
                whiteSpace: "nowrap",
              }}
            >
              ĐỊNH LƯỢNG & RỦI RO
            </span>
          </div>
        </div>

        {/* Col 2 — Centered Single-Row Nav Links */}
        <nav className="app-hdr-nav" aria-label="Main">
          {[
            { id: "regime", label: "01. Thị Trường" },
            { id: "discovery", label: "02. Lọc Cổ Phiếu" },
            { id: "portfolio", label: "03. Danh Mục & Vốn" },
            { id: "orderbook", label: "04. Sổ Lệnh" },
            { id: "validation", label: "05. Kiểm Định" },
            { id: "guide", label: "06. Hướng Dẫn" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabId)}
              style={navLinkStyle(activeTab === tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Col 3 — Compact Status Chips, Auth & Theme Toggle */}
        <div className="app-hdr-actions">
          <span
            title={`Trạng thái thị trường: ${vnRegime(regime.regime)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: ".04em",
              fontWeight: 700,
              color: isRiskRegime ? "var(--avax)" : "var(--g)",
              background: isRiskRegime ? "var(--avax-bg)" : "var(--gb)",
              border: `1px solid ${isRiskRegime ? "var(--avax-bd)" : "var(--gd)"}`,
              borderRadius: 7,
              padding: "5px 8px",
              whiteSpace: "nowrap",
            }}
          >
            <span>▲</span>
            {shortRegimeBadge}
          </span>

          <button
            onClick={() => setAutoRefresh((v) => !v)}
            title="Tự động đồng bộ dữ liệu mỗi 60 giây"
            style={{
              ...chipBtnStyle,
              borderColor: autoRefresh ? "var(--gd)" : "var(--bd)",
              color: autoRefresh ? "var(--g)" : "var(--mut)",
            }}
          >
            AUTO: {autoRefresh ? "BẬT" : "TẮT"}
          </button>

          <button onClick={fetchLatestBundle} disabled={refreshing} style={chipBtnStyle} title="Làm mới dữ liệu thị trường">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              {bundle.latest_trading_date}
            </span>
          </button>

          <button
            onClick={() => setDarkMode((v) => !v)}
            title="Chuyển giao diện Sáng / Tối"
            style={{ ...chipBtnStyle, color: "var(--mut)" }}
          >
            {darkMode ? "SÁNG" : "TỐI"}
          </button>

          {authUser ? (
            <div className="inline-flex items-center gap-1">
              <span
                style={{
                  ...chipBtnStyle,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  borderColor: "var(--gd)",
                  background: "var(--gb)",
                  color: "var(--g)",
                  cursor: "default",
                }}
                title={
                  cloudSyncState === "saving"
                    ? "Đang đồng bộ danh mục lên tài khoản..."
                    : `Đã lưu vào ${authUser.email}`
                }
              >
                <UserCheck className="h-3 w-3" />
                {authUser.email?.split("@")[0]}
              </span>
              <button
                onClick={handleSignOut}
                title="Đăng xuất tài khoản"
                style={{ ...chipBtnStyle, color: "var(--mut)", padding: "5px 7px" }}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setAuthError(null);
                setAuthSuccess(null);
                setAuthModalOpen(true);
              }}
              style={{
                ...chipBtnStyle,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "var(--g)",
                color: "var(--g-contrast)",
                borderColor: "var(--g)",
                fontWeight: 700,
              }}
              title="Đăng nhập bằng Email để lưu danh mục & lịch sử mô phỏng cho các lần truy cập sau"
            >
              <LogIn className="h-3 w-3" />
              ĐĂNG NHẬP
            </button>
          )}
        </div>
      </header>

      {/* ── MAIN CONTENT WRAPPER ── */}
      <main
        className="salx-fade-up"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1480,
          margin: "0 auto",
          padding: "24px clamp(16px, 3vw, 36px) 80px",
        }}
      >
        {/* EDITORIAL PAGE HEADER + WHAT IS PORI + MARKET BRIEF */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            alignItems: "end",
            gap: 22,
            marginBottom: 22,
            paddingBottom: 18,
            borderBottom: "1px solid var(--bd)",
          }}
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--g)",
                }}
              >
                PORI — CÔNG CỤ ĐỊNH LƯỢNG & QUẢN TRỊ RỦI RO DANH MỤC • {bundle.sessions_count} PHIÊN DỮ LIỆU
              </span>
              {bundle.generated_at && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontFamily: MONO,
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: "var(--surf2)",
                    border: "1px solid var(--bd-mid)",
                    color: "var(--ink)",
                  }}
                  title="Thời điểm dữ liệu NEO + SSI được đồng bộ gần nhất (tự làm mới mỗi 15 giây khi AUTO: BẬT)"
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: autoRefresh ? "var(--pos)" : "var(--mut)",
                      display: "inline-block",
                    }}
                  />
                  ĐỒNG BỘ: {new Date(bundle.generated_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
              {activeTab !== "guide" && (
                <button
                  onClick={() => setActiveTab("guide")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontFamily: MONO,
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: "var(--gb)",
                    border: "1px solid var(--gd)",
                    color: "var(--g)",
                    cursor: "pointer",
                  }}
                >
                  <BookOpen className="h-3 w-3" />
                  HƯỚNG DẪN NGƯỜI MỚI ↗
                </button>
              )}
            </div>

            <h1
              style={{
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: "clamp(25px, 3vw, 38px)",
                lineHeight: 1.08,
                letterSpacing: "-.025em",
                margin: "8px 0 0",
                color: "var(--ink)",
              }}
            >
              {activeTab === "regime" && "Tổng Quan Thị Trường & Luân Chuyển Nhóm Ngành"}
              {activeTab === "discovery" && "Bộ Lọc Xếp Hạng Cổ Phiếu & Hồ Sơ Chi Tiết"}
              {activeTab === "portfolio" && "Quản Trị Rủi Ro Danh Mục & Cố Vấn Phân Bổ Vốn"}
              {activeTab === "orderbook" && "Thanh Khoản Sổ Lệnh 3 Bước Giá & Ước Tính Trượt Giá"}
              {activeTab === "validation" && "Hiệu Quả Kiểm Định Mô Hình & Dữ Liệu Nguồn"}
              {activeTab === "guide" && "Hướng Dẫn Sử Dụng PORI Cho Người Mới Bắt Đầu"}
            </h1>

            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--mut)", lineHeight: 1.55, maxWidth: 650 }}>
              <strong style={{ color: "var(--ink)" }}>PORI là gì?</strong> Là hệ thống phân tích định lượng chứng khoán Việt Nam
              kết nối dữ liệu <strong style={{ color: "var(--ink)" }}>VPBankS NEO & SSI v3</strong>: giúp xác định xu hướng
              thị trường, xếp hạng cổ phiếu theo <strong style={{ color: "var(--g)" }}>Điểm PORI (0–100)</strong>, tư vấn cấu
              trúc vốn &amp; đo lường rủi ro <strong style={{ color: "var(--ink)" }}>VaR/ES</strong> trước khi xuống tiền.
            </p>
          </div>

          {/* Quick Session Brief Banner */}
          <div
            className="salx-card"
            style={{
              padding: "14px 16px",
              borderColor: isRiskRegime ? "var(--avax-bd)" : "var(--gd)",
              background: isRiskRegime
                ? "linear-gradient(110deg, var(--avax-bg), var(--surf))"
                : "linear-gradient(110deg, var(--gb), var(--surf))",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontFamily: MONO,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".1em",
                color: isRiskRegime ? "var(--avax)" : "var(--g)",
                marginBottom: 6,
              }}
            >
              <span>⚡ NHẬN ĐỊNH NHANH PHIÊN GIAO DỊCH ({bundle.latest_trading_date})</span>
              <span>ĐỒNG THUẬN: {regime.positive_pillars}/3 TRỤ CỘT</span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink)", lineHeight: 1.5 }}>
              {regime.summary}
            </p>
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid var(--bd-soft)",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontFamily: MONO,
                fontSize: 10.5,
              }}
            >
              <span>
                TOP ĐIỂM PORI:{" "}
                {bundle.discovery.slice(0, 3).map((d) => (
                  <button
                    key={d.symbol}
                    onClick={() => {
                      setSelectedStock(d);
                      setActiveTab("discovery");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--g)",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginRight: 8,
                      textDecoration: "underline",
                    }}
                  >
                    {d.symbol}({d.alpha_score})
                  </button>
                ))}
              </span>
              {bestFitCandidate && (
                <button
                  onClick={() => {
                    setWhatIfSymbol(bestFitCandidate.candidate_symbol);
                    setActiveTab("portfolio");
                  }}
                  style={{
                    background: "var(--g)",
                    color: "var(--g-contrast)",
                    border: "none",
                    borderRadius: 5,
                    padding: "3px 9px",
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  PHÙ HỢP DANH MỤC NHẤT: {bestFitCandidate.candidate_symbol} ({bestFitCandidate.portfolio_fit_score}/100) ↗
                </button>
              )}
            </div>
          </div>
        </div>

        {/* =====================================================================
            SCREEN 1: MARKET REGIME & SECTOR ROTATION
           ===================================================================== */}
        {activeTab === "regime" && (
          <div className="space-y-6">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
              }}
            >
              <StatCard
                label="CHỈ SỐ VNINDEX"
                value={regime.vnindex_close.toLocaleString("vi-VN")}
                unit="ĐIỂM"
                sub={`MA20: ${regime.ma20} • MA50: ${regime.ma50}`}
                accent
              />
              <StatCard
                label="ĐỘ RỘNG TOÀN SÀN (A/D RATIO)"
                value={`${regime.ad_ratio.toFixed(2)}x`}
                sub={`▲ ${bundle.breadth_counts?.advances ?? "--"} Tăng • ▼ ${bundle.breadth_counts?.declines ?? "--"} Giảm • ${(regime.pct_above_ma20 * 100).toFixed(0)}% > MA20`}
              />
              <StatCard
                label="NHỊP THANH KHOẢN (VOLUME PACE)"
                value={`${regime.volume_pace.toFixed(2)}x`}
                unit="TB 20P"
                sub={regime.liquidity_status}
              />
              <StatCard
                label="CHỈ SỐ AN TOÀN DANH MỤC"
                value={activeHealth.health_score}
                unit="/ 100"
                sub={`VaR 95% (1 ngày): -${fmtVnd(activeHealth.hist_var_95_vnd)}`}
                accent
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-12">
              <div className="salx-card p-5 lg:col-span-7">
                <SectionLabel
                  right={
                    <div style={{ display: "flex", gap: 12, fontFamily: MONO, fontSize: 10 }}>
                      <span style={{ color: "var(--g)" }}>● VNINDEX</span>
                      <span style={{ color: "var(--cyan)" }}>● MA20</span>
                      <span style={{ color: "var(--org)" }}>-- MA50</span>
                    </div>
                  }
                >
                  ĐỒ THỊ XU HƯỚNG VNINDEX (90 PHIÊN) & TRUNG BÌNH ĐỘNG
                </SectionLabel>

                {bundle.vnindex_history && (
                  <VnindexChart data={bundle.vnindex_history} dark={darkMode} />
                )}

                {(() => {
                  const pillars = [
                    {
                      id: 1,
                      title: "01 / XU HƯỚNG THỊ TRƯỜNG",
                      desc: regime.trend_status,
                      explainTitle: "Phương pháp đo lường Xu hướng (Trend Pillar)",
                      explainFormula: "VNINDEX Close so với MA20 & MA50 + Độ dốc ΔMA20 (5 phiên)",
                      explainDetail: `So sánh chỉ số VNINDEX (${regime.vnindex_close.toLocaleString("vi-VN")}) với đường trung bình động ngắn hạn MA20 (${regime.ma20}) và trung hạn MA50 (${regime.ma50}). Khi giá nằm trên cả 2 đường và MA20 hướng lên, trụ cột Xu hướng đạt điểm thuận lợi (+1); khi nằm dưới cả hai đường thì phát tín hiệu phòng thủ.`,
                    },
                    {
                      id: 2,
                      title: "02 / ĐỘ LAN TỎA DÒNG TIỀN",
                      desc: regime.breadth_status,
                      explainTitle: "Phương pháp đo lường Độ rộng & Độ lan tỏa (Breadth Pillar)",
                      explainFormula: "Tỷ lệ A/D Toàn sàn HOSE + % Cổ phiếu nằm trên MA20",
                      explainDetail: `Kết hợp độ rộng toàn sàn HOSE (${bundle.breadth_counts?.advances ?? "--"} mã tăng / ${bundle.breadth_counts?.declines ?? "--"} mã giảm, A/D = ${regime.ad_ratio.toFixed(2)}x) với tỷ lệ mã trong rổ thanh khoản giữ được xu hướng trên MA20 (${(regime.pct_above_ma20 * 100).toFixed(0)}%). Giúp phát hiện sớm hiện tượng "xanh vỏ đỏ lòng" hoặc phân hóa ngầm.`,
                    },
                    {
                      id: 3,
                      title: "03 / THANH KHOẢN & KHỐI NGOẠI",
                      desc: regime.liquidity_status,
                      explainTitle: "Phương pháp đo lường Nhịp Thanh khoản (Liquidity & Flow Pillar)",
                      explainFormula: "Volume Pace = Khối lượng phiên / Trung bình 20 phiên (MA20 Vol)",
                      explainDetail: `Đo lường cường độ dòng tiền qua hệ số Volume Pace hiện tại (${regime.volume_pace.toFixed(2)}x so với bình quân 20 phiên). Thanh khoản duy trì từ 0.90x–1.35x đi kèm giá tăng xác nhận dòng tiền nâng đỡ bền vững; thanh khoản đột biến khi giá thủng hỗ trợ cảnh báo áp lực phân phối.`,
                    },
                  ];
                  const activePillar = pillars.find((p) => p.id === openPillarInfo) || null;
                  return (
                    <>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        {pillars.map((p) => {
                          const isOpen = openPillarInfo === p.id;
                          return (
                            <div
                              key={p.id}
                              className="salx-sub p-3 transition-all flex flex-col justify-between"
                              style={{
                                borderColor: isOpen ? "var(--g)" : "var(--bd-soft)",
                                boxShadow: isOpen ? "0 8px 24px rgba(0, 210, 255, 0.14)" : "none",
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 800, color: "var(--g)" }}>
                                  {p.title}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setOpenPillarInfo(isOpen ? null : p.id)}
                                  title="Ấn để xem giải thích công thức & ý nghĩa định lượng"
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontFamily: MONO,
                                    fontSize: 9,
                                    fontWeight: 800,
                                    padding: "3px 8px",
                                    borderRadius: 99,
                                    border: `1px solid ${isOpen ? "var(--g)" : "var(--gd)"}`,
                                    background: isOpen ? "var(--g)" : "var(--gb)",
                                    color: isOpen ? "var(--g-contrast)" : "var(--g)",
                                    cursor: "pointer",
                                    flexShrink: 0,
                                  }}
                                >
                                  <HelpCircle className="h-3 w-3" />
                                  {isOpen ? "ĐÓNG" : "GIẢI THÍCH"}
                                </button>
                              </div>
                              <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "var(--ink)" }}>
                                {p.desc}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {activePillar && (
                        <div
                          className="salx-sub mt-3 p-3.5 text-xs space-y-2 salx-fade-up"
                          style={{
                            borderColor: "var(--g)",
                            background: "var(--surf)",
                            boxShadow: "0 10px 28px rgba(0, 210, 255, 0.12)",
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 800, color: "var(--g)" }}>
                              {activePillar.title} — {activePillar.explainTitle}
                            </div>
                            <button
                              type="button"
                              onClick={() => setOpenPillarInfo(null)}
                              style={{
                                fontFamily: MONO,
                                fontSize: 9.5,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 6,
                                border: "1px solid var(--bd-mid)",
                                background: "var(--surf2)",
                                color: "var(--mut)",
                                cursor: "pointer",
                              }}
                            >
                              THU GỌN ✕
                            </button>
                          </div>
                          <div
                            style={{
                              fontFamily: MONO,
                              fontSize: 10.5,
                              padding: "6px 10px",
                              borderRadius: 6,
                              background: "var(--surf2)",
                              border: "1px solid var(--bd-soft)",
                              color: "var(--ink)",
                            }}
                          >
                            <strong style={{ color: "var(--cyan)" }}>CÔNG THỨC:</strong> {activePillar.explainFormula}
                          </div>
                          <p style={{ margin: 0, fontSize: 12.5, color: "var(--mut)", lineHeight: 1.55 }}>
                            {activePillar.explainDetail}
                          </p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="salx-card p-5 lg:col-span-5">
                <SectionLabel
                  right={
                    <span style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--g)", fontWeight: 700 }}>
                      RÊ CHUỘT XEM CHI TIẾT • BẤM ĐỂ LỌC ↗
                    </span>
                  }
                >
                  BẢNG XẾP HẠNG NHÓM NGÀNH
                </SectionLabel>

                <div className="space-y-3">
                  {(bundle.sector_summary || []).map((sec, sIdx) => {
                    const isHov = hoveredSector === sec.sector;
                    const topStocksInSector = bundle.discovery
                      .filter((d) => d.sector === sec.sector)
                      .slice(0, 3);
                    return (
                      <div
                        key={sec.sector}
                        onMouseEnter={() => setHoveredSector(sec.sector)}
                        onMouseLeave={() => setHoveredSector(null)}
                        onClick={() => {
                          setSectorFilter(sec.sector);
                          setActiveTab("discovery");
                        }}
                        className="salx-sub sector-rank-item p-3 cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span style={{ fontWeight: 700, color: "var(--ink)" }}>
                            <span
                              style={{
                                fontFamily: MONO,
                                fontSize: 10,
                                color: "var(--g)",
                                marginRight: 6,
                              }}
                            >
                              #{sIdx + 1}
                            </span>
                            {vnSectorName(sec.sector)}{" "}
                            <span style={{ color: "var(--mut)", fontWeight: 600 }}>({sec.stock_count} mã)</span>
                          </span>
                          <span style={{ fontFamily: MONO, fontWeight: 800, color: "var(--g)" }}>
                            ĐIỂM PORI TB: {sec.avg_alpha_score}
                          </span>
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            height: 6,
                            borderRadius: 99,
                            background: "var(--bd)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.min(100, sec.avg_alpha_score)}%`,
                              background: "linear-gradient(90deg, var(--g), var(--cyan))",
                              borderRadius: 99,
                            }}
                          />
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            display: "flex",
                            justifyContent: "space-between",
                            fontFamily: MONO,
                            fontSize: 10.5,
                            color: "var(--mut)",
                          }}
                        >
                          <span>TRÊN MA20: <strong style={{ color: "var(--ink)" }}>{sec.pct_above_ma20}%</strong></span>
                          <span>
                            SM GIÁ 20P:{" "}
                            <strong style={{ color: sec.avg_rs_20d_pct >= 0 ? "var(--pos)" : "var(--avax)" }}>
                              {sec.avg_rs_20d_pct >= 0 ? "+" : ""}
                              {sec.avg_rs_20d_pct}%
                            </strong>
                          </span>
                          <span>
                            DẪN ĐẦU: <strong style={{ color: "var(--ink)" }}>{sec.top_symbol}</strong> ({sec.top_score})
                          </span>
                        </div>

                        {/* Hover Popup Card */}
                        {isHov && (
                          <div
                            className="mt-2.5 pt-2.5 text-xs salx-fade-up"
                            style={{
                              background: "var(--surf)",
                              margin: "10px -4px -4px",
                              padding: "10px 12px",
                              borderRadius: 8,
                              border: "1px solid var(--gd)",
                              boxShadow: "0 10px 28px rgba(0, 0, 0, 0.22)",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontFamily: MONO,
                                fontSize: 9.5,
                                fontWeight: 800,
                                color: "var(--g)",
                                marginBottom: 6,
                              }}
                            >
                              <span>⚡ CHI TIẾT XUNG LỰC NGÀNH {vnSectorName(sec.sector).toUpperCase()}</span>
                              <span>HẠNG #{sIdx + 1}/{bundle.sector_summary?.length || 8}</span>
                            </div>

                            <div className="space-y-1.5">
                              {topStocksInSector.map((st) => (
                                <div
                                  key={st.symbol}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    fontFamily: MONO,
                                    fontSize: 10.5,
                                    padding: "3px 6px",
                                    borderRadius: 5,
                                    background: "var(--surf2)",
                                  }}
                                >
                                  <span>
                                    <strong style={{ color: "var(--ink)" }}>{st.symbol}</strong>{" "}
                                    <span style={{ color: "var(--mut)" }}>
                                      ({st.close_price.toLocaleString("vi-VN")} đ)
                                    </span>
                                  </span>
                                  <span>
                                    RS 20p:{" "}
                                    <strong
                                      style={{ color: st.rs_20d >= 0 ? "var(--pos)" : "var(--avax)" }}
                                    >
                                      {st.rs_20d >= 0 ? "+" : ""}
                                      {(st.rs_20d * 100).toFixed(1)}%
                                    </strong>{" "}
                                    • Điểm PORI: <strong style={{ color: "var(--g)" }}>{st.alpha_score}</strong>
                                  </span>
                                </div>
                              ))}
                            </div>

                            <div
                              style={{
                                marginTop: 6,
                                fontFamily: MONO,
                                fontSize: 9.5,
                                color: "var(--mut)",
                                display: "flex",
                                justifyContent: "space-between",
                              }}
                            >
                              <span>
                                Trạng thái:{" "}
                                <strong style={{ color: "var(--ink)" }}>
                                  {sec.avg_alpha_score >= 55
                                    ? "Dòng tiền dẫn dắt"
                                    : sec.avg_alpha_score >= 45
                                    ? "Phân hóa tích lũy"
                                    : "Suy yếu ngắn hạn"}
                                </strong>
                              </span>
                              <span style={{ color: "var(--g)", fontWeight: 700 }}>
                                Nhấn để mở bảng lọc ngành →
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
              <div className="salx-card p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {(["TOP10", "ALL"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setViewMode(m)}
                        style={{
                          fontFamily: MONO,
                          fontSize: 10.5,
                          letterSpacing: ".08em",
                          textTransform: "uppercase",
                          padding: "7px 14px",
                          borderRadius: 6,
                          border: "1px solid var(--bd)",
                          cursor: "pointer",
                          background: viewMode === m ? "var(--g)" : "var(--surf2)",
                          color: viewMode === m ? "var(--g-contrast)" : "var(--mut)",
                          fontWeight: 700,
                        }}
                      >
                        {m === "TOP10" ? "TOP 10 NỔI BẬT" : `TOÀN BỘ (${bundle.discovery.length} MÃ)`}
                      </button>
                    ))}

                    <select
                      value={sectorFilter}
                      onChange={(e) => setSectorFilter(e.target.value)}
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        background: "var(--surf2)",
                        border: "1px solid var(--bd)",
                        color: "var(--ink)",
                        borderRadius: 6,
                        padding: "6px 10px",
                      }}
                    >
                      {sectors.map((s) => (
                        <option key={s} value={s}>
                          {s === "ALL" ? "TẤT CẢ NHÓM NGÀNH" : vnSectorName(s).toUpperCase()}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      placeholder="TÌM MÃ (VD: FPT, VCB)..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        background: "var(--surf2)",
                        border: "1px solid var(--bd)",
                        color: "var(--ink)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        width: 170,
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mut)" }}>
                      ĐIỂM PORI ≥ <strong style={{ color: "var(--g)" }}>{minScore}</strong>
                      <input
                        type="range"
                        min={0}
                        max={85}
                        step={5}
                        value={minScore}
                        onChange={(e) => setMinScore(Number(e.target.value))}
                        className="ml-2 w-20 align-middle"
                      />
                    </div>
                    <button
                      onClick={() => setShowPoriGuide((v) => !v)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 700,
                        background: showPoriGuide ? "var(--g)" : "var(--surf2)",
                        border: `1px solid ${showPoriGuide ? "var(--g)" : "var(--bd-mid)"}`,
                        color: showPoriGuide ? "var(--g-contrast)" : "var(--g)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                      ĐIỂM PORI LÀ GÌ?
                    </button>
                    <button
                      onClick={exportDiscoveryCsv}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: MONO,
                        fontSize: 10.5,
                        fontWeight: 700,
                        background: "var(--gb)",
                        border: "1px solid var(--gd)",
                        color: "var(--g)",
                        borderRadius: 6,
                        padding: "6px 12px",
                        cursor: "pointer",
                      }}
                    >
                      <Download className="h-3.5 w-3.5" />
                      XUẤT CSV
                    </button>
                  </div>
                </div>

                {/* Explanatory Note for Điểm PORI */}
                <div
                  className="salx-sub px-3 py-2 text-xs"
                  style={{
                    borderColor: showPoriGuide ? "var(--g)" : "var(--bd-soft)",
                    color: "var(--mut)",
                    lineHeight: 1.5,
                  }}
                >
                  <strong style={{ color: "var(--g)", fontFamily: MONO }}>GHI CHÚ ĐIỂM PORI (0–100):</strong>{" "}
                  Thang điểm tổng hợp sức mạnh cổ phiếu theo 4 nhóm yếu tố (<strong>Xu hướng & Động lượng 35%</strong>,{" "}
                  <strong>Thanh khoản & Sổ lệnh 25%</strong>, <strong>Khối ngoại 15%</strong>,{" "}
                  <strong>Cơ bản Doanh nghiệp 25%</strong>), chuẩn hóa phân vị trên toàn bộ 55 cổ phiếu dẫn dắt HOSE.
                  {showPoriGuide && (
                    <span style={{ display: "block", marginTop: 4, color: "var(--ink)" }}>
                      • Cách đọc nhanh: <strong>≥ 75 điểm</strong> là cổ phiếu dẫn dắt xu hướng & thanh khoản nổi bật;{" "}
                      <strong>50–74 điểm</strong> là trung tính/tích lũy; <strong>&lt; 50 điểm</strong> là yếu hơn mặt bằng chung.{" "}
                      Toàn bộ dữ liệu được cắt nhiễu ngoại lệ (Winsorization 2.5%–97.5%) và không gán 0 điểm nếu thiếu BCTC.
                    </span>
                  )}
                </div>
              </div>

              <div className="salx-card overflow-hidden">
                <div className="max-h-[620px] overflow-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 10,
                        background: "var(--surf2)",
                        borderBottom: "1px solid var(--bd-mid)",
                        fontFamily: MONO,
                        fontSize: 10,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        color: "var(--mut)",
                      }}
                    >
                      <tr>
                        <th className="px-3 py-3 text-center">#</th>
                        <th className="px-3 py-3">Mã CK</th>
                        <th className="px-2 py-3">Ngành</th>
                        <th className="px-2 py-3 text-right">Giá (VNĐ)</th>
                        <th className="px-2 py-3 text-right">Biến động 20P</th>
                        <th className="px-2 py-3 text-center">Xu hướng / TK</th>
                        <th className="px-2 py-3 text-center">Điểm PORI</th>
                        <th className="px-2 py-3 text-center">Phù hợp DM</th>
                        <th className="px-3 py-3 text-right">Mô phỏng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDiscovery.map((item, idx) => {
                        const isSel = selectedStock?.symbol === item.symbol;
                        const fit = portfolioFitBySymbol[item.symbol];
                        const inPort = (positions[item.symbol] || 0) > 0;
                        return (
                          <tr
                            key={item.symbol}
                            onClick={() => setSelectedStock(item)}
                            style={{
                              borderBottom: "1px solid var(--bd-soft)",
                              background: isSel ? "var(--gb)" : "transparent",
                              cursor: "pointer",
                            }}
                          >
                            <td className="px-3 py-2.5 text-center font-mono-num" style={{ color: "var(--mut)" }}>
                              {idx + 1}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono-num text-sm font-extrabold" style={{ color: "var(--ink)" }}>
                                  {item.symbol}
                                </span>
                                {inPort && (
                                  <span
                                    style={{
                                      fontFamily: MONO,
                                      fontSize: 9,
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: "rgba(251,191,36,0.14)",
                                      color: "var(--gold)",
                                      border: "1px solid rgba(251,191,36,0.3)",
                                    }}
                                  >
                                    ĐANG GIỮ
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2.5" style={{ color: "var(--mut)" }}>
                              {vnSectorName(item.sector)}
                            </td>
                            <td className="px-2 py-2.5 text-right font-mono-num font-semibold">
                              {item.close_price.toLocaleString("vi-VN")}
                            </td>
                            <td
                              className="px-2 py-2.5 text-right font-mono-num font-bold"
                              style={{ color: item.rs_20d >= 0 ? "var(--g)" : "var(--avax)" }}
                            >
                              {item.rs_20d >= 0 ? "+" : ""}
                              {(item.rs_20d * 100).toFixed(1)}%
                            </td>
                            <td className="px-2 py-2.5 text-center font-mono-num text-[11px]">
                              <span style={{ color: "var(--cyan)" }}>{item.trend_score}</span> /{" "}
                              <span style={{ color: "var(--g)" }}>{item.liquidity_score}</span>
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <span
                                className="font-mono-num"
                                style={{
                                  display: "inline-block",
                                  padding: "2px 8px",
                                  borderRadius: 5,
                                  background: "var(--g)",
                                  color: "var(--g-contrast)",
                                  fontWeight: 800,
                                }}
                              >
                                {item.alpha_score ?? "N/A"}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              {fit ? (
                                <span
                                  className="font-mono-num"
                                  style={{
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: 5,
                                    border: "1px solid var(--gd)",
                                    background: "var(--gb)",
                                    color: "var(--g)",
                                    fontWeight: 700,
                                  }}
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
                                style={{
                                  fontFamily: MONO,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "4px 8px",
                                  borderRadius: 5,
                                  background: "var(--surf2)",
                                  border: "1px solid var(--bd-mid)",
                                  color: "var(--ink)",
                                  cursor: "pointer",
                                }}
                              >
                                + MÔ PHỎNG ↗
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
                <div className="salx-card sticky top-24 space-y-4 p-5">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      paddingBottom: 12,
                      borderBottom: "1px solid var(--bd)",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: ".1em",
                          textTransform: "uppercase",
                          color: "var(--g)",
                        }}
                      >
                        HỒ SƠ 360° / {vnSectorName(selectedStock.sector).toUpperCase()}
                      </span>
                      <h3
                        style={{
                          fontFamily: DISPLAY,
                          fontSize: 26,
                          fontWeight: 800,
                          margin: "4px 0 0",
                          color: "var(--ink)",
                        }}
                      >
                        {selectedStock.symbol}{" "}
                        <span className="font-mono-num" style={{ fontSize: 17, color: "var(--cyan)" }}>
                          {selectedStock.close_price.toLocaleString("vi-VN")} đ
                        </span>
                      </h3>
                    </div>

                    <div className="flex gap-2">
                      <div className="salx-sub px-2.5 py-1.5 text-center" title="Điểm PORI (0–100): Chấm theo 4 trụ cột Xu hướng, Thanh khoản, Khối ngoại & Cơ bản">
                        <div style={{ fontFamily: MONO, fontSize: 8.5, color: "var(--mut)" }}>ĐIỂM PORI</div>
                        <div className="font-mono-num" style={{ fontSize: 17, fontWeight: 800, color: "var(--g)" }}>
                          {selectedStock.alpha_score}
                        </div>
                      </div>
                      {selectedFit && (
                        <div className="salx-sub px-2.5 py-1.5 text-center" title="Độ phù hợp khi thêm vào danh mục hiện tại">
                          <div style={{ fontFamily: MONO, fontSize: 8.5, color: "var(--mut)" }}>PHÙ HỢP DM</div>
                          <div className="font-mono-num" style={{ fontSize: 17, fontWeight: 800, color: "var(--cyan)" }}>
                            {selectedFit.portfolio_fit_score}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedSeries && (
                    <div className="salx-sub p-3">
                      <StockMiniChart
                        symbol={selectedStock.symbol}
                        dates={selectedSeries.dates_60d}
                        closes={selectedSeries.closes_60d}
                        ma20={selectedSeries.ma20_60d}
                        dark={darkMode}
                      />
                    </div>
                  )}

                  <div className="salx-sub space-y-2.5 p-3.5 text-xs">
                    <div className="flex justify-between" style={{ fontFamily: MONO, fontSize: 10 }}>
                      <span style={{ fontWeight: 700 }}>CẤU THÀNH 4 TRỤ CỘT ĐIỂM PORI</span>
                      <span style={{ color: "var(--g)" }}>
                        ĐỘ ĐẦY ĐỦ: {Math.round(selectedStock.data_completeness * 100)}%
                      </span>
                    </div>
                    {[
                      { label: "1. Xu hướng & Động lượng giá (35%)", val: selectedStock.trend_score, col: "var(--g)" },
                      { label: "2. Thanh khoản & Chất lượng sổ lệnh (25%)", val: selectedStock.liquidity_score, col: "var(--cyan)" },
                      { label: "3. Dòng tiền Khối ngoại (15%)", val: selectedStock.foreign_score, col: "#A855F7" },
                      { label: "4. Chất lượng Cơ bản Doanh nghiệp (25%)", val: selectedStock.fundamental_score, col: "var(--org)" },
                    ].map((c) => (
                      <div key={c.label}>
                        <div className="mb-1 flex justify-between">
                          <span style={{ color: "var(--mut)" }}>{c.label}</span>
                          <span className="font-mono-num font-bold">
                            {c.val !== null ? `${c.val} / 100` : "Gắn cờ thiếu (Không gán 0)"}
                          </span>
                        </div>
                        <div style={{ height: 5, borderRadius: 99, background: "var(--bd)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${c.val ?? 0}%`, background: c.col }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: "var(--g)" }}>
                      VÌ SAO CỔ PHIẾU NÀY XUẤT HIỆN TRONG DANH SÁCH?
                    </div>
                    {selectedStock.reasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--g)" }} />
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2 pt-2" style={{ borderTop: "1px solid var(--bd)" }}>
                    <div className="flex items-center gap-1.5" style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700 }}>
                      <BookOpen className="h-3.5 w-3.5" style={{ color: "var(--cyan)" }} />
                      TÀI LIỆU & BCTC GỐC ({selectedStock.symbol})
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {[
                        {
                          name: "CafeF BCTC",
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
                          className="salx-sub inline-flex items-center gap-1 px-2.5 py-1 font-semibold hover:border-[var(--g)]"
                          style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--cyan)" }}
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
                      style={{
                        fontFamily: MONO,
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: "9px 12px",
                        borderRadius: 8,
                        background: "var(--g)",
                        color: "var(--g-contrast)",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      MÔ PHỎNG MUA THÊM ↗
                    </button>
                    <button
                      onClick={() => {
                        setObSymbol(selectedStock.symbol);
                        setActiveTab("orderbook");
                      }}
                      style={{
                        fontFamily: MONO,
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: "9px 12px",
                        borderRadius: 8,
                        background: "var(--surf2)",
                        color: "var(--ink)",
                        border: "1px solid var(--bd-mid)",
                        cursor: "pointer",
                      }}
                    >
                      XEM SỔ LỆNH 3 BƯỚC ↗
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
          <div className="space-y-6">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
              }}
            >
              <StatCard
                label="TỔNG NAV & ĐỆM TIỀN MẶT"
                value={fmtVnd(activeHealth.total_nav_vnd)}
                sub={`Tiền mặt: ${fmtVnd(activeHealth.cash_vnd)} (${(activeHealth.cash_weight * 100).toFixed(1)}% NAV)`}
                accent
              />
              <StatCard
                label="ĐỘ TẬP TRUNG (HHI MÃ / NGÀNH)"
                value={`${activeHealth.hhi_stock.toFixed(3)} / ${activeHealth.hhi_sector.toFixed(3)}`}
                sub={`Số vị thế hiệu dụng (N_eff): ${activeHealth.n_effective_stock} mã`}
              />
              <StatCard
                label="VaR LỊCH SỬ 95% & ES 95% (1 NGÀY)"
                value={`-${fmtVnd(activeHealth.hist_var_95_vnd)}`}
                sub={`(${(activeHealth.hist_var_95_pct * 100).toFixed(2)}% NAV) • ES 95%: -${fmtVnd(activeHealth.hist_es_95_vnd)}`}
                danger
              />
              <StatCard
                label="CHỈ SỐ AN TOÀN & BETA DANH MỤC"
                value={activeHealth.health_score}
                unit="/ 100"
                sub={`Beta vs VNINDEX: ${activeHealth.portfolio_beta} • Biến động năm: ${(activeHealth.annualized_vol_pct * 100).toFixed(1)}%`}
                accent
              />
            </div>

            {/* Interactive Portfolio Editor */}
            <div className="salx-card p-5">
              <SectionLabel
                right={
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        setPositions({});
                        setPortfolioMsg("Đã xóa các cổ phiếu — Danh mục đang ở chế độ 100% Tiền mặt để bạn tự nhập lại.");
                        pushSimulationLog("UPDATE_PORTFOLIO", "Đưa danh mục về 100% tiền mặt để thiết lập mới");
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontFamily: MONO,
                        fontSize: 10,
                        padding: "5px 10px",
                        borderRadius: 6,
                        background: "var(--avax-bg)",
                        border: "1px solid var(--avax-bd)",
                        color: "var(--avax)",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                      BẮT ĐẦU TỪ TIỀN MẶT
                    </button>
                    <button
                      onClick={() => {
                        setPositions(bundle.default_portfolio.positions);
                        setCashVnd(bundle.default_portfolio.cash_vnd);
                        setPortfolioMsg("Đã khôi phục danh mục mẫu 5 mã.");
                      }}
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        padding: "5px 10px",
                        borderRadius: 6,
                        background: "var(--surf2)",
                        border: "1px solid var(--bd)",
                        cursor: "pointer",
                      }}
                    >
                      KHÔI PHỤC MẪU
                    </button>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "5px 10px",
                        borderRadius: 6,
                        background: "var(--gb)",
                        border: "1px solid var(--gd)",
                        color: "var(--g)",
                        cursor: "pointer",
                      }}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      TẢI CSV DANH MỤC
                      <input type="file" accept=".csv,.txt" onChange={handleCsvUpload} className="hidden" />
                    </label>
                  </div>
                }
              >
                DANH MỤC ĐANG NẮM GIỮ & ĐÓNG GÓP RỦI RO BIÊN (MARGINAL RISK)
              </SectionLabel>

              {Object.keys(positions).length === 0 ? (
                <div className="salx-sub p-4 text-xs" style={{ color: "var(--mut)" }}>
                  Danh mục hiện chưa nắm giữ mã cổ phiếu nào (100% tiền mặt). Bạn có thể thêm mã bên dưới theo{" "}
                  <strong style={{ color: "var(--ink)" }}>Số lượng CP (lô 100)</strong> hoặc{" "}
                  <strong style={{ color: "var(--ink)" }}>Số tiền VNĐ</strong>.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(positions).map(([sym, val]) => {
                    const weightPct =
                      activeHealth.total_nav_vnd > 0
                        ? ((val / activeHealth.total_nav_vnd) * 100).toFixed(1)
                        : "0.0";
                    const riskContrib = activeHealth.component_risk_pct?.[sym] ?? weightPct;
                    const dtl = activeHealth.days_to_liquidate[sym] ?? 0.2;
                    const px = discoveryMap[sym]?.close_price;
                    const approxShares = px && px > 0 ? Math.round(val / px) : null;
                    return (
                      <div
                        key={sym}
                        className="salx-sub inline-flex items-center gap-2.5 px-3 py-2 text-xs"
                      >
                        <span className="font-mono-num font-extrabold" style={{ color: "var(--g)" }}>
                          {sym}
                        </span>
                        <span className="font-mono-num font-semibold">
                          {fmtVnd(val)}
                          {approxShares !== null && (
                            <span style={{ color: "var(--mut)", fontSize: 10.5, marginLeft: 4 }}>
                              (~{approxShares.toLocaleString("vi-VN")} CP)
                            </span>
                          )}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mut)" }}>
                          Tỷ trọng: {weightPct}% •{" "}
                          <strong style={{ color: "var(--avax)" }}>Rủi ro biên: {riskContrib}%</strong> • Thanh khoản: {dtl}p
                        </span>
                        <button
                          onClick={() => {
                            const next = { ...positions };
                            delete next[sym];
                            setPositions(next);
                            setPortfolioMsg(`Đã xóa ${sym} khỏi danh mục.`);
                            pushSimulationLog("UPDATE_PORTFOLIO", `Xóa vị thế ${sym} khỏi danh mục`, sym);
                          }}
                          style={{ color: "var(--mut)", cursor: "pointer" }}
                          title="Xóa vị thế"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                className="mt-4 flex flex-wrap items-end gap-3 pt-3"
                style={{ borderTop: "1px solid var(--bd-soft)" }}
              >
                <div>
                  <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                    MÃ THÊM / CẬP NHẬT
                  </label>
                  <select
                    value={newPosSym}
                    onChange={(e) => setNewPosSym(e.target.value)}
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      background: "var(--surf2)",
                      border: "1px solid var(--bd)",
                      color: "var(--ink)",
                      borderRadius: 6,
                      padding: "6px 10px",
                    }}
                  >
                    {bundle.discovery.map((d) => (
                      <option key={d.symbol} value={d.symbol}>
                        {d.symbol} ({vnSectorName(d.sector)} • {d.close_price.toLocaleString("vi-VN")} đ)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                    CÁCH NHẬP VỊ THẾ
                  </label>
                  <div className="inline-flex rounded-md overflow-hidden" style={{ border: "1px solid var(--bd)" }}>
                    {[
                      { id: "SHARES", label: "SỐ CP (LÔ 100)" },
                      { id: "VND", label: "SỐ TIỀN (VNĐ)" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPosInputMode(m.id as "SHARES" | "VND")}
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "6px 10px",
                          border: "none",
                          cursor: "pointer",
                          background: posInputMode === m.id ? "var(--g)" : "var(--surf2)",
                          color: posInputMode === m.id ? "var(--g-contrast)" : "var(--mut)",
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {posInputMode === "SHARES" ? (
                  <div>
                    <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                      SỐ LƯỢNG CỔ PHIẾU (≈{" "}
                      {fmtVnd((newPosShares || 0) * (discoveryMap[newPosSym]?.close_price || 30000))})
                    </label>
                    <input
                      type="number"
                      step={100}
                      min={100}
                      value={newPosShares}
                      onChange={(e) => setNewPosShares(Math.max(100, Number(e.target.value)))}
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        background: "var(--surf2)",
                        border: "1px solid var(--bd)",
                        color: "var(--ink)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        width: 175,
                      }}
                    />
                  </div>
                ) : (
                  <div>
                    <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                      GIÁ TRỊ VỊ THẾ (VNĐ)
                    </label>
                    <input
                      type="number"
                      step={10_000_000}
                      value={newPosAmt}
                      onChange={(e) => setNewPosAmt(Number(e.target.value))}
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        background: "var(--surf2)",
                        border: "1px solid var(--bd)",
                        color: "var(--ink)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        width: 155,
                      }}
                    />
                  </div>
                )}

                <button
                  onClick={() => {
                    const price = discoveryMap[newPosSym]?.close_price || 30000;
                    const finalAmt =
                      posInputMode === "SHARES" ? Math.round(newPosShares * price) : Math.round(newPosAmt);
                    if (newPosSym && finalAmt > 0) {
                      setPositions({ ...positions, [newPosSym]: finalAmt });
                      const msg = `Đã cập nhật ${newPosSym} (${fmtVnd(finalAmt)}) và tính lại VaR/HHI tức thời!`;
                      setPortfolioMsg(msg);
                      pushSimulationLog("UPDATE_PORTFOLIO", msg, newPosSym, finalAmt);
                    }
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontFamily: MONO,
                    fontSize: 10.5,
                    fontWeight: 700,
                    background: "var(--g)",
                    color: "var(--g-contrast)",
                    border: "none",
                    borderRadius: 6,
                    padding: "7px 14px",
                    cursor: "pointer",
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  CẬP NHẬT VỊ THẾ
                </button>

                <div className="ml-auto">
                  <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                    TIỀN MẶT TRONG TÀI KHOẢN (VNĐ)
                  </label>
                  <input
                    type="number"
                    step={10_000_000}
                    value={cashVnd}
                    onChange={(e) => setCashVnd(Math.max(0, Number(e.target.value)))}
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      background: "var(--surf2)",
                      border: "1px solid var(--bd)",
                      color: "var(--ink)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      width: 155,
                    }}
                  />
                </div>
              </div>
              {portfolioMsg && (
                <p style={{ marginTop: 8, fontFamily: MONO, fontSize: 10.5, color: "var(--g)" }}>
                  {portfolioMsg}
                </p>
              )}
            </div>

            {/* CAPITAL-AWARE DIVERSIFICATION & SIZING ADVISOR */}
            {capitalAdvice && (
              <div className="salx-card p-5" style={{ borderColor: "var(--indigo-bd)" }}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Scale className="h-4 w-4" style={{ color: "var(--cyan)" }} />
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: "var(--cyan)",
                          letterSpacing: ".1em",
                        }}
                      >
                        CỐ VẤN CẤU TRÚC VỐN & NGƯỠNG ĐA DẠNG HÓA TỐI ƯU (HOSE LÔ 100 CP)
                      </span>
                    </div>
                    <h3 style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 800, margin: "4px 0 0" }}>
                      {capitalAdvice.tierTitle}
                    </h3>
                  </div>

                  {/* User chooses own capital */}
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                        NHẬP TỔNG VỐN BẢN THÂN CÓ (VNĐ)
                      </label>
                      <input
                        type="number"
                        step={10_000_000}
                        min={5_000_000}
                        value={targetCapitalVnd}
                        onChange={(e) => setTargetCapitalVnd(Math.max(5_000_000, Number(e.target.value)))}
                        style={{
                          fontFamily: MONO,
                          fontSize: 12,
                          fontWeight: 800,
                          background: "var(--surf2)",
                          border: "1px solid var(--gd)",
                          color: "var(--ink)",
                          borderRadius: 6,
                          padding: "6px 10px",
                          width: 170,
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[20_000_000, 40_000_000, 100_000_000, 250_000_000, 500_000_000, 1_000_000_000].map((cap) => (
                        <button
                          key={cap}
                          onClick={() => setTargetCapitalVnd(cap)}
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "6px 9px",
                            borderRadius: 6,
                            border: "1px solid var(--bd)",
                            background: targetCapitalVnd === cap ? "var(--g)" : "var(--surf2)",
                            color: targetCapitalVnd === cap ? "var(--g-contrast)" : "var(--mut)",
                            cursor: "pointer",
                          }}
                        >
                          {cap >= 1e9 ? `${cap / 1e9} TỶ` : `${cap / 1e6} TR`}
                        </button>
                      ))}
                      <button
                        onClick={() => setTargetCapitalVnd(Math.max(10_000_000, activeHealth.total_nav_vnd))}
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "6px 9px",
                          borderRadius: 6,
                          border: "1px solid var(--gd)",
                          background: "var(--gb)",
                          color: "var(--g)",
                          cursor: "pointer",
                        }}
                        title="Đồng bộ theo Tổng NAV danh mục phía trên"
                      >
                        THEO NAV HIỆN TẠI
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-12">
                  <div className="lg:col-span-7 space-y-3">
                    <div
                      className="salx-sub p-3.5"
                      style={{
                        borderColor: capitalAdvice.shouldDiversifyMore ? "var(--gd)" : "var(--org)",
                        background: "var(--surf2)",
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            fontWeight: 800,
                            padding: "3px 9px",
                            borderRadius: 99,
                            background: capitalAdvice.shouldDiversifyMore ? "var(--gb)" : "rgba(245,158,11,0.16)",
                            color: capitalAdvice.shouldDiversifyMore ? "var(--g)" : "var(--org)",
                            border: `1px solid ${capitalAdvice.shouldDiversifyMore ? "var(--gd)" : "rgba(245,158,11,0.4)"}`,
                          }}
                        >
                          {capitalAdvice.verdictBadge}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)" }}>
                          Đang giữ: <strong style={{ color: "var(--ink)" }}>{capitalAdvice.currentCount} mã</strong> • Đề xuất:{" "}
                          <strong style={{ color: "var(--g)" }}>{capitalAdvice.recommendedCountLabel}</strong>
                        </span>
                      </div>

                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", marginTop: 6 }}>
                        {capitalAdvice.headline}
                      </div>
                      <p style={{ fontSize: 12.5, color: "var(--mut)", marginTop: 6, marginBottom: 0, lineHeight: 1.55 }}>
                        {capitalAdvice.rationale}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 text-center">
                      <div className="salx-sub p-2.5">
                        <div style={{ fontFamily: MONO, fontSize: 9, color: "var(--mut)" }}>SỐ MÃ KHUYẾN NGHỊ</div>
                        <div className="font-mono-num mt-1 text-xs font-extrabold" style={{ color: "var(--g)" }}>
                          {capitalAdvice.tier === "SMALL"
                            ? "1 – 2 MÃ"
                            : capitalAdvice.tier === "MEDIUM"
                            ? "2 – 4 MÃ"
                            : "4 – 7 MÃ"}
                        </div>
                      </div>
                      <div className="salx-sub p-2.5">
                        <div style={{ fontFamily: MONO, fontSize: 9, color: "var(--mut)" }}>TỐI THIỂU / VỊ THẾ</div>
                        <div className="font-mono-num mt-1 text-xs font-extrabold" style={{ color: "var(--ink)" }}>
                          ~{(capitalAdvice.minPosSizeVnd / 1e6).toFixed(0)} TRIỆU
                        </div>
                      </div>
                      <div className="salx-sub p-2.5">
                        <div style={{ fontFamily: MONO, fontSize: 9, color: "var(--mut)" }}>ĐỆM TIỀN MẶT ĐỀ XUẤT</div>
                        <div className="font-mono-num mt-1 text-xs font-extrabold" style={{ color: "var(--cyan)" }}>
                          {capitalAdvice.recommendedCashPct}% VỐN
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      {capitalAdvice.actionChecklist.map((act, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--g)" }} />
                          <span style={{ color: "var(--ink)" }}>{act}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-5 space-y-2.5">
                    <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: "var(--mut)" }}>
                      GỢI Ý PHÂN BỔ PHÙ HỢP VỚI QUY MÔ VỐN ({fmtVnd(capitalAdvice.capitalVnd)})
                    </div>
                    {capitalAdvice.suggestedCandidates.map((cand) => (
                      <div key={cand.symbol} className="salx-sub p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono-num text-sm font-extrabold" style={{ color: "var(--g)" }}>
                              {cand.symbol}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--mut)" }}>{cand.sector}</span>
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 10.5 }}>
                            PORI: <strong style={{ color: "var(--g)" }}>{cand.poriScore}</strong> • Phù hợp:{" "}
                            <strong style={{ color: "var(--cyan)" }}>{cand.fitScore}</strong>
                          </div>
                        </div>
                        <p style={{ margin: 0, fontSize: 11.5, color: "var(--mut)" }}>{cand.reason}</p>
                        <div className="flex items-center justify-between pt-1">
                          <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--ink)" }}>
                            Gợi ý giải ngân: <strong>{fmtVnd(cand.suggestedAmountVnd)}</strong>
                          </span>
                          <button
                            onClick={() => {
                              setWhatIfSymbol(cand.symbol);
                              setWhatIfAmount(cand.suggestedAmountVnd);
                              pushSimulationLog(
                                "CAPITAL_PLAN",
                                `Áp dụng gợi ý vốn ${(capitalAdvice.capitalVnd / 1e6).toFixed(0)}tr: thử ${cand.symbol} (${fmtVnd(cand.suggestedAmountVnd)})`,
                                cand.symbol,
                                cand.suggestedAmountVnd
                              );
                            }}
                            style={{
                              fontFamily: MONO,
                              fontSize: 9.5,
                              fontWeight: 700,
                              padding: "4px 9px",
                              borderRadius: 5,
                              border: "1px solid var(--gd)",
                              background: "var(--gb)",
                              color: "var(--g)",
                              cursor: "pointer",
                            }}
                          >
                            MÔ PHỎNG MÃ NÀY ↓
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 5-DIMENSION BEFORE vs AFTER WHAT-IF SIMULATOR */}
            <div className="salx-card p-5" style={{ borderColor: "var(--gd)" }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: "var(--g)", letterSpacing: ".1em" }}>
                    MÔ PHỎNG TÁC ĐỘNG PHÂN BỔ DANH MỤC • ĐỐI CHIẾU 5 CHIỀU TRƯỚC & SAU
                  </span>
                  <h3 style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 800, margin: "4px 0 0" }}>
                    Đánh Giá Rủi Ro Biên Khi Bổ Sung Cổ Phiếu Mới
                  </h3>
                </div>

                <div className="flex flex-wrap items-end gap-2.5">
                  <div>
                    <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                      CỔ PHIẾU DỰ KIẾN MUA
                    </label>
                    <select
                      value={whatIfSymbol}
                      onChange={(e) => setWhatIfSymbol(e.target.value)}
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        fontWeight: 700,
                        background: "var(--surf2)",
                        border: "1px solid var(--gd)",
                        color: "var(--ink)",
                        borderRadius: 6,
                        padding: "6px 10px",
                      }}
                    >
                      {bundle.discovery.map((d) => (
                        <option key={d.symbol} value={d.symbol}>
                          {d.symbol} — {vnSectorName(d.sector)} (PORI: {d.alpha_score})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                      SỐ TIỀN GIẢI NGÂN (VNĐ)
                    </label>
                    <input
                      type="number"
                      step={10_000_000}
                      value={whatIfAmount}
                      onChange={(e) => setWhatIfAmount(Math.max(5_000_000, Number(e.target.value)))}
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        fontWeight: 700,
                        background: "var(--surf2)",
                        border: "1px solid var(--gd)",
                        color: "var(--ink)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        width: 155,
                      }}
                    />
                  </div>
                  <div className="flex gap-1">
                    {[20_000_000, 50_000_000, 100_000_000, 200_000_000].map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setWhatIfAmount(amt)}
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "6px 9px",
                          borderRadius: 6,
                          border: "1px solid var(--bd)",
                          background: whatIfAmount === amt ? "var(--g)" : "var(--surf2)",
                          color: whatIfAmount === amt ? "var(--g-contrast)" : "var(--mut)",
                          cursor: "pointer",
                        }}
                      >
                        +{amt / 1e6}TR
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {activeWhatIf && (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>
                        1. TỶ TRỌNG NGÀNH ({activeWhatIf.candidate_sector})
                      </div>
                      <div className="font-mono-num mt-1 text-lg font-extrabold" style={{ color: "var(--cyan)" }}>
                        {activeWhatIf.sector_weight_before ?? 0}% → {activeWhatIf.sector_weight_after ?? 0}%
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)", marginTop: 4 }}>
                        HHI Ngành: {activeWhatIf.hhi_sector_before.toFixed(3)} → {activeWhatIf.hhi_sector_after.toFixed(3)}
                      </div>
                    </div>

                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>
                        2. ĐỘ TẬP TRUNG HHI MÃ
                      </div>
                      <div
                        className="font-mono-num mt-1 text-lg font-extrabold"
                        style={{ color: activeWhatIf.delta_hhi_stock <= 0 ? "var(--g)" : "var(--org)" }}
                      >
                        {activeWhatIf.hhi_stock_before.toFixed(3)} → {activeWhatIf.hhi_stock_after.toFixed(3)}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)", marginTop: 4 }}>
                        ΔHHI: {activeWhatIf.delta_hhi_stock >= 0 ? "+" : ""}
                        {activeWhatIf.delta_hhi_stock.toFixed(4)}
                      </div>
                    </div>

                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>
                        3. THAY ĐỔI VaR 95% (ΔVaR)
                      </div>
                      <div
                        className="font-mono-num mt-1 text-lg font-extrabold"
                        style={{ color: activeWhatIf.delta_var_pct <= 0 ? "var(--g)" : "var(--avax)" }}
                      >
                        {activeWhatIf.delta_var_vnd >= 0 ? "+" : ""}
                        {fmtVnd(activeWhatIf.delta_var_vnd)}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)", marginTop: 4 }}>
                        {fmtVnd(activeWhatIf.var_95_before_vnd)} → {fmtVnd(activeWhatIf.var_95_after_vnd)}
                      </div>
                    </div>

                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>
                        4. TƯƠNG QUAN DANH MỤC
                      </div>
                      <div className="font-mono-num mt-1 text-lg font-extrabold">
                        ρ_TB = {activeWhatIf.avg_corr_with_portfolio}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)", marginTop: 4 }}>
                        {activeWhatIf.pairwise_corr &&
                          Object.entries(activeWhatIf.pairwise_corr)
                            .slice(0, 3)
                            .map(([k, v]) => `${k}:${v}`)
                            .join(" • ")}
                      </div>
                    </div>

                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>
                        5. THANH KHOẢN & ĐỘ PHÙ HỢP
                      </div>
                      <div className="font-mono-num mt-1 text-lg font-extrabold" style={{ color: "var(--g)" }}>
                        {activeWhatIf.portfolio_fit_score} / 100
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)", marginTop: 4 }}>
                        Thời gian thanh khoản: <strong>{activeWhatIf.candidate_dtl_days ?? 0.2} phiên</strong>
                      </div>
                    </div>
                  </div>

                  <div
                    className="salx-sub flex flex-wrap items-center justify-between gap-3 p-3.5 text-xs"
                    style={{ borderColor: "var(--gd)" }}
                  >
                    <div style={{ flex: "1 1 360px" }}>
                      <strong style={{ color: "var(--g)", fontFamily: MONO }}>LUẬN GIẢI TÁC ĐỘNG:</strong>{" "}
                      {activeWhatIf.explanation}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => {
                          const msg = `Kịch bản thử: +${fmtVnd(activeWhatIf.add_amount_vnd)} ${activeWhatIf.candidate_symbol} • Phù hợp ${activeWhatIf.portfolio_fit_score}/100 • ΔVaR ${activeWhatIf.delta_var_vnd >= 0 ? "+" : ""}${fmtVnd(activeWhatIf.delta_var_vnd)}`;
                          pushSimulationLog("WHAT_IF_SIM", msg, activeWhatIf.candidate_symbol, activeWhatIf.add_amount_vnd);
                          setPortfolioMsg(
                            authUser
                              ? `Đã lưu kịch bản ${activeWhatIf.candidate_symbol} vào nhật ký tài khoản ${authUser.email}!`
                              : "Đã ghi nhận kịch bản vào nhật ký tạm trên máy (Đăng nhập Email để lưu đồng bộ đa thiết bị)."
                          );
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          background: "var(--surf)",
                          color: "var(--g)",
                          border: "1px solid var(--gd)",
                          borderRadius: 6,
                          padding: "7px 11px",
                          cursor: "pointer",
                        }}
                      >
                        <Save className="h-3.5 w-3.5" />
                        LƯU KỊCH BẢN NÀY
                      </button>
                      <button
                        onClick={() => {
                          setPositions({
                            ...positions,
                            [activeWhatIf.candidate_symbol]:
                              (positions[activeWhatIf.candidate_symbol] || 0) + activeWhatIf.add_amount_vnd,
                          });
                          const msg = `Áp dụng mua thêm ${fmtVnd(activeWhatIf.add_amount_vnd)} vào ${activeWhatIf.candidate_symbol}`;
                          setPortfolioMsg(msg);
                          pushSimulationLog("APPLY_POSITION", msg, activeWhatIf.candidate_symbol, activeWhatIf.add_amount_vnd);
                        }}
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          background: "var(--g)",
                          color: "var(--g-contrast)",
                          border: "none",
                          borderRadius: 6,
                          padding: "7px 12px",
                          cursor: "pointer",
                        }}
                      >
                        ÁP DỤNG VÀO DANH MỤC ↗
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* SIMULATION & TASK HISTORY LOG (SYNCED TO EMAIL ACCOUNT WHEN LOGGED IN) */}
            <div className="salx-card p-5">
              <SectionLabel
                right={
                  <div className="flex items-center gap-2">
                    <span style={{ fontFamily: MONO, fontSize: 10, color: authUser ? "var(--g)" : "var(--mut)" }}>
                      {authUser
                        ? `ĐỒNG BỘ ĐÁM MÂY: ${authUser.email}`
                        : "ĐANG LƯU TẠM TRÊN TRÌNH DUYỆT"}
                    </span>
                    {!authUser && (
                      <button
                        onClick={() => setAuthModalOpen(true)}
                        style={{
                          fontFamily: MONO,
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: 5,
                          border: "1px solid var(--gd)",
                          background: "var(--gb)",
                          color: "var(--g)",
                          cursor: "pointer",
                        }}
                      >
                        ĐĂNG NHẬP EMAIL ĐỂ LƯU VĨNH VIỄN ↗
                      </button>
                    )}
                  </div>
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" style={{ color: "var(--g)" }} />
                  NHẬT KÝ TÁC VỤ & LỊCH SỬ MÔ PHỎNG ĐÃ LƯU ({simulations.length})
                </span>
              </SectionLabel>

              {simulations.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
                  Chưa có kịch bản nào được ghi lại. Hãy bấm <strong>“Lưu kịch bản này”</strong> hoặc cập nhật danh mục để lưu lại các phương án bạn đã thử.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {simulations.slice(0, 9).map((s) => (
                    <div key={s.id} className="salx-sub p-2.5 text-xs flex items-start justify-between gap-2">
                      <div>
                        <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--g)", fontWeight: 700 }}>
                          [{s.createdAt}] •{" "}
                          {s.actionType === "WHAT_IF_SIM"
                            ? "KỊCH BẢN THỬ"
                            : s.actionType === "APPLY_POSITION"
                            ? "ÁP DỤNG MUA"
                            : s.actionType === "CAPITAL_PLAN"
                            ? "CỐ VẤN VỐN"
                            : "SỬA DANH MỤC"}
                        </div>
                        <div style={{ marginTop: 3, color: "var(--ink)", fontSize: 11.5 }}>{s.summary}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-5 lg:grid-cols-12">
              <div className="salx-card p-5 lg:col-span-5">
                <SectionLabel>PHÂN PHỐI LỢI SUẤT NGÀY (130 PHIÊN) & STRESS-TEST ĐA CHIỀU</SectionLabel>
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
                    <div key={scen} className="salx-sub p-2.5">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>{scen}</div>
                      <div className="font-mono-num mt-1 font-bold" style={{ color: "var(--avax)" }}>
                        {fmtVnd(loss)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="salx-card p-5 lg:col-span-3">
                <SectionLabel>CƠ CẤU TỶ TRỌNG NGÀNH</SectionLabel>
                <div className="space-y-3">
                  {Object.entries(activeHealth.sector_weights)
                    .sort((a, b) => b[1] - a[1])
                    .map(([sec, w]) => (
                      <div key={sec} className="text-xs">
                        <div className="mb-1 flex justify-between font-semibold">
                          <span>{vnSectorName(sec)}</span>
                          <span className="font-mono-num">{(w * 100).toFixed(1)}%</span>
                        </div>
                        <div style={{ height: 7, borderRadius: 99, background: "var(--bd)", overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${w * 100}%`,
                              background: w > 0.45 ? "var(--avax)" : "var(--g)",
                              borderRadius: 99,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="salx-card p-5 lg:col-span-4">
                <SectionLabel>MA TRẬN TƯƠNG QUAN LỢI SUẤT (HEATMAP)</SectionLabel>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-center text-xs">
                    <thead>
                      <tr style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)" }}>
                        <th className="p-1.5 text-left">MÃ</th>
                        {Object.keys(activeHealth.correlation_matrix).map((c) => (
                          <th key={c} className="p-1.5">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(activeHealth.correlation_matrix).map(([rSym, cols]) => (
                        <tr key={rSym} style={{ borderTop: "1px solid var(--bd-soft)" }}>
                          <td className="p-1.5 text-left font-mono-num font-bold">{rSym}</td>
                          {Object.entries(cols).map(([cSym, val]) => {
                            const isSelf = rSym === cSym;
                            const bg = isSelf
                              ? "var(--surf2)"
                              : val >= 0.65
                              ? "var(--avax-bg)"
                              : val <= 0.35
                              ? "var(--gb)"
                              : "transparent";
                            const col = isSelf
                              ? "var(--mut)"
                              : val >= 0.65
                              ? "var(--avax)"
                              : val <= 0.35
                              ? "var(--g)"
                              : "var(--ink)";
                            return (
                              <td
                                key={cSym}
                                className="p-1.5 font-mono-num font-semibold"
                                style={{ background: bg, color: col }}
                              >
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
            <div className="salx-card space-y-4 p-5 lg:col-span-5">
              <SectionLabel>MÔ PHỎNG KHỚP LỆNH QUA 3 BƯỚC GIÁ BID / ASK</SectionLabel>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                    MÃ CỔ PHIẾU
                  </label>
                  <select
                    value={obSymbol}
                    onChange={(e) => setObSymbol(e.target.value)}
                    style={{
                      width: "100%",
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 700,
                      background: "var(--surf2)",
                      border: "1px solid var(--bd)",
                      color: "var(--ink)",
                      borderRadius: 6,
                      padding: "8px 10px",
                    }}
                  >
                    {bundle.discovery.map((d) => (
                      <option key={d.symbol} value={d.symbol}>
                        {d.symbol} — {d.close_price.toLocaleString("vi-VN")} đ
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                    CHIỀU GIAO DỊCH
                  </label>
                  <select
                    value={obSide}
                    onChange={(e) => setObSide(e.target.value as "buy" | "sell")}
                    style={{
                      width: "100%",
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 700,
                      background: "var(--surf2)",
                      border: "1px solid var(--bd)",
                      color: "var(--ink)",
                      borderRadius: 6,
                      padding: "8px 10px",
                    }}
                  >
                    <option value="buy">MUA CHỦ ĐỘNG (QUÉT ASK 1→3)</option>
                    <option value="sell">BÁN CHỦ ĐỘNG (QUÉT BID 1→3)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: "var(--mut)", marginBottom: 4 }}>
                  QUY MÔ VỊ THẾ DỰ KIẾN (VNĐ)
                </label>
                <input
                  type="number"
                  step={50_000_000}
                  value={obAmount}
                  onChange={(e) => setObAmount(Math.max(10_000_000, Number(e.target.value)))}
                  style={{
                    width: "100%",
                    fontFamily: MONO,
                    fontSize: 13,
                    fontWeight: 700,
                    background: "var(--surf2)",
                    border: "1px solid var(--bd)",
                    color: "var(--ink)",
                    borderRadius: 6,
                    padding: "8px 12px",
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[50_000_000, 200_000_000, 500_000_000, 1_500_000_000, 3_000_000_000].map((v) => (
                    <button
                      key={v}
                      onClick={() => setObAmount(v)}
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "5px 10px",
                        borderRadius: 5,
                        border: "1px solid var(--bd)",
                        background: obAmount === v ? "var(--g)" : "var(--surf2)",
                        color: obAmount === v ? "var(--g-contrast)" : "var(--mut)",
                        cursor: "pointer",
                      }}
                    >
                      {v >= 1e9 ? `${v / 1e9} TỶ` : `${v / 1e6} TR`}
                    </button>
                  ))}
                </div>
              </div>

              {activeOrderBookEval && (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>
                        1. MẤT CÂN BẰNG OBI (3 MỨC)
                      </div>
                      <div
                        className="font-mono-num mt-1 text-xl font-extrabold"
                        style={{ color: activeOrderBookEval.eval.obi_3_levels >= 0 ? "var(--g)" : "var(--avax)" }}
                      >
                        {activeOrderBookEval.eval.obi_3_levels >= 0 ? "+" : ""}
                        {(activeOrderBookEval.eval.obi_3_levels * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>
                        2. CHÊNH LỆCH MUA - BÁN (%)
                      </div>
                      <div className="font-mono-num mt-1 text-xl font-extrabold">
                        {activeOrderBookEval.eval.spread_pct.toFixed(2)}%
                      </div>
                    </div>
                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>
                        3. GIÁ KHỚP BQ ƯỚC TÍNH
                      </div>
                      <div className="font-mono-num mt-1 text-xl font-extrabold" style={{ color: "var(--cyan)" }}>
                        {activeOrderBookEval.eval.estimated_avg_price.toLocaleString("vi-VN")} đ
                      </div>
                    </div>
                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>
                        4. ĐỘ TRƯỢT GIÁ SỔ LỆNH
                      </div>
                      <div className="font-mono-num mt-1 text-xl font-extrabold" style={{ color: "var(--avax)" }}>
                        +{activeOrderBookEval.eval.estimated_cost_pct.toFixed(3)}%
                      </div>
                    </div>
                  </div>

                  <div
                    className="salx-sub p-3.5 text-xs"
                    style={{
                      borderColor: activeOrderBookEval.eval.sufficient_depth ? "var(--gd)" : "var(--avax-bd)",
                      background: activeOrderBookEval.eval.sufficient_depth ? "var(--gb)" : "var(--avax-bg)",
                    }}
                  >
                    {activeOrderBookEval.eval.note}
                  </div>
                </div>
              )}
            </div>

            <div className="salx-card p-5 lg:col-span-7">
              {activeOrderBookEval ? (
                <div className="space-y-4">
                  <SectionLabel
                    right={
                      <span style={{ fontFamily: MONO, fontSize: 10 }}>
                        CẦU 3 MỨC: <strong style={{ color: "var(--g)" }}>{fmtVnd(activeOrderBookEval.eval.total_bid_value_3l)}</strong> • CUNG 3 MỨC:{" "}
                        <strong style={{ color: "var(--avax)" }}>{fmtVnd(activeOrderBookEval.eval.total_ask_value_3l)}</strong>
                      </span>
                    }
                  >
                    THANG ĐỘ SÂU SỔ LỆNH 3 BƯỚC GIÁ ({obSymbol})
                  </SectionLabel>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: "var(--g)" }}>
                        BÊN ĐẶT MUA (BID 1 → BID 3)
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
                          <div key={i} className="salx-sub p-2.5">
                            <div className="flex justify-between text-xs font-bold">
                              <span>Bid {i + 1}</span>
                              <span className="font-mono-num" style={{ color: "var(--g)" }}>
                                {p.toLocaleString("vi-VN")} đ
                              </span>
                              <span className="font-mono-num">{v.toLocaleString("vi-VN")} CP</span>
                            </div>
                            <div style={{ marginTop: 6, height: 6, borderRadius: 99, background: "var(--bd)", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${(v / maxV) * 100}%`, background: "var(--g)" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-2">
                      <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: "var(--avax)" }}>
                        BÊN ĐẶT BÁN (ASK 1 → ASK 3)
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
                          <div key={i} className="salx-sub p-2.5">
                            <div className="flex justify-between text-xs font-bold">
                              <span>Ask {i + 1}</span>
                              <span className="font-mono-num" style={{ color: "var(--avax)" }}>
                                {p.toLocaleString("vi-VN")} đ
                              </span>
                              <span className="font-mono-num">{v.toLocaleString("vi-VN")} CP</span>
                            </div>
                            <div style={{ marginTop: 6, height: 6, borderRadius: 99, background: "var(--bd)", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${(v / maxV) * 100}%`, background: "var(--avax)" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-2">
                    <SectionLabel>CHI TIẾT KHỚP LỆNH MÔ PHỎNG TỪNG BƯỚC GIÁ</SectionLabel>
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="salx-sub" style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)" }}>
                        <tr>
                          <th className="p-2.5">Bước giá</th>
                          <th className="p-2.5 text-right">Mức giá</th>
                          <th className="p-2.5 text-right">KL Khả dụng</th>
                          <th className="p-2.5 text-right">KL Khớp mô phỏng</th>
                          <th className="p-2.5 text-right">Giá trị khớp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeOrderBookEval.eval.level_fills.map((lf) => (
                          <tr key={lf.level} style={{ borderBottom: "1px solid var(--bd-soft)" }}>
                            <td className="p-2.5 font-bold">
                              {obSide === "buy" ? `Ask ${lf.level}` : `Bid ${lf.level}`}
                            </td>
                            <td className="p-2.5 text-right font-mono-num font-bold">
                              {lf.price.toLocaleString("vi-VN")} đ
                            </td>
                            <td className="p-2.5 text-right font-mono-num">
                              {lf.availVol.toLocaleString("vi-VN")}
                            </td>
                            <td className="p-2.5 text-right font-mono-num font-bold" style={{ color: "var(--cyan)" }}>
                              {lf.filledVol.toLocaleString("vi-VN")}
                            </td>
                            <td className="p-2.5 text-right font-mono-num">{fmtVnd(lf.valueVnd)}</td>
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
          <div className="space-y-6">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="salx-card p-5">
                <SectionLabel>01 / KIỂM ĐỊNH HIỆU SUẤT TÍN HIỆU SÀNG LỌC (SIGNAL VALIDATION)</SectionLabel>
                <p style={{ fontSize: 12, color: "var(--mut)", marginBottom: 14 }}>
                  Đo lợi suất vượt trội sau thời điểm phát sinh tín hiệu so với VNINDEX (giả định khớp lệnh tại T+1 để tránh sai lệch dữ liệu tương lai, đã trừ 0.30% phí/thuế).
                </p>

                <table className="w-full border-collapse text-left text-xs">
                  <thead className="salx-sub" style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)" }}>
                    <tr>
                      <th className="p-2.5">Nhóm Tín hiệu / Kỳ hạn</th>
                      <th className="p-2.5 text-right">Số mẫu</th>
                      <th className="p-2.5 text-right">Lợi suất vượt trội TB</th>
                      <th className="p-2.5 text-right">Trung vị vượt trội</th>
                      <th className="p-2.5 text-right">Xác suất sinh lời</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.validation.signal_validation.map((row) => (
                      <tr key={row.horizon_days} style={{ borderBottom: "1px solid var(--bd-soft)" }}>
                        <td className="p-2.5 font-mono-num font-bold">
                          Top Điểm PORI (T+{row.horizon_days})
                        </td>
                        <td className="p-2.5 text-right font-mono-num">{row.sample_count} mẫu</td>
                        <td
                          className="p-2.5 text-right font-mono-num font-bold"
                          style={{ color: row.avg_excess_return_pct >= 0 ? "var(--g)" : "var(--avax)" }}
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

              <div className="salx-card p-5">
                <SectionLabel>02 / KIỂM ĐỊNH MÔ HÌNH RỦI RO VaR LỊCH SỬ 95% (257 PHIÊN)</SectionLabel>
                <p style={{ fontSize: 12, color: "var(--mut)", marginBottom: 14 }}>
                  Tách biệt hoàn toàn khỏi kiểm định tín hiệu: So sánh mức lỗ thực tế hàng ngày của danh mục với ngưỡng VaR 95% dự báo từ cửa sổ trượt 120 phiên trước đó.
                </p>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="salx-sub p-3">
                    <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>SỐ PHIÊN KIỂM ĐỊNH</div>
                    <div className="font-mono-num mt-1 text-xl font-extrabold">
                      {bundle.validation.risk_model_validation.test_days} phiên
                    </div>
                  </div>
                  <div className="salx-sub p-3">
                    <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>SỐ LẦN VƯỢT VaR 95%</div>
                    <div className="font-mono-num mt-1 text-xl font-extrabold" style={{ color: "var(--avax)" }}>
                      {bundle.validation.risk_model_validation.exceptions} lần (
                      {(bundle.validation.risk_model_validation.exception_rate * 100).toFixed(2)}%)
                    </div>
                  </div>
                  <div className="salx-sub p-3">
                    <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mut)" }}>KỲ VỌNG LÝ THUYẾT</div>
                    <div className="font-mono-num mt-1 text-xl font-extrabold" style={{ color: "var(--g)" }}>
                      {(bundle.validation.risk_model_validation.expected_rate * 100).toFixed(2)}%
                    </div>
                  </div>
                </div>

                <div className="salx-sub mt-4 p-3.5 text-xs" style={{ borderColor: "var(--gd)", background: "var(--gb)" }}>
                  <strong style={{ color: "var(--g)" }}>KẾT LUẬN KIỂM ĐỊNH:</strong>{" "}
                  {bundle.validation.risk_model_validation.status}. Tỷ lệ vượt ngưỡng thực tế (4.41%) bám rất sát mức kỳ vọng 5.00%.
                </div>
              </div>
            </div>

            <div className="salx-card p-5">
              <SectionLabel>03 / MA TRẬN ÁNH XẠ DỮ LIỆU (DATA MAPPING) & PHÂN TẦNG 3 LỚP DỮ LIỆU</SectionLabel>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="salx-sub" style={{ fontFamily: MONO, fontSize: 10, color: "var(--mut)" }}>
                    <tr>
                      <th className="p-2.5">Lớp dữ liệu</th>
                      <th className="p-2.5">Dữ liệu cần</th>
                      <th className="p-2.5">Mục đích sử dụng</th>
                      <th className="p-2.5">Nguồn chính & Dự phòng</th>
                      <th className="p-2.5">Quy ước Đồng nhất & Trạng thái Xác minh</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: "1px solid var(--bd-soft)" }}>
                      <td className="p-2.5 font-bold" style={{ color: "var(--cyan)" }}>1. Giao dịch & Quan sát</td>
                      <td className="p-2.5">Chỉ số, Độ rộng toàn sàn (Tăng/Giảm)</td>
                      <td className="p-2.5">Khí áp thị trường</td>
                      <td className="p-2.5">NEO API (/market/intradayMarketIndex) • Dự phòng: SSI indexSummary</td>
                      <td className="p-2.5" style={{ color: "var(--g)" }}>Đã xác minh: Trả về đủ 91 tăng / 206 giảm toàn sàn HOSE (UTC+7)</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid var(--bd-soft)" }}>
                      <td className="p-2.5 font-bold" style={{ color: "var(--cyan)" }}>1. Vi cấu trúc Sổ lệnh</td>
                      <td className="p-2.5">Bid/Ask 3 bước giá & Khối ngoại</td>
                      <td className="p-2.5">OBI, Spread, Chi phí khớp lệnh ước tính</td>
                      <td className="p-2.5">NEO WebSocket (stockInfo) & REST (/stock/stockDetail)</td>
                      <td className="p-2.5" style={{ color: "var(--gold)" }}>Đã khớp Schema 100% (xử lý chuỗi ATO/ATC); tự động fallback khi đổi IP động</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid var(--bd-soft)" }}>
                      <td className="p-2.5 font-bold" style={{ color: "var(--g)" }}>2. Dữ liệu Nghiên cứu</td>
                      <td className="p-2.5">Chuỗi OHLCV 257 phiên</td>
                      <td className="p-2.5">VaR lịch sử 95%, ES, Beta, Tương quan, MA20/50</td>
                      <td className="p-2.5">SSI FastConnect API v3 (get_ohlc_1day_historical) + SQLite</td>
                      <td className="p-2.5" style={{ color: "var(--g)" }}>Đã đồng bộ 14,649 bản ghi • Đồng nhất đơn vị VNĐ nguyên (VD: 50,200 đ)</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold" style={{ color: "var(--org)" }}>3. Dữ liệu Doanh nghiệp</td>
                      <td className="p-2.5">BCTC, Tin tức & Sự kiện quyền</td>
                      <td className="p-2.5">Chất lượng cơ bản & Hồ sơ 360°</td>
                      <td className="p-2.5">NEO events[] + Liên kết trực tiếp nguồn gốc (CafeF, Vietstock, FireAnt)</td>
                      <td className="p-2.5">Không sao chép trái phép; gắn cờ thiếu dữ liệu (không gán 0 điểm)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="salx-card p-5">
              <SectionLabel>04 / GIẢI TRÌNH 7 CÂU HỎI CHUYÊN MÔN ĐỊNH LƯỢNG & ĐỘ TIN CẬY HỆ THỐNG</SectionLabel>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 text-xs">
                {[
                  {
                    q: "1. Khả năng cung cấp dữ liệu thực tế",
                    a: "Đã đối chiếu toàn bộ tài liệu NeoAPI Docs & SSI v3: xác nhận chính xác endpoint JWT Auth, /stock/stockDetail (trả 3 mức Bid/Ask, room ngoại, sự kiện quyền) và SSI 1D OHLC.",
                  },
                  {
                    q: "2. Tính nhất quán dữ liệu giữa NEO & SSI",
                    a: "Cả hai nguồn đều được chuẩn hóa về đơn vị đồng (VNĐ số nguyên, VD: VCB = 50,200 đ), khối lượng cổ phiếu (lô 100) và múi giờ Asia/Ho_Chi_Minh (+07:00).",
                  },
                  {
                    q: "3. Phương pháp chấm điểm (Chống trùng lặp & Thiếu dữ liệu)",
                    a: "Chuẩn hóa Winsorization [2.5%, 97.5%] + Xếp hạng phân vị (0–100). Chỉ dùng 1 chỉ báo sức mạnh giá 20p trong nhóm Động lượng; OBI giới hạn <= 5% tổng điểm; thiếu BCTC được chuẩn hóa lại trọng số chứ không gán 0.",
                  },
                  {
                    q: "4. Đo lường rủi ro danh mục (Phương pháp & Giả định VaR/ES)",
                    a: "Chọn VaR lịch sử 95% & Tổn thất kỳ vọng ES 95% (1 ngày, không tái cân bằng nội ngày) trên cửa sổ 130–257 phiên làm phương pháp chính; bổ sung VaR tham số và Đóng góp rủi ro biên để đối chiếu.",
                  },
                  {
                    q: "5. Tính khả thi khớp lệnh (Giới hạn Sổ lệnh 3 mức giá)",
                    a: "Hiển thị rõ Thanh khoản Sổ lệnh & Chi phí Khớp lệnh Ước tính. Mô phỏng khớp qua 3 bước giá Bid/Ask; nếu lệnh vượt tổng độ sâu 3 mức giá thì phát cảnh báo đỏ, tuyệt đối không ngoại suy.",
                  },
                  {
                    q: "6. Kiểm định ngoài mẫu & 7. Độ ổn định vận hành",
                    a: "Tách riêng Kiểm định Tín hiệu (vào lệnh T+1 chống nhìn trước tương lai, trừ phí 0.3%) và Kiểm định VaR (136 phiên ngoài mẫu). Kiến trúc 2 nguồn dữ liệu giúp hệ thống luôn chạy mượt ngay cả khi 1 API mất kết nối hoặc khác IP.",
                  },
                ].map((item) => (
                  <div key={item.q} className="salx-sub p-3.5">
                    <div style={{ fontFamily: MONO, fontWeight: 700, color: "var(--g)", marginBottom: 4 }}>
                      {item.q}
                    </div>
                    <p style={{ margin: 0, color: "var(--mut)", lineHeight: 1.55 }}>{item.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            SCREEN 6: BEGINNER GUIDE & PORI GLOSSARY
           ===================================================================== */}
        {activeTab === "guide" && (
          <div className="space-y-6">
            {/* Hero Intro Card: PORI là gì? */}
            <div className="salx-card p-6" style={{ borderColor: "var(--gd)" }}>
              <SectionLabel>01 / PORI LÀ GÌ & GIẢI QUYẾT VẤN ĐỀ GÌ CHO NHÀ ĐẦU TƯ?</SectionLabel>
              <div className="grid gap-5 lg:grid-cols-12">
                <div className="lg:col-span-7 space-y-3">
                  <h2 style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, margin: 0 }}>
                    PORI = Portfolio (Danh mục) + Risk (Quản trị rủi ro)
                  </h2>
                  <p style={{ margin: 0, fontSize: 13.5, color: "var(--mut)", lineHeight: 1.65 }}>
                    Hầu hết các công cụ chứng khoán thông thường chỉ trả lời câu hỏi{" "}
                    <strong style={{ color: "var(--ink)" }}>“Mã nào đang tăng mạnh?”</strong> mà bỏ qua rủi ro thực tế của
                    người mua. <strong style={{ color: "var(--g)" }}>PORI</strong> là{" "}
                    <strong style={{ color: "var(--ink)" }}>Công cụ Định lượng &amp; Quản trị Rủi ro Danh mục</strong> giúp
                    bạn trả lời đủ 3 câu hỏi trước khi đặt lệnh:
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-3 text-xs pt-1">
                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontWeight: 800, color: "var(--g)" }}>1. CÓ NÊN MUA LÚC NÀY?</div>
                      <p style={{ margin: "4px 0 0", color: "var(--mut)", lineHeight: 1.5 }}>
                        Đọc 3 trụ cột VNINDEX &amp; dòng tiền nhóm ngành để biết nên tấn công hay giữ tiền mặt.
                      </p>
                    </div>
                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontWeight: 800, color: "var(--cyan)" }}>2. MUA CÓ HỢP VỐN &amp; DANH MỤC?</div>
                      <p style={{ margin: "4px 0 0", color: "var(--mut)", lineHeight: 1.5 }}>
                        Kiểm tra mã đó làm tăng hay giảm VaR danh mục, và vốn nhỏ có nên chia nhiều mã hay không.
                      </p>
                    </div>
                    <div className="salx-sub p-3">
                      <div style={{ fontFamily: MONO, fontWeight: 800, color: "var(--org)" }}>3. KHỚP LỆNH CÓ BỊ TRƯỢT GIÁ?</div>
                      <p style={{ margin: "4px 0 0", color: "var(--mut)", lineHeight: 1.5 }}>
                        Soi trực tiếp 3 bước giá Bid/Ask để biết lệnh lớn có bị đội giá hoặc thiếu thanh khoản không.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5 salx-sub p-4 space-y-2.5">
                  <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 800, color: "var(--g)" }}>
                    LƯU Ý CHO NGƯỜI DÙNG MỚI &amp; TÀI KHOẢN LƯU TRỮ
                  </div>
                  <div className="space-y-2 text-xs" style={{ color: "var(--mut)", lineHeight: 1.55 }}>
                    <div>
                      • <strong style={{ color: "var(--ink)" }}>Không cần đăng nhập để dùng thử:</strong> Mọi tính năng (lọc mã, sửa danh mục, mô phỏng, soi sổ lệnh) đều mở sẵn 100% và tự lưu tạm trên trình duyệt của bạn.
                    </div>
                    <div>
                      • <strong style={{ color: "var(--ink)" }}>Khi muốn lưu lâu dài &amp; mở trên máy khác:</strong> Bấm nút{" "}
                      <strong style={{ color: "var(--g)" }}>ĐĂNG NHẬP</strong> ở góc phải trên cùng, tạo tài khoản bằng Email + Mật khẩu. Hệ thống sẽ tự động lưu danh mục và lịch sử kịch bản của riêng bạn.
                    </div>
                  </div>
                  {!authUser && (
                    <button
                      onClick={() => setAuthModalOpen(true)}
                      style={{
                        marginTop: 6,
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "7px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--gd)",
                        background: "var(--gb)",
                        color: "var(--g)",
                        cursor: "pointer",
                      }}
                    >
                      ĐĂNG NHẬP / TẠO TÀI KHOẢN EMAIL ↗
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 4-Step Beginner Workflow */}
            <div className="salx-card p-6">
              <SectionLabel>02 / QUY TRÌNH 4 BƯỚC SỬ DỤNG HIỆU QUẢ CHO NGƯỜI MỚI</SectionLabel>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    step: "BƯỚC 1",
                    tab: "regime" as TabId,
                    title: "Xem Nhịp Thị Trường & Ngành",
                    detail:
                      "Kiểm tra VNINDEX đang ở trạng thái Tích cực, Trung tính hay Rủi ro cao. Kéo hoặc lăn chuột trên đồ thị để xem lịch sử, bấm nút Giải thích ở 3 trụ cột và rê chuột vào Bảng xếp hạng nhóm ngành để tìm ngành dẫn dắt.",
                    btn: "MỞ 01. THỊ TRƯỜNG →",
                  },
                  {
                    step: "BƯỚC 2",
                    tab: "discovery" as TabId,
                    title: "Lọc Cổ Phiếu Theo Điểm PORI",
                    detail:
                      "Lọc theo nhóm ngành hoặc kéo thanh Điểm PORI (nên ưu tiên từ 65–70+ trở lên). Bấm vào từng mã để xem Hồ sơ 360° bên phải gồm đồ thị 60 phiên, lý do lọt top và liên kết BCTC gốc.",
                    btn: "MỞ 02. LỌC CỔ PHIẾU →",
                  },
                  {
                    step: "BƯỚC 3",
                    tab: "portfolio" as TabId,
                    title: "Nhập Vốn & Mô Phỏng What-If",
                    detail:
                      "Bấm 'Bắt đầu từ tiền mặt' để tự nhập mã bạn đang cầm (theo số cổ phiếu lô 100 hoặc số tiền), nhập tổng vốn bản thân có để nhận tư vấn số mã tối ưu, rồi chạy Mô phỏng 5 chiều trước khi bấm mua.",
                    btn: "MỞ 03. DANH MỤC & VỐN →",
                  },
                  {
                    step: "BƯỚC 4",
                    tab: "orderbook" as TabId,
                    title: "Kiểm Tra Độ Sâu Sổ Lệnh",
                    detail:
                      "Chọn mã định mua và nhập số tiền giải ngân dự kiến để kiểm tra 3 bước giá Bid/Ask, chỉ số cân bằng OBI và độ trượt giá ước tính trước khi đặt lệnh thực tế trên app chứng khoán.",
                    btn: "MỞ 04. SỔ LỆNH →",
                  },
                ].map((s) => (
                  <div key={s.step} className="salx-sub p-4 flex flex-col justify-between gap-3">
                    <div>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: "var(--g)",
                          letterSpacing: ".08em",
                        }}
                      >
                        {s.step}
                      </span>
                      <h3 style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, margin: "4px 0 8px" }}>
                        {s.title}
                      </h3>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--mut)", lineHeight: 1.55 }}>{s.detail}</p>
                    </div>
                    <button
                      onClick={() => setActiveTab(s.tab)}
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "7px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--gd)",
                        background: "var(--gb)",
                        color: "var(--g)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {s.btn}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Glossary */}
            <div className="salx-card p-6">
              <SectionLabel>03 / TỪ ĐIỂN NHANH CÁC CHỈ SỐ TRÊN PORI</SectionLabel>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 text-xs">
                {[
                  {
                    term: "Điểm PORI (0 – 100)",
                    desc: "Điểm tổng hợp xếp hạng sức mạnh cổ phiếu từ 4 nhóm: Xu hướng & Động lượng (35%), Thanh khoản & Sổ lệnh (25%), Dòng tiền Khối ngoại (15%) và Cơ bản Doanh nghiệp (25%).",
                  },
                  {
                    term: "VaR 95% & ES 95% (1 ngày)",
                    desc: "VaR 95% ước tính mức lỗ tối đa trong 1 ngày ở điều kiện thông thường (95% số phiên). ES 95% là mức lỗ trung bình nếu rơi vào 5% số phiên xấu nhất.",
                  },
                  {
                    term: "Chỉ số tập trung HHI (0 → 1)",
                    desc: "Đo mức độ dồn vốn vào ít mã. HHI càng gần 1 là quá tập trung (VD: dồn hết vào 1 mã = 1.0); HHI < 0.25 nghĩa là danh mục cân đối từ 4 mã trở lên.",
                  },
                  {
                    term: "Độ Phù Hợp Danh Mục (0 – 100)",
                    desc: "Đánh giá xem việc mua thêm mã X có giúp giảm rủi ro VaR và đa dạng hóa tương quan cho danh mục hiện tại của bạn hay không.",
                  },
                  {
                    term: "Tương quan ρ (Correlation)",
                    desc: "Đo mức độ 'tăng giảm cùng nhịp' giữa 2 cổ phiếu (-1 đến +1). Nên phối hợp các mã có ρ < 0.55 (khác ngành) để đỡ bị giảm đồng loạt.",
                  },
                  {
                    term: "OBI & Trượt giá 3 bước giá",
                    desc: "OBI dương nghĩa là lực kê mua 3 bước giá Bid áp đảo lực bán Ask. Độ trượt giá cho biết mức chênh lệch giá bình quân phải trả thêm khi quét nhiều bước giá.",
                  },
                ].map((g) => (
                  <div key={g.term} className="salx-sub p-3.5">
                    <div style={{ fontFamily: MONO, fontWeight: 800, color: "var(--g)", marginBottom: 4 }}>
                      {g.term}
                    </div>
                    <p style={{ margin: 0, color: "var(--mut)", lineHeight: 1.55 }}>{g.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* FOOTER */}
        <footer className="salx-card mt-8 p-4 text-xs" style={{ color: "var(--mut)" }}>
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--org)" }} />
            <div>
              <strong style={{ color: "var(--ink)", fontFamily: MONO }}>
                PHƯƠNG PHÁP ĐỊNH LƯỢNG, GIỚI HẠN & TUYÊN BỐ MIỄN TRỪ:
              </strong>{" "}
              {bundle.disclaimer} Chuỗi dữ liệu lịch sử 257 phiên từ SSI FastConnect API v3 & cấu trúc sổ lệnh/thị trường từ VPBankS NEO API. Điểm PORI sử dụng Winsorization [2.5%, 97.5%] và Xếp hạng phân vị; mã thiếu dữ liệu BCTC được chuẩn hóa lại trọng số trên các trụ cột khả dụng (không gán 0 điểm).
            </div>
          </div>
        </footer>
      </main>

      {/* ── OPTIONAL EMAIL + PASSWORD AUTH MODAL (GUEST-FIRST ARCHITECTURE) ── */}
      {authModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(3, 7, 18, 0.72)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setAuthModalOpen(false)}
        >
          <div
            className="salx-card w-full max-w-md p-6 space-y-4 salx-fade-up"
            style={{ borderColor: "var(--gd)", boxShadow: "0 24px 64px rgba(0, 0, 0, 0.45)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 800, color: "var(--g)" }}>
                  ĐỒNG BỘ DANH MỤC & LỊCH SỬ MÔ PHỎNG
                </div>
                <h3 style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 800, margin: "4px 0 0" }}>
                  {authTab === "login" ? "Đăng Nhập Bằng Email" : "Tạo Tài Khoản Lưu Trữ"}
                </h3>
              </div>
              <button
                onClick={() => setAuthModalOpen(false)}
                style={{ background: "none", border: "none", color: "var(--mut)", cursor: "pointer" }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div
              className="salx-sub p-3 text-xs"
              style={{ color: "var(--mut)", lineHeight: 1.5, borderColor: "var(--bd-mid)" }}
            >
              💡 <strong style={{ color: "var(--ink)" }}>Không bắt buộc đăng nhập:</strong> Bạn (hoặc giảng viên chấm bài)
              vẫn dùng thử được 100% tính năng ngay lập tức. Đăng nhập Email chỉ để lưu danh mục & các kịch bản mô phỏng
              lên đám mây để xem lại trên mọi thiết bị.
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "login", label: "ĐĂNG NHẬP" },
                { id: "signup", label: "ĐĂNG KÝ MỚI" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setAuthTab(t.id as "login" | "signup");
                    setAuthError(null);
                    setAuthSuccess(null);
                  }}
                  style={{
                    fontFamily: MONO,
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--bd-mid)",
                    background: authTab === t.id ? "var(--g)" : "var(--surf2)",
                    color: authTab === t.id ? "var(--g-contrast)" : "var(--mut)",
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {!isSupabaseConfigured && (
              <div
                className="salx-sub p-3 text-xs"
                style={{ borderColor: "var(--org)", color: "var(--org)", lineHeight: 1.5 }}
              >
                <strong>Chưa gắn khóa Supabase trên Vercel:</strong> Hiện trình duyệt vẫn tự động lưu tạm danh mục cho
                máy này (`localStorage`). Để bật lưu đám mây đa thiết bị, cần thêm{" "}
                <code>NEXT_PUBLIC_SUPABASE_URL</code> và <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> trong Vercel
                Environment Variables.
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-3">
              <div>
                <label style={{ display: "block", fontFamily: MONO, fontSize: 10, color: "var(--mut)", marginBottom: 4 }}>
                  ĐỊA CHỈ EMAIL
                </label>
                <input
                  type="email"
                  required
                  placeholder="tenban@gmail.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  style={{
                    width: "100%",
                    fontFamily: MONO,
                    fontSize: 12,
                    background: "var(--surf2)",
                    border: "1px solid var(--bd-mid)",
                    color: "var(--ink)",
                    borderRadius: 8,
                    padding: "9px 12px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontFamily: MONO, fontSize: 10, color: "var(--mut)", marginBottom: 4 }}>
                  MẬT KHẨU (TỐI THIỂU 6 KÝ TỰ)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  style={{
                    width: "100%",
                    fontFamily: MONO,
                    fontSize: 12,
                    background: "var(--surf2)",
                    border: "1px solid var(--bd-mid)",
                    color: "var(--ink)",
                    borderRadius: 8,
                    padding: "9px 12px",
                  }}
                />
              </div>

              {authError && (
                <div className="salx-sub p-2.5 text-xs" style={{ borderColor: "var(--avax-bd)", color: "var(--avax)" }}>
                  {authError}
                </div>
              )}

              {authSuccess && (
                <div className="salx-sub p-2.5 text-xs" style={{ borderColor: "var(--gd)", color: "var(--g)" }}>
                  {authSuccess}
                </div>
              )}

              <button
                type="submit"
                disabled={authBusy}
                style={{
                  width: "100%",
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 800,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--g)",
                  color: "var(--g-contrast)",
                  cursor: authBusy ? "wait" : "pointer",
                  opacity: authBusy ? 0.7 : 1,
                }}
              >
                {authBusy
                  ? "ĐANG XỬ LÝ..."
                  : authTab === "login"
                  ? "ĐĂNG NHẬP & ĐỒNG BỘ DANH MỤC"
                  : "TẠO TÀI KHOẢN & LƯU DANH MỤC"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
