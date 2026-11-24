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
  updatedAt?: string;
}

export async function loadCloudWorkspace(userId: string): Promise<UserWorkspacePayload | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("pori_user_workspaces")
    .select("positions, cash_vnd, target_capital_vnd, simulations, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    positions: (data.positions as Record<string, number>) || {},
    cashVnd: Number(data.cash_vnd ?? 100_000_000),
    targetCapitalVnd: Number(data.target_capital_vnd ?? 200_000_000),
    simulations: Array.isArray(data.simulations) ? (data.simulations as SimulationHistoryItem[]) : [],
    updatedAt: data.updated_at,
  };
}

export async function saveCloudWorkspace(
  userId: string,
  email: string | undefined,
  payload: UserWorkspacePayload
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Chưa cấu hình Supabase." };
  const { error } = await supabase.from("pori_user_workspaces").upsert(
    {
      user_id: userId,
      email: email || null,
      positions: payload.positions,
      cash_vnd: Math.round(payload.cashVnd),
      target_capital_vnd: Math.round(payload.targetCapitalVnd),
      simulations: payload.simulations.slice(0, 30),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
