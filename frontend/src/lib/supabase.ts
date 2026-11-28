import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

import type { CustomFundamentalInput } from "@/types/radar";

export interface SimulationHistoryItem {
  id: string;
  createdAt: string;
  actionType: "WHAT_IF_SIM" | "APPLY_POSITION" | "CAPITAL_PLAN" | "UPDATE_PORTFOLIO";
  symbol?: string;
  amountVnd?: number;
  summary: string;
}

export interface UserWorkspacePayload {
  positions: Record<string, number>;
  cashVnd: number;
  targetCapitalVnd: number;
  simulations: SimulationHistoryItem[];
  watchlist?: string[];
  costBasis?: Record<string, number>;
  customFundamentals?: Record<string, CustomFundamentalInput>;
  alertVarPct?: number;
  updatedAt?: string;
}

const META_SIM_ID = "__PORI_META__";

interface StoredMetaItem {
  id: typeof META_SIM_ID;
  watchlist?: string[];
  costBasis?: Record<string, number>;
  customFundamentals?: Record<string, CustomFundamentalInput>;
  alertVarPct?: number;
}

export async function loadCloudWorkspace(userId: string): Promise<UserWorkspacePayload | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("pori_user_workspaces")
    .select("positions, cash_vnd, target_capital_vnd, simulations, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  const rawSims = Array.isArray(data.simulations) ? (data.simulations as Array<SimulationHistoryItem | StoredMetaItem>) : [];
  const metaEntry = rawSims.find((x) => x && x.id === META_SIM_ID) as StoredMetaItem | undefined;
  const cleanSims = rawSims.filter((x) => x && x.id !== META_SIM_ID) as SimulationHistoryItem[];

  return {
    positions: (data.positions as Record<string, number>) || {},
    cashVnd: Number(data.cash_vnd ?? 100_000_000),
    targetCapitalVnd: Number(data.target_capital_vnd ?? 200_000_000),
    simulations: cleanSims,
    watchlist: metaEntry?.watchlist,
    costBasis: metaEntry?.costBasis,
    customFundamentals: metaEntry?.customFundamentals,
    alertVarPct: metaEntry?.alertVarPct,
    updatedAt: data.updated_at,
  };
}

export async function saveCloudWorkspace(
  userId: string,
  email: string | undefined,
  payload: UserWorkspacePayload
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Chưa cấu hình Supabase." };
  const metaEntry: StoredMetaItem = {
    id: META_SIM_ID,
    watchlist: payload.watchlist || [],
    costBasis: payload.costBasis || {},
    customFundamentals: payload.customFundamentals || {},
    alertVarPct: payload.alertVarPct ?? 2.5,
  };
  const packedSims = [...payload.simulations.filter((x) => x.id !== META_SIM_ID).slice(0, 29), metaEntry];

  const { error } = await supabase.from("pori_user_workspaces").upsert(
    {
      user_id: userId,
      email: email || null,
      positions: payload.positions,
      cash_vnd: Math.round(payload.cashVnd),
      target_capital_vnd: Math.round(payload.targetCapitalVnd),
      simulations: packedSims,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchLiveSnapshotFromSupabase<T extends { generated_at?: string }>(): Promise<T | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("pori_live_snapshots")
      .select("generated_at, payload")
      .eq("id", "latest")
      .maybeSingle();
    if (error || !data || !data.payload) return null;
    return data.payload as T;
  } catch {
    return null;
  }
}
