"""
DBSCAN Anomaly Clustering Model
═════════════════════════════════════════════════════════════════════

Clusters pipeline anomalies based on spatial proximity (corrected
distance + clock position) and geometric similarity (depth, length,
width) to identify natural groupings that the deterministic graph
analysis may not capture.

Input:  Array of features with corrected distance, clock, geometry
Output: Cluster labels per feature, cluster summaries, noise points

═════════════════════════════════════════════════════════════════════
"""

from pydantic import BaseModel, Field
import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler


# ── Request / Response Schemas ──

class ClusterFeature(BaseModel):
    """A single feature to cluster."""
    feature_id: str
    corrected_distance_ft: float
    clock_hrs: float | None = None
    depth_percent: float | None = None
    length_in: float | None = None
    width_in: float | None = None
    event_type: str = "UNKNOWN"


class ClusterLabel(BaseModel):
    """Cluster assignment for a single feature."""
    feature_id: str
    cluster_id: int = Field(description="-1 = noise (no cluster)")
    distance_to_centroid: float


class ClusterSummary(BaseModel):
    """Summary statistics for a cluster."""
    cluster_id: int
    member_count: int
    centroid_distance_ft: float
    centroid_clock_hrs: float | None = None
    spread_distance_ft: float
    spread_clock_hrs: float | None = None
    dominant_type: str
    risk_density: float = Field(
        description="Features per foot within cluster — higher = more concerning"
    )


class ClusterRequest(BaseModel):
    features: list[ClusterFeature] = Field(min_length=1)
    eps: float = Field(default=5.0, description="DBSCAN eps (max neighborhood distance)")
    min_samples: int = Field(default=2, description="DBSCAN min_samples for core points")


class ClusterResponse(BaseModel):
    labels: list[ClusterLabel]
    clusters: list[ClusterSummary]
    noise_count: int
    total_clusters: int
    model_id: str = "dbscan-clustering"
    model_version: str = "0.1.0"
    experimental: bool = True


class ClusteringModel:
    """
    DBSCAN clustering for spatial anomaly grouping.

    Features are projected into a normalized feature space:
      [corrected_distance, clock_position_x, clock_position_y,
       depth_percent, length_in, width_in]

    Clock position is encoded as (cos, sin) to handle circularity.
    Missing features use neutral (0) values.
    """

    # Feature importance weights for distance metric
    W_DISTANCE = 1.0
    W_CLOCK = 0.8
    W_DEPTH = 0.4
    W_LENGTH = 0.3
    W_WIDTH = 0.3

    def __init__(self):
        self._scaler = StandardScaler()
        self._ready = True
        print("[CLUSTERING] DBSCAN clustering model initialized")

    def _encode_features(self, features: list[ClusterFeature]) -> np.ndarray:
        """Encode features into a numeric matrix for DBSCAN."""
        rows = []
        for f in features:
            # Circular clock encoding
            if f.clock_hrs is not None:
                angle = (f.clock_hrs / 12.0) * 2 * np.pi
                clock_x = float(np.cos(angle)) * self.W_CLOCK
                clock_y = float(np.sin(angle)) * self.W_CLOCK
            else:
                clock_x = 0.0
                clock_y = 0.0

            rows.append([
                f.corrected_distance_ft * self.W_DISTANCE,
                clock_x,
                clock_y,
                (f.depth_percent or 0.0) * self.W_DEPTH,
                (f.length_in or 0.0) * self.W_LENGTH,
                (f.width_in or 0.0) * self.W_WIDTH,
            ])

        return np.array(rows, dtype=np.float64)

    def predict(self, req: ClusterRequest) -> ClusterResponse:
        """Run DBSCAN clustering on the feature set."""
        if len(req.features) < req.min_samples:
            # Not enough features for clustering
            return ClusterResponse(
                labels=[
                    ClusterLabel(feature_id=f.feature_id, cluster_id=-1, distance_to_centroid=0.0)
                    for f in req.features
                ],
                clusters=[],
                noise_count=len(req.features),
                total_clusters=0,
            )

        # Encode and scale
        X = self._encode_features(req.features)
        X_scaled = self._scaler.fit_transform(X)

        # Run DBSCAN
        dbscan = DBSCAN(eps=req.eps, min_samples=req.min_samples, metric="euclidean")
        cluster_ids = dbscan.fit_predict(X_scaled)

        # Build labels with distance to centroid
        unique_clusters = set(c for c in cluster_ids if c >= 0)
        centroids: dict[int, np.ndarray] = {}
        for cid in unique_clusters:
            mask = cluster_ids == cid
            centroids[cid] = X[mask].mean(axis=0)

        labels: list[ClusterLabel] = []
        for i, f in enumerate(req.features):
            cid = int(cluster_ids[i])
            if cid >= 0 and cid in centroids:
                dist_to_centroid = float(np.linalg.norm(X[i] - centroids[cid]))
            else:
                dist_to_centroid = 0.0
            labels.append(ClusterLabel(
                feature_id=f.feature_id,
                cluster_id=cid,
                distance_to_centroid=round(dist_to_centroid, 4),
            ))

        # Build cluster summaries
        summaries: list[ClusterSummary] = []
        for cid in sorted(unique_clusters):
            mask = cluster_ids == cid
            members = [req.features[i] for i in range(len(req.features)) if mask[i]]
            member_distances = [m.corrected_distance_ft for m in members]
            member_clocks = [m.clock_hrs for m in members if m.clock_hrs is not None]

            # Find dominant type
            type_counts: dict[str, int] = {}
            for m in members:
                type_counts[m.event_type] = type_counts.get(m.event_type, 0) + 1
            dominant = max(type_counts, key=type_counts.get)  # type: ignore

            # Calculate spread
            dist_spread = max(member_distances) - min(member_distances) if member_distances else 0.0

            # Risk density: features per foot
            risk_density = len(members) / max(dist_spread, 1.0)

            summaries.append(ClusterSummary(
                cluster_id=cid,
                member_count=len(members),
                centroid_distance_ft=round(float(np.mean(member_distances)), 2),
                centroid_clock_hrs=round(float(np.mean(member_clocks)), 2) if member_clocks else None,
                spread_distance_ft=round(dist_spread, 2),
                spread_clock_hrs=round(
                    max(member_clocks) - min(member_clocks), 2
                ) if len(member_clocks) >= 2 else None,
                dominant_type=dominant,
                risk_density=round(risk_density, 4),
            ))

        noise_count = int(np.sum(cluster_ids == -1))

        return ClusterResponse(
            labels=labels,
            clusters=summaries,
            noise_count=noise_count,
            total_clusters=len(unique_clusters),
        )
