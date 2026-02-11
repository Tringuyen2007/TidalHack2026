"""
XGBoost Training Pipeline
═══════════════════════════════════════════════════════════════════════

Trains an XGBoost binary classifier for anomaly-pair similarity.

  Objective:       binary:logistic
  Metric:          AUC-ROC  (primary), precision/recall at thresholds
  Validation:      5-fold stratified cross-validation
  Output:          ml-sidecar/artifacts/xgboost_similarity.json
  Feature report:  ml-sidecar/artifacts/feature_importance.json

Usage:
    python -m training.train_xgboost --dataset dataset.npz
    python -m training.train_xgboost --mongo-uri <URI>   # build + train

═══════════════════════════════════════════════════════════════════════
"""

import argparse
import json
import os
import sys
import numpy as np
from datetime import datetime
from training.features import FEATURE_NAMES, NUM_FEATURES

try:
    import xgboost as xgb
    from sklearn.model_selection import StratifiedKFold, train_test_split
    from sklearn.metrics import (
        roc_auc_score,
        precision_recall_curve,
        classification_report,
        confusion_matrix,
    )
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install xgboost scikit-learn")
    sys.exit(1)


# ── Default Hyperparameters ──
DEFAULT_PARAMS = {
    "objective": "binary:logistic",
    "eval_metric": "auc",
    "max_depth": 5,
    "learning_rate": 0.1,
    "n_estimators": 200,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 3,
    "gamma": 0.1,
    "reg_alpha": 0.01,
    "reg_lambda": 1.0,
    "scale_pos_weight": 1.0,  # will be adjusted based on class ratio
    "random_state": 42,
    "n_jobs": -1,
    "missing": -1.0,  # our sentinel value
}

ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), "..", "artifacts")


def _ensure_artifacts_dir():
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)


def train_model(
    X: np.ndarray,
    y: np.ndarray,
    params: dict | None = None,
    n_folds: int = 5,
    test_size: float = 0.2,
) -> dict:
    """
    Train XGBoost classifier with cross-validation and holdout test.

    Returns dict with:
      - model: fitted XGBClassifier
      - metrics: dict of evaluation metrics
      - feature_importance: dict of feature → importance
      - thresholds: precision/recall at key thresholds
    """
    _ensure_artifacts_dir()

    p = {**DEFAULT_PARAMS, **(params or {})}

    # Adjust scale_pos_weight for class imbalance
    n_pos = int(y.sum())
    n_neg = int(len(y) - n_pos)
    if n_pos > 0:
        p["scale_pos_weight"] = n_neg / n_pos
    print(f"[TRAIN] Class balance: {n_pos} positive, {n_neg} negative (ratio {n_neg/max(n_pos,1):.1f}:1)")
    print(f"[TRAIN] scale_pos_weight = {p['scale_pos_weight']:.2f}")

    # ── Train/Test Split ──
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=p["random_state"], stratify=y
    )
    print(f"[TRAIN] Train: {len(X_train)} samples, Test: {len(X_test)} samples")

    # ── Cross-Validation ──
    print(f"[TRAIN] Running {n_folds}-fold stratified cross-validation...")
    cv_aucs = []
    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=p["random_state"])

    for fold, (train_idx, val_idx) in enumerate(skf.split(X_train, y_train), 1):
        X_fold_train = X_train[train_idx]
        y_fold_train = y_train[train_idx]
        X_fold_val = X_train[val_idx]
        y_fold_val = y_train[val_idx]

        clf = xgb.XGBClassifier(
            **{k: v for k, v in p.items() if k not in ("missing",)},
        )
        clf.set_params(missing=p["missing"])
        clf.fit(
            X_fold_train, y_fold_train,
            eval_set=[(X_fold_val, y_fold_val)],
            verbose=False,
        )

        y_pred_proba = clf.predict_proba(X_fold_val)[:, 1]
        fold_auc = roc_auc_score(y_fold_val, y_pred_proba)
        cv_aucs.append(fold_auc)
        print(f"  Fold {fold}: AUC = {fold_auc:.4f}")

    mean_cv_auc = np.mean(cv_aucs)
    std_cv_auc = np.std(cv_aucs)
    print(f"  Mean CV AUC: {mean_cv_auc:.4f} ± {std_cv_auc:.4f}")

    # ── Final Model Training ──
    print("[TRAIN] Training final model on full training set...")
    final_clf = xgb.XGBClassifier(
        **{k: v for k, v in p.items() if k not in ("missing",)},
    )
    final_clf.set_params(missing=p["missing"])
    final_clf.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    # ── Holdout Test Evaluation ──
    y_test_proba = final_clf.predict_proba(X_test)[:, 1]
    test_auc = roc_auc_score(y_test, y_test_proba)
    print(f"\n[EVAL] Holdout Test AUC: {test_auc:.4f}")

    # Precision/Recall at key thresholds
    precision, recall, pr_thresholds = precision_recall_curve(y_test, y_test_proba)
    threshold_report = {}
    for t in [0.3, 0.5, 0.7, 0.8, 0.9]:
        y_pred_t = (y_test_proba >= t).astype(int)
        tp = int(((y_pred_t == 1) & (y_test == 1)).sum())
        fp = int(((y_pred_t == 1) & (y_test == 0)).sum())
        fn = int(((y_pred_t == 0) & (y_test == 1)).sum())
        prec = tp / max(tp + fp, 1)
        rec = tp / max(tp + fn, 1)
        threshold_report[str(t)] = {"precision": round(prec, 4), "recall": round(rec, 4)}
        print(f"  Threshold {t:.1f}: P={prec:.3f} R={rec:.3f}")

    # Classification report at 0.5
    y_pred_50 = (y_test_proba >= 0.5).astype(int)
    print(f"\n[EVAL] Classification Report (threshold=0.5):")
    print(classification_report(y_test, y_pred_50, target_names=["Non-Match", "Match"]))
    cm = confusion_matrix(y_test, y_pred_50)
    print(f"  Confusion Matrix:\n  {cm}")

    # ── Feature Importance ──
    importances = final_clf.feature_importances_
    fi = {name: round(float(imp), 6) for name, imp in zip(FEATURE_NAMES, importances)}
    fi_sorted = dict(sorted(fi.items(), key=lambda x: x[1], reverse=True))
    print(f"\n[EVAL] Feature Importance:")
    for name, imp in fi_sorted.items():
        bar = "█" * int(imp * 50)
        print(f"  {name:35s} {imp:.4f} {bar}")

    # ── Save Model ──
    model_path = os.path.join(ARTIFACTS_DIR, "xgboost_similarity.json")
    final_clf.save_model(model_path)
    print(f"\n[SAVE] Model → {model_path}")

    # ── Save Metrics ──
    metrics = {
        "trained_at": datetime.utcnow().isoformat() + "Z",
        "n_samples": int(len(X)),
        "n_positives": n_pos,
        "n_negatives": n_neg,
        "n_features": NUM_FEATURES,
        "feature_names": FEATURE_NAMES,
        "cv_folds": n_folds,
        "cv_auc_mean": round(mean_cv_auc, 4),
        "cv_auc_std": round(std_cv_auc, 4),
        "holdout_auc": round(test_auc, 4),
        "thresholds": threshold_report,
        "hyperparameters": {k: v for k, v in p.items() if k != "missing"},
    }
    metrics_path = os.path.join(ARTIFACTS_DIR, "training_metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"[SAVE] Metrics → {metrics_path}")

    # ── Save Feature Importance ──
    fi_path = os.path.join(ARTIFACTS_DIR, "feature_importance.json")
    with open(fi_path, "w") as f:
        json.dump(fi_sorted, f, indent=2)
    print(f"[SAVE] Feature importance → {fi_path}")

    return {
        "model": final_clf,
        "metrics": metrics,
        "feature_importance": fi_sorted,
        "thresholds": threshold_report,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train XGBoost similarity classifier")
    parser.add_argument("--dataset", help="Path to dataset.npz file")
    parser.add_argument("--mongo-uri", help="MongoDB URI (builds dataset first)")
    parser.add_argument("--db", default="ili_alignment", help="Database name")
    parser.add_argument("--folds", type=int, default=5, help="CV folds")
    parser.add_argument("--test-size", type=float, default=0.2, help="Test split fraction")
    args = parser.parse_args()

    if args.dataset:
        from training.build_dataset import load_dataset
        X, y, meta = load_dataset(args.dataset)
    elif args.mongo_uri:
        from training.build_dataset import build_dataset, save_dataset
        X, y, meta = build_dataset(mongo_uri=args.mongo_uri, db_name=args.db)
        save_dataset(os.path.join(ARTIFACTS_DIR, "dataset.npz"), X, y, meta)
    else:
        print("ERROR: Provide --dataset or --mongo-uri")
        sys.exit(1)

    result = train_model(X, y, n_folds=args.folds, test_size=args.test_size)
    print(f"\n✓ Training complete. Holdout AUC: {result['metrics']['holdout_auc']:.4f}")
