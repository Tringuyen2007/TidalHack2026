"""
XGBoost Similarity Model — Inference
═══════════════════════════════════════════════════════════════════════

Replaces the analytical Siamese model with a trained XGBoost
binary classifier that outputs P(same_anomaly | feature_pair).

Behavior:
  • If a trained model exists at artifacts/xgboost_similarity.json,
    loads and uses it for inference.
  • If no trained model exists, falls back to a lightweight
    analytical heuristic (identical to the old Siamese weights)
    so the sidecar never crashes on startup.

Interface:
  Accepts the SAME SimilarityRequest/SimilarityResponse schemas
  used by the old Siamese model, so the TypeScript client and
  pipeline integration require ZERO changes.

═══════════════════════════════════════════════════════════════════════
"""

from pydantic import BaseModel, Field
import numpy as np
import os
import json

from training.features import (
    extract_features_from_dicts,
    FEATURE_NAMES,
    NUM_FEATURES,
)


# ── Request / Response Schemas (unchanged from siamese.py) ──

class FeatureVector(BaseModel):
    type: str
    distance: float
    clock: float | None = None
    depth_percent: float | None = None
    length_in: float | None = None
    width_in: float | None = None
    wall_thickness_in: float | None = None
    joint_number: int | None = None
    dist_to_upstream_weld_ft: float | None = None


class SimilarityRequest(BaseModel):
    older: FeatureVector
    newer: FeatureVector
    deterministic_score: float = Field(ge=0, le=100)
    distance_residual_ft: float
    clock_residual_hrs: float | None = None
    # Optional context fields for richer feature extraction
    run_gap_years: float | None = None
    api_1163_tool_weight: float | None = None
    dtw_residual: float | None = None
    icp_residual: float | None = None
    anchor_density: float | None = None


class SimilarityResponse(BaseModel):
    ml_similarity_score: float = Field(ge=0.0, le=1.0)
    ml_confidence: float = Field(ge=0.0, le=1.0)
    adjusted_score: float
    explanation: str
    model_id: str = "xgboost-similarity"
    model_version: str = "1.0.0"
    experimental: bool = True
    feature_contributions: dict[str, float | None] | None = None


# ── Paths ──

ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), "..", "artifacts")
MODEL_PATH = os.path.join(ARTIFACTS_DIR, "xgboost_similarity.json")
METRICS_PATH = os.path.join(ARTIFACTS_DIR, "training_metrics.json")
FI_PATH = os.path.join(ARTIFACTS_DIR, "feature_importance.json")


class XGBoostSimilarityModel:
    """
    XGBoost binary classifier for ILI feature pair similarity.

    Outputs P(same_anomaly) ∈ [0, 1] — used by the TypeScript
    pipeline as:  final = deterministic * 0.8 + ml_prob * 0.2
    """

    def __init__(self):
        self._model = None
        self._trained = False
        self._metrics: dict = {}
        self._feature_importance: dict[str, float] = {}

        # Try to load trained model
        if os.path.exists(MODEL_PATH):
            try:
                import xgboost as xgb
                self._model = xgb.XGBClassifier()
                self._model.load_model(MODEL_PATH)
                self._trained = True
                print(f"[XGBOOST] Loaded trained model from {MODEL_PATH}")

                # Load metrics if available
                if os.path.exists(METRICS_PATH):
                    with open(METRICS_PATH) as f:
                        self._metrics = json.load(f)
                    auc = self._metrics.get("holdout_auc", "?")
                    print(f"[XGBOOST] Holdout AUC: {auc}")

                # Load feature importance if available
                if os.path.exists(FI_PATH):
                    with open(FI_PATH) as f:
                        self._feature_importance = json.load(f)

            except Exception as e:
                print(f"[XGBOOST] WARNING: Failed to load model: {e}")
                print("[XGBOOST] Falling back to analytical heuristic")
                self._model = None
                self._trained = False
        else:
            print(f"[XGBOOST] No trained model at {MODEL_PATH}")
            print("[XGBOOST] Using analytical fallback (train with: python -m training.train_xgboost --mongo-uri <URI>)")

        self._ready = True

    @property
    def is_trained(self) -> bool:
        return self._trained

    def _req_to_feature_dicts(self, req: SimilarityRequest) -> tuple[dict, dict, dict]:
        """Convert the request into dicts that extract_features_from_dicts expects."""
        older_dict = {
            "event_type_canonical": req.older.type,
            "corrected_distance_ft": req.older.distance,
            "log_distance_ft": req.older.distance,
            "clock_position_hrs": req.older.clock,
            "depth_percent": req.older.depth_percent,
            "length_in": req.older.length_in,
            "width_in": req.older.width_in,
            "wall_thickness_in": req.older.wall_thickness_in,
            "joint_number": req.older.joint_number,
            "dist_to_upstream_weld_ft": req.older.dist_to_upstream_weld_ft,
        }
        newer_dict = {
            "event_type_canonical": req.newer.type,
            "corrected_distance_ft": req.newer.distance,
            "log_distance_ft": req.newer.distance,
            "clock_position_hrs": req.newer.clock,
            "depth_percent": req.newer.depth_percent,
            "length_in": req.newer.length_in,
            "width_in": req.newer.width_in,
            "wall_thickness_in": req.newer.wall_thickness_in,
            "joint_number": req.newer.joint_number,
            "dist_to_upstream_weld_ft": req.newer.dist_to_upstream_weld_ft,
        }
        context = {
            "run_gap_years": req.run_gap_years,
            "api_1163_tool_weight": req.api_1163_tool_weight,
            "dtw_residual": req.dtw_residual,
            "icp_residual": req.icp_residual,
            "anchor_density": req.anchor_density,
        }
        return older_dict, newer_dict, context

    def predict(self, req: SimilarityRequest) -> SimilarityResponse:
        """
        Predict similarity probability for a feature pair.

        If trained model available: uses XGBoost predict_proba
        If no model: uses analytical fallback (weighted heuristic)
        """
        if self._trained and self._model is not None:
            return self._predict_xgboost(req)
        else:
            return self._predict_analytical(req)

    def _predict_xgboost(self, req: SimilarityRequest) -> SimilarityResponse:
        """Inference with trained XGBoost model."""
        older_dict, newer_dict, context = self._req_to_feature_dicts(req)

        # Extract 13-feature vector
        features = extract_features_from_dicts(
            older_dict, newer_dict,
            run_gap_years=context.get("run_gap_years"),
            api_tool_weight=context.get("api_1163_tool_weight"),
            dtw_residual=context.get("dtw_residual"),
            icp_residual=context.get("icp_residual"),
            anchor_density=context.get("anchor_density"),
        )
        X = features.reshape(1, -1)

        # Predict probability
        try:
            proba = self._model.predict_proba(X)[0, 1]
        except Exception:
            # Single-class edge case
            proba = float(self._model.predict(X)[0])

        similarity = float(np.clip(proba, 0.0, 1.0))

        # Confidence: based on model AUC and feature completeness
        model_auc = self._metrics.get("holdout_auc", 0.7)
        n_present = int(np.sum(features != -1.0))
        data_completeness = n_present / NUM_FEATURES
        ml_confidence = float(np.clip(model_auc * data_completeness, 0.0, 1.0))

        # Blended score (TypeScript also computes this)
        adjusted = req.deterministic_score * 0.8 + (similarity * 100) * 0.2

        # Feature contributions for explainability
        contributions = {}
        for i, name in enumerate(FEATURE_NAMES):
            val = float(features[i])
            imp = self._feature_importance.get(name, 0.0)
            contributions[name] = round(val * imp, 6) if val != -1.0 else None

        explanation = (
            f"XGBoost P(match)={similarity:.4f}, "
            f"features={n_present}/{NUM_FEATURES} present, "
            f"model AUC={model_auc}, "
            f"top features: {self._top_features_str(features)}"
        )

        return SimilarityResponse(
            ml_similarity_score=round(similarity, 4),
            ml_confidence=round(ml_confidence, 4),
            adjusted_score=round(adjusted, 2),
            explanation=explanation,
            model_id="xgboost-similarity",
            model_version="1.0.0",
            feature_contributions=contributions,
        )

    def _top_features_str(self, features: np.ndarray, n: int = 3) -> str:
        """Return top N feature importance with values for explanation."""
        if not self._feature_importance:
            return "no importance data"
        top = sorted(self._feature_importance.items(), key=lambda x: x[1], reverse=True)[:n]
        parts = []
        for name, imp in top:
            idx = FEATURE_NAMES.index(name) if name in FEATURE_NAMES else -1
            val = features[idx] if idx >= 0 else -1.0
            parts.append(f"{name}={val:.2f}(w={imp:.3f})")
        return ", ".join(parts)

    def _predict_analytical(self, req: SimilarityRequest) -> SimilarityResponse:
        """
        Analytical fallback — identical to old Siamese weighted heuristic.
        Used when no trained XGBoost model is available.
        """
        # Distance similarity (Gaussian decay, σ=2 ft)
        dist_sim = float(np.exp(-(req.distance_residual_ft ** 2) / 8.0))

        # Clock similarity (circular)
        clock_sim: float | None = None
        if req.clock_residual_hrs is not None:
            hrs = abs(req.clock_residual_hrs)
            if hrs > 6.0:
                hrs = 12.0 - hrs
            clock_sim = 1.0 - hrs / 6.0

        # Type compatibility
        type_a = req.older.type.upper()
        type_b = req.newer.type.upper()
        from training.features import TYPE_COMPAT
        type_sim = 1.0 if type_a == type_b else TYPE_COMPAT.get((type_a, type_b), 0.3)

        # Depth similarity
        depth_sim = 0.5
        if req.older.depth_percent is not None and req.newer.depth_percent is not None:
            mx = max(req.older.depth_percent, req.newer.depth_percent)
            depth_sim = min(req.older.depth_percent, req.newer.depth_percent) / mx if mx > 0.01 else 1.0

        # Geometry similarity
        geom_scores = []
        if req.older.length_in is not None and req.newer.length_in is not None:
            mx = max(req.older.length_in, req.newer.length_in)
            if mx > 0:
                geom_scores.append(min(req.older.length_in, req.newer.length_in) / mx)
        if req.older.width_in is not None and req.newer.width_in is not None:
            mx = max(req.older.width_in, req.newer.width_in)
            if mx > 0:
                geom_scores.append(min(req.older.width_in, req.newer.width_in) / mx)
        geom_sim = float(np.mean(geom_scores)) if geom_scores else 0.5

        # Weighted combination
        W = {"dist": 0.30, "clock": 0.20, "type": 0.20, "depth": 0.15, "geom": 0.15}
        if clock_sim is not None:
            total = sum(W.values())
            similarity = (
                dist_sim * W["dist"] + clock_sim * W["clock"] +
                type_sim * W["type"] + depth_sim * W["depth"] +
                geom_sim * W["geom"]
            ) / total
        else:
            total = W["dist"] + W["type"] + W["depth"] + W["geom"]
            similarity = (
                dist_sim * W["dist"] + type_sim * W["type"] +
                depth_sim * W["depth"] + geom_sim * W["geom"]
            ) / total

        similarity = float(np.clip(similarity, 0.0, 1.0))
        data_completeness = sum([
            1.0, 0.8 if clock_sim is not None else 0.0,
            0.7 if req.older.depth_percent is not None else 0.0,
            0.5 if req.older.length_in is not None else 0.0,
        ]) / 3.0
        ml_confidence = float(np.clip(data_completeness, 0.0, 1.0))
        adjusted = req.deterministic_score * 0.8 + (similarity * 100) * 0.2

        components = [f"dist={dist_sim:.3f}"]
        if clock_sim is not None:
            components.append(f"clock={clock_sim:.3f}")
        components += [f"type={type_sim:.3f}", f"depth={depth_sim:.3f}", f"geom={geom_sim:.3f}"]

        explanation = (
            f"Analytical fallback (no trained model): similarity={similarity:.3f} "
            f"({', '.join(components)}). "
            f"Train with: python -m training.train_xgboost --mongo-uri <URI>"
        )

        return SimilarityResponse(
            ml_similarity_score=round(similarity, 4),
            ml_confidence=round(ml_confidence, 4),
            adjusted_score=round(adjusted, 2),
            explanation=explanation,
            model_id="xgboost-similarity-fallback",
            model_version="1.0.0",
            feature_contributions=None,
        )
