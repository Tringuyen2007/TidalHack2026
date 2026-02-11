"""
Feature Engineering for ILI Anomaly Pair Matching
═══════════════════════════════════════════════════════════════════════

Constructs a fixed-dimension feature vector for each anomaly pair.
Every feature is derived from the data — nothing is inferred or hallucinated.

Feature Groups:
  1. Spatial        — |Δ corrected_distance|, |Δ clock_position| (wrap-aware),
                      same_weld_segment (boolean)
  2. Geometry       — |Δ depth_percent|, |Δ length|, |Δ width|, |Δ wall_thickness|
  3. Categorical    — feature_type compatibility flag, run_gap_years,
                      API 1163 tool_qualification weight
  4. Alignment Sigs — DTW residual, ICP residual, anchor_density_in_segment

═══════════════════════════════════════════════════════════════════════
"""

import numpy as np
import math
from dataclasses import dataclass
from typing import Optional


# ── Type compatibility matrix (mirrors TypeScript ensemble-scoring.ts) ──
TYPE_COMPAT: dict[tuple[str, str], float] = {
    ("METAL_LOSS", "METAL_LOSS"): 1.0,
    ("DENT", "DENT"): 1.0,
    ("CRACK", "CRACK"): 1.0,
    ("WELD", "WELD"): 1.0,
    ("GIRTH_WELD", "GIRTH_WELD"): 1.0,
    ("CLUSTER", "CLUSTER"): 1.0,
    ("METAL_LOSS", "CORROSION"): 0.9,
    ("CORROSION", "METAL_LOSS"): 0.9,
    ("METAL_LOSS", "CLUSTER"): 0.85,
    ("CLUSTER", "METAL_LOSS"): 0.85,
    ("DENT", "DEFORMATION"): 0.85,
    ("DEFORMATION", "DENT"): 0.85,
    ("CRACK", "CRACK_LIKE"): 0.8,
    ("CRACK_LIKE", "CRACK"): 0.8,
    ("METAL_LOSS_MFG", "METAL_LOSS_MFG"): 1.0,
    ("METAL_LOSS", "METAL_LOSS_MFG"): 0.7,
    ("METAL_LOSS_MFG", "METAL_LOSS"): 0.7,
}

# Ordered list of feature names (must match output of extract_features)
FEATURE_NAMES = [
    # Spatial (3)
    "abs_delta_distance_ft",
    "abs_delta_clock_hrs",          # wrap-aware, filled -1 if missing
    "same_weld_segment",             # 1.0 or 0.0
    # Geometry (4)
    "abs_delta_depth_pct",
    "abs_delta_length_in",
    "abs_delta_width_in",
    "abs_delta_wall_thickness_in",
    # Categorical / Context (3)
    "type_compatibility",            # 0-1 from matrix
    "run_gap_years",
    "api_1163_tool_weight",
    # Alignment signals (3)
    "dtw_residual",                  # -1 if unavailable
    "icp_residual",                  # -1 if unavailable
    "anchor_density_in_segment",     # -1 if unavailable
]

NUM_FEATURES = len(FEATURE_NAMES)


@dataclass
class AnomalyRecord:
    """Flat representation of a single Feature document."""
    feature_id: str
    run_id: str
    event_type: str               # canonical type
    corrected_distance_ft: float
    log_distance_ft: float
    clock_position_hrs: Optional[float]
    depth_percent: Optional[float]
    length_in: Optional[float]
    width_in: Optional[float]
    wall_thickness_in: Optional[float]
    joint_number: Optional[int]
    dist_to_upstream_weld_ft: Optional[float]


@dataclass
class PairContext:
    """Run-level and alignment-level context for a pair."""
    run_gap_years: float
    api_1163_tool_weight: float      # from Run.tool_qualification.confidence_weight
    dtw_residual: Optional[float]    # per-pair DTW confidence
    icp_residual: Optional[float]    # per-pair ICP RMSE
    anchor_density: Optional[float]  # anchors per 100 ft in the local segment


def _clock_delta_wrap_aware(a: Optional[float], b: Optional[float]) -> float:
    """Absolute clock difference in hours, wrapping around 12-hour dial.
    Returns -1 if either is missing (XGBoost handles -1 as 'missing')."""
    if a is None or b is None:
        return -1.0
    raw = abs(a - b)
    if raw > 6.0:
        raw = 12.0 - raw
    return raw


def _safe_abs_delta(a: Optional[float], b: Optional[float], missing: float = -1.0) -> float:
    """Absolute difference, returning `missing` if either value is None."""
    if a is None or b is None:
        return missing
    return abs(a - b)


def _type_compat_score(t1: str, t2: str) -> float:
    """Look up type compatibility from the matrix.
    Exact match → 1.0, near match via matrix, else 0.0 (incompatible)."""
    if t1 == t2:
        return 1.0
    return TYPE_COMPAT.get((t1, t2), 0.0)


def _same_weld_segment(a: AnomalyRecord, b: AnomalyRecord) -> float:
    """Check if two anomalies are likely in the same weld-to-weld segment.
    Uses joint_number if available, falls back to distance proximity."""
    if a.joint_number is not None and b.joint_number is not None:
        return 1.0 if a.joint_number == b.joint_number else 0.0
    # Fallback: within typical joint length (~40 ft)
    dist_diff = abs(a.corrected_distance_ft - b.corrected_distance_ft)
    return 1.0 if dist_diff < 40.0 else 0.0


def extract_features(
    older: AnomalyRecord,
    newer: AnomalyRecord,
    ctx: PairContext,
) -> np.ndarray:
    """
    Extract the fixed-dimension feature vector for a (older, newer) anomaly pair.

    Returns np.ndarray of shape (NUM_FEATURES,).
    Uses -1.0 as the sentinel for missing values (XGBoost native missing handling).
    """
    feats = np.full(NUM_FEATURES, -1.0, dtype=np.float64)

    # ── Spatial ──
    feats[0] = abs(older.corrected_distance_ft - newer.corrected_distance_ft)
    feats[1] = _clock_delta_wrap_aware(older.clock_position_hrs, newer.clock_position_hrs)
    feats[2] = _same_weld_segment(older, newer)

    # ── Geometry ──
    feats[3] = _safe_abs_delta(older.depth_percent, newer.depth_percent)
    feats[4] = _safe_abs_delta(older.length_in, newer.length_in)
    feats[5] = _safe_abs_delta(older.width_in, newer.width_in)
    feats[6] = _safe_abs_delta(older.wall_thickness_in, newer.wall_thickness_in)

    # ── Categorical / Context ──
    feats[7] = _type_compat_score(older.event_type, newer.event_type)
    feats[8] = ctx.run_gap_years
    feats[9] = ctx.api_1163_tool_weight

    # ── Alignment signals ──
    feats[10] = ctx.dtw_residual if ctx.dtw_residual is not None else -1.0
    feats[11] = ctx.icp_residual if ctx.icp_residual is not None else -1.0
    feats[12] = ctx.anchor_density if ctx.anchor_density is not None else -1.0

    return feats


def extract_features_from_dicts(
    older: dict,
    newer: dict,
    run_gap_years: float = 5.0,
    api_tool_weight: float = 0.85,
    dtw_residual: Optional[float] = None,
    icp_residual: Optional[float] = None,
    anchor_density: Optional[float] = None,
) -> np.ndarray:
    """
    Convenience: extract features directly from raw dicts (e.g. from JSON request).
    Used by the FastAPI prediction endpoint.
    """
    a = AnomalyRecord(
        feature_id=older.get("feature_id", ""),
        run_id=older.get("run_id", ""),
        event_type=older.get("event_type", older.get("type", "OTHER")),
        corrected_distance_ft=older.get("corrected_distance_ft", older.get("distance", 0.0)),
        log_distance_ft=older.get("log_distance_ft", older.get("distance", 0.0)),
        clock_position_hrs=older.get("clock_position_hrs", older.get("clock", None)),
        depth_percent=older.get("depth_percent", None),
        length_in=older.get("length_in", None),
        width_in=older.get("width_in", None),
        wall_thickness_in=older.get("wall_thickness_in", None),
        joint_number=older.get("joint_number", None),
        dist_to_upstream_weld_ft=older.get("dist_to_upstream_weld_ft", None),
    )
    b = AnomalyRecord(
        feature_id=newer.get("feature_id", ""),
        run_id=newer.get("run_id", ""),
        event_type=newer.get("event_type", newer.get("type", "OTHER")),
        corrected_distance_ft=newer.get("corrected_distance_ft", newer.get("distance", 0.0)),
        log_distance_ft=newer.get("log_distance_ft", newer.get("distance", 0.0)),
        clock_position_hrs=newer.get("clock_position_hrs", newer.get("clock", None)),
        depth_percent=newer.get("depth_percent", None),
        length_in=newer.get("length_in", None),
        width_in=newer.get("width_in", None),
        wall_thickness_in=newer.get("wall_thickness_in", None),
        joint_number=newer.get("joint_number", None),
        dist_to_upstream_weld_ft=newer.get("dist_to_upstream_weld_ft", None),
    )
    ctx = PairContext(
        run_gap_years=run_gap_years,
        api_1163_tool_weight=api_tool_weight,
        dtw_residual=dtw_residual,
        icp_residual=icp_residual,
        anchor_density=anchor_density,
    )
    return extract_features(a, b, ctx)
