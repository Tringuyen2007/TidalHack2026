"""
ML Sidecar — Python FastAPI Service
═══════════════════════════════════════════════════════════════════════

Architecture:
  TypeScript Pipeline (authoritative) → HTTP → Python ML Sidecar (advisory)

This service exposes three prediction endpoints:
  1. POST /predict/similarity  — XGBoost feature-pair similarity
  2. POST /predict/clusters    — DBSCAN anomaly clustering
  3. POST /predict/growth      — Growth rate prediction with uncertainty

All outputs are ADVISORY ONLY. The TypeScript pipeline applies the
blending formula:  final = deterministic * 0.8 + ml_score * 0.2

Health/readiness:
  GET /health      — liveness probe
  GET /ready       — readiness check (models loaded?)

Model info:
  GET /model/info  — XGBoost model status, metrics, feature importance

═══════════════════════════════════════════════════════════════════════
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import time
import os

from models.xgboost_model import XGBoostSimilarityModel, SimilarityRequest, SimilarityResponse
from models.clustering import ClusteringModel, ClusterRequest, ClusterResponse
from models.growth import GrowthModel, GrowthRequest, GrowthResponse

# ── Global model instances ──
similarity_model: XGBoostSimilarityModel | None = None
clustering_model: ClusteringModel | None = None
growth_model: GrowthModel | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models on startup, release on shutdown."""
    global similarity_model, clustering_model, growth_model

    print("[ML-SIDECAR] Loading models...")
    t0 = time.time()

    similarity_model = XGBoostSimilarityModel()
    clustering_model = ClusteringModel()
    growth_model = GrowthModel()

    elapsed = time.time() - t0
    mode = "TRAINED XGBoost" if similarity_model.is_trained else "analytical fallback"
    print(f"[ML-SIDECAR] All models loaded in {elapsed:.2f}s (similarity: {mode})")

    yield

    print("[ML-SIDECAR] Shutting down models...")
    similarity_model = None
    clustering_model = None
    growth_model = None


app = FastAPI(
    title="ILI Alignment ML Sidecar",
    version="1.0.0",
    description="Advisory ML models for ILI pipeline data alignment (XGBoost similarity)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://localhost:3000", "http://127.0.0.1", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════
# Health & Readiness
# ══════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ml-sidecar", "version": "1.0.0"}


@app.get("/ready")
async def ready():
    models_loaded = all([
        similarity_model is not None,
        clustering_model is not None,
        growth_model is not None,
    ])
    return {
        "ready": models_loaded,
        "models": {
            "similarity": similarity_model is not None,
            "similarity_trained": similarity_model.is_trained if similarity_model else False,
            "clustering": clustering_model is not None,
            "growth": growth_model is not None,
        },
    }


@app.get("/model/info")
async def model_info():
    """Return XGBoost model status, metrics, and feature importance."""
    if similarity_model is None:
        raise HTTPException(503, "Similarity model not loaded")
    return {
        "model_id": "xgboost-similarity",
        "trained": similarity_model.is_trained,
        "metrics": similarity_model._metrics,
        "feature_importance": similarity_model._feature_importance,
        "feature_names": list(similarity_model._feature_importance.keys()) if similarity_model._feature_importance else [],
    }


# ══════════════════════════════════════════════════════════════════════
# Prediction Endpoints
# ══════════════════════════════════════════════════════════════════════

@app.post("/predict/similarity", response_model=SimilarityResponse)
async def predict_similarity(req: SimilarityRequest):
    """
    XGBoost similarity: given an older+newer feature pair and a
    deterministic score, produce an ML similarity probability (0-1).

    Uses trained XGBoost binary classifier if available,
    falls back to analytical heuristic otherwise.

    The TypeScript side applies:
      final = deterministic * 0.8 + ml_similarity * 0.2
    """
    if similarity_model is None:
        raise HTTPException(503, "Similarity model not loaded")

    return similarity_model.predict(req)


@app.post("/predict/clusters", response_model=ClusterResponse)
async def predict_clusters(req: ClusterRequest):
    """
    DBSCAN clustering: given a set of features with corrected
    distance, clock, and geometry, produce cluster labels.

    Used to identify spatial groupings of anomalies that the
    deterministic graph analysis may miss.
    """
    if clustering_model is None:
        raise HTTPException(503, "Clustering model not loaded")

    return clustering_model.predict(req)


@app.post("/predict/growth", response_model=GrowthResponse)
async def predict_growth(req: GrowthRequest):
    """
    Growth rate prediction: given depth history across multiple
    runs, predict future growth rate with uncertainty bounds.

    Advisory — supplements NACE SP0502 linear extrapolation.
    """
    if growth_model is None:
        raise HTTPException(503, "Growth model not loaded")

    return growth_model.predict(req)


# ══════════════════════════════════════════════════════════════════════
# Anomaly Prediction (Placeholder)
# ══════════════════════════════════════════════════════════════════════

@app.post("/predict/anomaly")
async def predict_anomaly():
    """
    Architectural placeholder for future anomaly prediction model.
    Not implemented — returns a structured stub response.
    """
    return {
        "status": "not_implemented",
        "model_id": "anomaly-predictor",
        "model_version": "0.0.0",
        "message": "Anomaly prediction is an architectural placeholder. "
                   "This endpoint will accept run data and predict likely "
                   "new anomaly locations in future inspections.",
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("ML_SIDECAR_PORT", "8100"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
