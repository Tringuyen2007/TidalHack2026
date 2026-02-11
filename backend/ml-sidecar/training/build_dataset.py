"""
Training Dataset Construction from MongoDB
═══════════════════════════════════════════════════════════════════════

Builds a labeled training dataset for the XGBoost similarity classifier
from the existing MongoDB collections:

  Positives (label=1):  Existing matched anomaly pairs from MatchedPair
                        Prefers HIGH confidence deterministic matches

  Negatives (label=0):  Two types:
    A) Hard negatives:  Near-miss pairs (±10–30 ft, ±2 hrs clock)
                        that were NOT matched — plausible but wrong
    B) Easy negatives:  Random distant pairs with incompatible types
                        to stabilize training

  Target ratio:         ~3:1 negative:positive

  Leakage prevention:   True matched pairs are excluded from negatives

Usage:
    python -m training.build_dataset --mongo-uri <URI> --output dataset.npz

═══════════════════════════════════════════════════════════════════════
"""

import argparse
import os
import sys
import random
import certifi
import numpy as np
from pymongo import MongoClient
from typing import Optional
from training.features import (
    extract_features,
    AnomalyRecord,
    PairContext,
    NUM_FEATURES,
    FEATURE_NAMES,
)


def _feat_to_record(doc: dict) -> AnomalyRecord:
    """Convert a MongoDB Feature document to an AnomalyRecord."""
    return AnomalyRecord(
        feature_id=str(doc.get("_id", "")),
        run_id=str(doc.get("run_id", "")),
        event_type=doc.get("event_type_canonical", doc.get("event_type_raw", "OTHER")),
        corrected_distance_ft=doc.get("corrected_distance_ft") or doc.get("log_distance_ft") or 0.0,
        log_distance_ft=doc.get("log_distance_ft") or 0.0,
        clock_position_hrs=doc.get("clock_decimal"),
        depth_percent=doc.get("depth_percent"),
        length_in=doc.get("length_in"),
        width_in=doc.get("width_in"),
        wall_thickness_in=doc.get("wall_thickness_in"),
        joint_number=doc.get("joint_number"),
        dist_to_upstream_weld_ft=doc.get("dist_to_upstream_weld_ft"),
    )


def build_dataset(
    mongo_uri: str,
    db_name: str = "ili_alignment",
    neg_pos_ratio: float = 3.0,
    hard_neg_dist_ft: float = 30.0,
    hard_neg_clock_hrs: float = 2.0,
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """
    Build training dataset from MongoDB.

    Returns:
        X: np.ndarray of shape (N, NUM_FEATURES) — feature matrix
        y: np.ndarray of shape (N,) — labels (1 = match, 0 = non-match)
        metadata: list of dicts with pair identifiers for auditing
    """
    random.seed(seed)
    np.random.seed(seed)

    client = MongoClient(mongo_uri, tlsCAFile=certifi.where())
    db = client[db_name]

    print("[DATASET] Loading collections...")
    # Load all matched pairs
    matched_pairs = list(db.matchedpairs.find({}))
    print(f"  MatchedPairs: {len(matched_pairs)}")

    if not matched_pairs:
        print("[DATASET] No matched pairs found — cannot build dataset.")
        print("  Checking for alternate collection names...")
        collections = db.list_collection_names()
        print(f"  Available collections: {collections}")
        # Try common casing variants
        for name in ["MatchedPairs", "matched_pairs", "matchedPairs", "matchedpair"]:
            if name.lower() in [c.lower() for c in collections]:
                actual = [c for c in collections if c.lower() == name.lower()][0]
                matched_pairs = list(db[actual].find({}))
                print(f"  Found {len(matched_pairs)} pairs in '{actual}'")
                break

    if not matched_pairs:
        print("[DATASET] ERROR: No matched pairs in any collection. Aborting.")
        sys.exit(1)

    # Get all unique job IDs to scope our features
    job_ids = list(set(str(mp.get("job_id", "")) for mp in matched_pairs))
    print(f"  Jobs: {len(job_ids)}")

    # Load run info for year/tool data
    runs_cursor = db.runs.find({})
    runs_by_id: dict[str, dict] = {}
    for r in runs_cursor:
        runs_by_id[str(r["_id"])] = r
    # Try alternate collection names
    if not runs_by_id:
        for name in db.list_collection_names():
            if name.lower() == "runs" or name.lower() == "run":
                for r in db[name].find({}):
                    runs_by_id[str(r["_id"])] = r
                break
    print(f"  Runs: {len(runs_by_id)}")

    # Build a set of all feature IDs involved in matched pairs
    matched_feature_set: set[tuple[str, str]] = set()
    for mp in matched_pairs:
        a_id = str(mp.get("run_a_feature_id", ""))
        b_id = str(mp.get("run_b_feature_id", ""))
        matched_feature_set.add((a_id, b_id))
        matched_feature_set.add((b_id, a_id))  # both directions

    # Collect all unique feature IDs
    feat_ids = set()
    for mp in matched_pairs:
        feat_ids.add(mp.get("run_a_feature_id"))
        feat_ids.add(mp.get("run_b_feature_id"))
    feat_ids.discard(None)

    # Load all features referenced by matches
    features_cursor = db.features.find({"_id": {"$in": list(feat_ids)}})
    features_by_id: dict[str, dict] = {}
    for f in features_cursor:
        features_by_id[str(f["_id"])] = f
    # Try alternate
    if not features_by_id:
        for name in db.list_collection_names():
            if name.lower() == "features" or name.lower() == "feature":
                for f in db[name].find({"_id": {"$in": list(feat_ids)}}):
                    features_by_id[str(f["_id"])] = f
                break
    print(f"  Features loaded: {len(features_by_id)}")

    # Also load ALL features for negative sampling (scoped to runs in our matches)
    run_ids_in_matches = set()
    for mp in matched_pairs:
        run_ids_in_matches.add(mp.get("run_a_run_id"))
        run_ids_in_matches.add(mp.get("run_b_run_id"))
    run_ids_in_matches.discard(None)

    all_features_for_runs: dict[str, list[dict]] = {}  # run_id -> [feature docs]
    for f in db.features.find({"run_id": {"$in": list(run_ids_in_matches)}}):
        rid = str(f["run_id"])
        features_by_id[str(f["_id"])] = f
        all_features_for_runs.setdefault(rid, []).append(f)

    total_all_features = sum(len(v) for v in all_features_for_runs.values())
    print(f"  Total features across relevant runs: {total_all_features}")

    # ══════════════════════════════════════════════════════════════
    # Build Positive Samples
    # ══════════════════════════════════════════════════════════════
    print("\n[DATASET] Building positive samples...")
    X_pos = []
    meta_pos = []

    for mp in matched_pairs:
        a_id = str(mp.get("run_a_feature_id", ""))
        b_id = str(mp.get("run_b_feature_id", ""))
        a_doc = features_by_id.get(a_id)
        b_doc = features_by_id.get(b_id)
        if not a_doc or not b_doc:
            continue

        a_rec = _feat_to_record(a_doc)
        b_rec = _feat_to_record(b_doc)

        # Run context
        a_run = runs_by_id.get(str(mp.get("run_a_run_id", "")), {})
        b_run = runs_by_id.get(str(mp.get("run_b_run_id", "")), {})
        year_a = a_run.get("year", 2000)
        year_b = b_run.get("year", 2005)
        tool_qual = b_run.get("tool_qualification", {})
        tool_weight = tool_qual.get("confidence_weight", 0.85) if isinstance(tool_qual, dict) else 0.85

        ctx = PairContext(
            run_gap_years=abs(year_b - year_a),
            api_1163_tool_weight=tool_weight,
            dtw_residual=None,  # not stored per-pair in DB
            icp_residual=None,
            anchor_density=None,
        )

        fv = extract_features(a_rec, b_rec, ctx)
        X_pos.append(fv)
        meta_pos.append({
            "feature_a": a_id,
            "feature_b": b_id,
            "job_id": str(mp.get("job_id", "")),
            "det_score": mp.get("confidence_score", 0),
            "det_category": mp.get("confidence_category", ""),
            "label": 1,
            "neg_type": None,
        })

    n_pos = len(X_pos)
    print(f"  Positives: {n_pos}")

    if n_pos == 0:
        print("[DATASET] ERROR: No valid positive samples. Aborting.")
        sys.exit(1)

    # ══════════════════════════════════════════════════════════════
    # Build Negative Samples
    # ══════════════════════════════════════════════════════════════
    target_neg = int(n_pos * neg_pos_ratio)
    target_hard = int(target_neg * 0.6)  # 60% hard, 40% easy
    target_easy = target_neg - target_hard
    print(f"\n[DATASET] Building negative samples (target: {target_neg} = {target_hard} hard + {target_easy} easy)...")

    X_neg = []
    meta_neg = []
    neg_pair_set: set[tuple[str, str]] = set()  # dedup

    # ── A) Hard Negatives (Near-Misses) ──
    print("  Generating hard negatives (near-misses)...")
    # Group features by run for efficient spatial search
    for mp in matched_pairs:
        if len(X_neg) >= target_hard:
            break

        b_id = str(mp.get("run_b_feature_id", ""))
        b_doc = features_by_id.get(b_id)
        if not b_doc:
            continue
        b_rec = _feat_to_record(b_doc)

        a_run_id = str(mp.get("run_a_run_id", ""))
        a_features = all_features_for_runs.get(a_run_id, [])

        for a_doc in a_features:
            if len(X_neg) >= target_hard:
                break

            a_id = str(a_doc["_id"])

            # Skip if this IS a true match
            if (a_id, b_id) in matched_feature_set:
                continue
            # Skip if already in negatives
            if (a_id, b_id) in neg_pair_set:
                continue
            # Skip reference points (girth welds used as anchors)
            if a_doc.get("is_reference_point"):
                continue

            a_rec = _feat_to_record(a_doc)

            # Check spatial proximity (near-miss criteria)
            dist_diff = abs(a_rec.corrected_distance_ft - b_rec.corrected_distance_ft)
            if dist_diff > hard_neg_dist_ft:
                continue

            clock_diff = -1.0
            if a_rec.clock_position_hrs is not None and b_rec.clock_position_hrs is not None:
                clock_diff = abs(a_rec.clock_position_hrs - b_rec.clock_position_hrs)
                if clock_diff > 6.0:
                    clock_diff = 12.0 - clock_diff
                if clock_diff > hard_neg_clock_hrs:
                    continue

            # This is a plausible near-miss → hard negative
            a_run = runs_by_id.get(a_run_id, {})
            b_run = runs_by_id.get(str(mp.get("run_b_run_id", "")), {})
            year_a = a_run.get("year", 2000)
            year_b = b_run.get("year", 2005)
            tool_qual = b_run.get("tool_qualification", {})
            tool_weight = tool_qual.get("confidence_weight", 0.85) if isinstance(tool_qual, dict) else 0.85

            ctx = PairContext(
                run_gap_years=abs(year_b - year_a),
                api_1163_tool_weight=tool_weight,
                dtw_residual=None,
                icp_residual=None,
                anchor_density=None,
            )

            fv = extract_features(a_rec, b_rec, ctx)
            X_neg.append(fv)
            meta_neg.append({
                "feature_a": a_id,
                "feature_b": b_id,
                "job_id": str(mp.get("job_id", "")),
                "det_score": None,
                "det_category": None,
                "label": 0,
                "neg_type": "hard",
            })
            neg_pair_set.add((a_id, b_id))

    print(f"    Hard negatives: {len(X_neg)}")

    # ── B) Easy Negatives (Random distant pairs) ──
    print("  Generating easy negatives (random distant)...")
    all_run_ids = list(all_features_for_runs.keys())
    easy_attempts = 0
    max_easy_attempts = target_easy * 20

    while len(X_neg) < target_hard + target_easy and easy_attempts < max_easy_attempts:
        easy_attempts += 1

        # Pick two different runs
        if len(all_run_ids) < 2:
            break
        r1, r2 = random.sample(all_run_ids, 2)
        feats_r1 = all_features_for_runs.get(r1, [])
        feats_r2 = all_features_for_runs.get(r2, [])
        if not feats_r1 or not feats_r2:
            continue

        a_doc = random.choice(feats_r1)
        b_doc = random.choice(feats_r2)
        a_id = str(a_doc["_id"])
        b_id = str(b_doc["_id"])

        if (a_id, b_id) in matched_feature_set:
            continue
        if (a_id, b_id) in neg_pair_set:
            continue

        a_rec = _feat_to_record(a_doc)
        b_rec = _feat_to_record(b_doc)

        # Easy negatives should be far apart (> 50 ft)
        dist_diff = abs(a_rec.corrected_distance_ft - b_rec.corrected_distance_ft)
        if dist_diff < 50.0:
            continue

        run_a = runs_by_id.get(r1, {})
        run_b = runs_by_id.get(r2, {})
        year_a = run_a.get("year", 2000)
        year_b = run_b.get("year", 2005)
        tool_qual = run_b.get("tool_qualification", {})
        tool_weight = tool_qual.get("confidence_weight", 0.85) if isinstance(tool_qual, dict) else 0.85

        ctx = PairContext(
            run_gap_years=abs(year_b - year_a),
            api_1163_tool_weight=tool_weight,
            dtw_residual=None,
            icp_residual=None,
            anchor_density=None,
        )

        fv = extract_features(a_rec, b_rec, ctx)
        X_neg.append(fv)
        meta_neg.append({
            "feature_a": a_id,
            "feature_b": b_id,
            "job_id": "",
            "det_score": None,
            "det_category": None,
            "label": 0,
            "neg_type": "easy",
        })
        neg_pair_set.add((a_id, b_id))

    n_hard = sum(1 for m in meta_neg if m["neg_type"] == "hard")
    n_easy = sum(1 for m in meta_neg if m["neg_type"] == "easy")
    print(f"    Easy negatives: {n_easy}")
    print(f"  Total negatives: {len(X_neg)} (hard: {n_hard}, easy: {n_easy})")
    print(f"  Negative:positive ratio: {len(X_neg)/max(n_pos,1):.1f}:1")

    # ══════════════════════════════════════════════════════════════
    # Combine & Shuffle
    # ══════════════════════════════════════════════════════════════
    X = np.array(X_pos + X_neg, dtype=np.float64)
    y = np.array([1] * n_pos + [0] * len(X_neg), dtype=np.int32)
    metadata = meta_pos + meta_neg

    # Shuffle
    indices = np.random.permutation(len(X))
    X = X[indices]
    y = y[indices]
    metadata = [metadata[i] for i in indices]

    print(f"\n[DATASET] Final dataset: {len(X)} samples, {NUM_FEATURES} features")
    print(f"  Positives: {n_pos} ({n_pos/len(X)*100:.1f}%)")
    print(f"  Negatives: {len(X_neg)} ({len(X_neg)/len(X)*100:.1f}%)")
    print(f"  Feature names: {FEATURE_NAMES}")

    client.close()
    return X, y, metadata


def save_dataset(output_path: str, X: np.ndarray, y: np.ndarray, metadata: list[dict]):
    """Save dataset to .npz file with metadata."""
    import json
    np.savez_compressed(
        output_path,
        X=X,
        y=y,
        feature_names=FEATURE_NAMES,
        metadata_json=json.dumps(metadata),
    )
    print(f"[DATASET] Saved to {output_path} ({os.path.getsize(output_path) / 1024:.0f} KB)")


def load_dataset(path: str) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """Load dataset from .npz file."""
    import json
    data = np.load(path, allow_pickle=True)
    X = data["X"]
    y = data["y"]
    metadata = json.loads(str(data["metadata_json"]))
    return X, y, metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build XGBoost training dataset from MongoDB")
    parser.add_argument("--mongo-uri", required=True, help="MongoDB connection URI")
    parser.add_argument("--db", default="ili_alignment", help="Database name")
    parser.add_argument("--output", default="ml-sidecar/training/dataset.npz", help="Output file")
    parser.add_argument("--neg-ratio", type=float, default=3.0, help="Negative:positive sample ratio")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    X, y, meta = build_dataset(
        mongo_uri=args.mongo_uri,
        db_name=args.db,
        neg_pos_ratio=args.neg_ratio,
        seed=args.seed,
    )
    save_dataset(args.output, X, y, meta)
