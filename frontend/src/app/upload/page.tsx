"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { UploadIcon } from "@/components/icons";
import styles from "./upload.module.css";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function UploadPage() {
  return (
    <Suspense fallback={<DashboardLayout><div className={styles.heading}>Loading…</div></DashboardLayout>}>
      <UploadPageInner />
    </Suspense>
  );
}

function UploadPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const datasetIdParam = searchParams.get("datasetId");

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [runningJob, setRunningJob] = useState(false);
  const [enableMl, setEnableMl] = useState(false);

  // If datasetId is in URL, load that dataset
  const [datasetDetail, setDatasetDetail] = useState<any>(null);

  useEffect(() => {
    if (datasetIdParam) {
      api.datasets.get(datasetIdParam).then((res) => {
        if (res.data) setDatasetDetail(res.data);
      });
    }
  }, [datasetIdParam]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setError(""); }
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");

    const res = await api.datasets.upload(file, name || undefined);
    setUploading(false);

    if (res.error) {
      setError(res.error);
      return;
    }

    setUploadResult(res.data);
  };

  const handleRunAlignment = async () => {
    const dsId = uploadResult?.datasetId || datasetIdParam;
    if (!dsId) return;
    setRunningJob(true);
    setError("");

    const res = await api.jobs.run(dsId, enableMl);
    setRunningJob(false);

    if (res.error) {
      setError(res.error);
      return;
    }

    // Navigate to job results
    router.push(`/jobs/${res.data?.jobId}`);
  };

  return (
    <DashboardLayout>
      <h1 className={styles.heading}>Upload Dataset</h1>
      <p className={styles.subHeading}>Import an ILI Excel or CSV file to begin alignment</p>

      {/* ── Dataset detail view ── */}
      {datasetDetail && (
        <div className={styles.datasetDetail}>
          <h2 className={styles.datasetTitle}>
            Dataset: {datasetDetail.dataset?.name || "Unnamed"}
          </h2>
          <div className={styles.runsGrid}>
            {(datasetDetail.runs ?? []).map((run: any) => (
              <div key={run._id} className={styles.runCard}>
                <div className={styles.runYear}>{run.year}</div>
                <div className={styles.runLabel}>{run.label}</div>
                <div className={styles.runFeatures}>
                  {run.feature_count ?? 0} features · {run.vendor || "Unknown vendor"}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.actions}>
            <button className={styles.runBtn} onClick={handleRunAlignment} disabled={runningJob}>
              {runningJob ? "Starting…" : "Run Alignment"}
            </button>
            <label className={styles.mlToggle}>
              <input type="checkbox" checked={enableMl} onChange={(e) => setEnableMl(e.target.checked)} />
              Enable ML sidecar
            </label>
          </div>
        </div>
      )}

      {/* ── Upload flow ── */}
      {!datasetIdParam && (
        <>
          <div
            className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className={styles.fileInput}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setFile(f); setError(""); }
              }}
            />
            <div className={styles.dropIcon}><UploadIcon /></div>
            <p className={styles.dropLabel}>
              {file ? file.name : "Drop your file here or click to browse"}
            </p>
            <p className={styles.dropHint}>Supports .xlsx, .xls, .csv — max 50 MB</p>
          </div>

          {file && (
            <div className={styles.selectedFile}>
              <p className={styles.fileName}>{file.name}</p>
              <p className={styles.fileSize}>{(file.size / 1024).toFixed(0)} KB</p>

              <div className={styles.nameField}>
                <label className={styles.label}>Dataset name (optional)</label>
                <input
                  className={styles.input}
                  placeholder="e.g. Line 42 — 2024 Run"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className={styles.actions}>
                <button className={styles.uploadBtn} onClick={handleUpload} disabled={uploading}>
                  {uploading ? "Uploading…" : "Upload & Parse"}
                </button>
                <button className={styles.clearBtn} onClick={() => { setFile(null); setUploadResult(null); }}>
                  Clear
                </button>
              </div>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {uploadResult && (
            <div className={styles.result}>
              <h3 className={styles.resultTitle}>✓ Upload Successful</h3>
              <p className={styles.resultMeta}>
                {uploadResult.runs?.length ?? 0} run sheet(s) detected · {uploadResult.totalFeatures ?? 0} total features
              </p>

              <button className={styles.runBtn} onClick={handleRunAlignment} disabled={runningJob}>
                {runningJob ? "Starting…" : "Run Alignment Pipeline"}
              </button>
              <label className={styles.mlToggle}>
                <input type="checkbox" checked={enableMl} onChange={(e) => setEnableMl(e.target.checked)} />
                Enable ML sidecar (advisory, 80/20 blend)
              </label>
            </div>
          )}
        </>
      )}
    </DashboardLayout>
  );
}
