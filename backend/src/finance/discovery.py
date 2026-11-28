from typing import Dict, List, Optional
import numpy as np
import pandas as pd


def winsorize_and_percentile(series: pd.Series, higher_is_better: bool = True) -> pd.Series:
    """
    Winsorize at [2.5%, 97.5%] to limit outliers, then convert to [0, 100] percentile rank.
    Missing values remain NaN (never assigned 0).
    """
    valid = series.dropna()
    if len(valid) == 0:
        return pd.Series(np.nan, index=series.index)
    if len(valid) == 1:
        return pd.Series(50.0, index=series.index).where(series.notna(), np.nan)

    low_q = float(valid.quantile(0.025))
    high_q = float(valid.quantile(0.975))
    clipped = series.clip(lower=low_q, upper=high_q)
    pct = clipped.rank(pct=True, ascending=higher_is_better) * 100.0
    return pct.where(series.notna(), np.nan)


def _aggregate_weighted_scores(
    df: pd.DataFrame,
    comp_map: Dict[str, str],
    w: Dict[str, float],
    min_completeness: float,
) -> tuple[List[Optional[float]], List[float], List[str]]:
    alpha_vals: List[Optional[float]] = []
    completeness_vals: List[float] = []
    flags: List[str] = []
    for _, row in df.iterrows():
        avail_weight = 0.0
        weighted_sum = 0.0
        missing_names = []
        for key, col in comp_map.items():
            val = row[col]
            if pd.notna(val):
                avail_weight += w[key]
                weighted_sum += w[key] * float(val)
            else:
                missing_names.append(key)

        completeness_vals.append(round(avail_weight, 2))
        if avail_weight < min_completeness or avail_weight <= 0:
            alpha_vals.append(np.nan)
            flags.append(f"Thiếu dữ liệu ({', '.join(missing_names)}) - Không xếp hạng")
        else:
            alpha_vals.append(round(weighted_sum / avail_weight, 1))
            flags.append(f"Thiếu: {', '.join(missing_names)}" if missing_names else "Đầy đủ")
    return alpha_vals, completeness_vals, flags


def compute_alpha_scores(
    features_df: pd.DataFrame,
    weights: Optional[Dict[str, float]] = None,
    min_completeness: float = 0.60,
    regime: str = "Neutral",
) -> pd.DataFrame:
    """
    Compute 4-component PORI / Alpha Score (0-100) for Discovery Universe, plus:
    - alpha_sector_neutral: peer-relative percentile within each sector
    - alpha_regime_adaptive: lowers short-term momentum weight in High Risk/Defensive markets
    """
    w = weights or {
        "trend": 0.35,
        "liquidity": 0.25,
        "foreign": 0.15,
        "fundamental": 0.25,
    }
    df = features_df.copy()

    # 1. Trend & Momentum
    rs_score = winsorize_and_percentile(df["rs_20d"], higher_is_better=True)
    ma_bonus = df["above_ma20"].astype(float) * 100.0
    df["trend_score"] = (0.75 * rs_score + 0.25 * ma_bonus).round(1)

    # Sector-neutral trend & liquidity within each sector
    if "sector" in df.columns and df["sector"].nunique() > 1:
        sec_rs = df.groupby("sector")["rs_20d"].transform(
            lambda s: winsorize_and_percentile(s, higher_is_better=True)
        )
        df["_trend_sec"] = (0.75 * sec_rs + 0.25 * ma_bonus).round(1)
        sec_adv = df.groupby("sector")["adv_20_val"].transform(
            lambda s: winsorize_and_percentile(s, higher_is_better=True)
        )
    else:
        df["_trend_sec"] = df["trend_score"]
        sec_adv = winsorize_and_percentile(df["adv_20_val"], higher_is_better=True)

    # 2. Liquidity & Trading Quality (OBI kept small <= 20% of liquidity pillar)
    adv_score = winsorize_and_percentile(df["adv_20_val"], higher_is_better=True)
    pace_score = winsorize_and_percentile(df["volume_pace"], higher_is_better=True)
    if "obi_3l" in df.columns and df["obi_3l"].notna().any():
        obi_score = winsorize_and_percentile(df["obi_3l"], higher_is_better=True)
        df["liquidity_score"] = (
            0.50 * adv_score.fillna(50.0)
            + 0.30 * pace_score.fillna(50.0)
            + 0.20 * obi_score.fillna(50.0)
        ).round(1)
        df["_liq_sec"] = (
            0.50 * sec_adv.fillna(50.0)
            + 0.30 * pace_score.fillna(50.0)
            + 0.20 * obi_score.fillna(50.0)
        ).round(1)
    else:
        df["liquidity_score"] = (0.60 * adv_score + 0.40 * pace_score).round(1)
        df["_liq_sec"] = (0.60 * sec_adv + 0.40 * pace_score).round(1)

    # 3. Foreign Flow
    if "foreign_net_ratio" in df.columns and df["foreign_net_ratio"].notna().any():
        df["foreign_score"] = winsorize_and_percentile(df["foreign_net_ratio"], higher_is_better=True).round(1)
    else:
        df["foreign_score"] = np.nan

    # 4. Fundamental Quality (never assign 0 when missing!)
    fund_parts = []
    if "roe" in df.columns and df["roe"].notna().any():
        fund_parts.append(winsorize_and_percentile(df["roe"], higher_is_better=True))
    if "profit_growth" in df.columns and df["profit_growth"].notna().any():
        fund_parts.append(winsorize_and_percentile(df["profit_growth"], higher_is_better=True))
    if "pe" in df.columns and df["pe"].notna().any():
        valid_pe = df["pe"].where(df["pe"] > 0, np.nan)
        fund_parts.append(winsorize_and_percentile(valid_pe, higher_is_better=False))

    if fund_parts:
        fund_df = pd.concat(fund_parts, axis=1)
        df["fundamental_score"] = fund_df.mean(axis=1, skipna=True).round(1)
    else:
        df["fundamental_score"] = np.nan

    comp_map = {
        "trend": "trend_score",
        "liquidity": "liquidity_score",
        "foreign": "foreign_score",
        "fundamental": "fundamental_score",
    }
    alpha_vals, completeness_vals, flags = _aggregate_weighted_scores(df, comp_map, w, min_completeness)

    sec_comp_map = {
        "trend": "_trend_sec",
        "liquidity": "_liq_sec",
        "foreign": "foreign_score",
        "fundamental": "fundamental_score",
    }
    sec_alpha_vals, _, _ = _aggregate_weighted_scores(df, sec_comp_map, w, min_completeness)

    # Regime-adaptive weights: when High Risk / Defensive, trim momentum chase from 0.35 -> 0.15
    if regime in ("High Risk", "Defensive"):
        w_adapt = {"trend": 0.15, "liquidity": 0.40, "foreign": 0.20, "fundamental": 0.25}
    else:
        w_adapt = w
    adapt_alpha_vals, _, _ = _aggregate_weighted_scores(df, comp_map, w_adapt, min_completeness)

    reasons_list: List[List[str]] = []
    for _, row in df.iterrows():
        reasons: List[str] = []
        if pd.notna(row["trend_score"]) and row["trend_score"] >= 70:
            reasons.append(f"Động lượng giá mạnh (Xu hướng {row['trend_score']:.0f}/100)")
        if pd.notna(row["liquidity_score"]) and row["liquidity_score"] >= 70:
            reasons.append(f"Thanh khoản tích cực (Thanh khoản {row['liquidity_score']:.0f}/100)")
        if pd.notna(row["foreign_score"]) and row["foreign_score"] >= 70:
            reasons.append(f"Khối ngoại hỗ trợ (Khối ngoại {row['foreign_score']:.0f}/100)")
        if pd.notna(row["fundamental_score"]) and row["fundamental_score"] >= 70:
            reasons.append(f"Nền tảng cơ bản tốt (Cơ bản {row['fundamental_score']:.0f}/100)")
        if not reasons:
            reasons.append("Cân bằng ở mức trung bình khá trên các yếu tố khả dụng")
        reasons_list.append(reasons)

    df["alpha_score"] = alpha_vals
    df["alpha_sector_neutral"] = sec_alpha_vals
    df["alpha_regime_adaptive"] = adapt_alpha_vals
    df["data_completeness"] = completeness_vals
    df["data_flag"] = flags
    df["reasons"] = reasons_list
    df = df.drop(columns=["_trend_sec", "_liq_sec"], errors="ignore")
    return df.sort_values(by="alpha_score", ascending=False, na_position="last").reset_index(drop=True)
