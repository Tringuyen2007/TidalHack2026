"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getSession, type Session } from "@/lib/auth";
import DashboardLayout from "@/components/DashboardLayout";
import { UploadIcon, AlignIcon, MatchIcon, GrowthIcon, FlagIcon, ExportIcon } from "@/components/icons";
import styles from "./dashboard.module.css";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const s = await getSession();
      if (!s) { router.push("/login"); return; }
      setSession(s);

      const [dsRes, jobRes] = await Promise.all([
        api.datasets.list(),
        api.jobs.list(),
      ]);
      if (dsRes.data) setDatasets(dsRes.data.datasets ?? []);
      if (jobRes.data) setJobs(jobRes.data.jobs ?? []);
      setLoading(false);
    })();
  }, [router]);

  const statusColor = (s: string) => {
    switch (s) {
      case "COMPLETED": return styles.badgeGreen;
      case "RUNNING": case "QUEUED": return styles.badgeBlue;
      case "FAILED": return styles.badgeRed;
      default: return styles.badgeGray;
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className={styles.loading}>Loading…</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <h1 className={styles.heading}>Dashboard</h1>
      <p className={styles.subHeading}>
        Welcome back, {session?.user?.name || session?.user?.email || "engineer"}.
      </p>

      {/* ── Quick-action cards ── */}
      <div className={styles.grid}>
        <a href="/upload" className={styles.card}>
          <div className={styles.cardIcon}><UploadIcon /></div>
          <h3 className={styles.cardTitle}>Upload Dataset</h3>
          <p className={styles.cardDesc}>Import ILI Excel/CSV inspection runs</p>
        </a>
        <div className={styles.card}>
          <div className={styles.cardIcon}><AlignIcon /></div>
          <h3 className={styles.cardTitle}>{datasets.length}</h3>
          <p className={styles.cardDesc}>Datasets uploaded</p>
        </div>
        <div className={styles.card}>
          <div className={styles.cardIcon}><MatchIcon /></div>
          <h3 className={styles.cardTitle}>{jobs.length}</h3>
          <p className={styles.cardDesc}>Alignment jobs run</p>
        </div>
        <div className={styles.card}>
          <div className={styles.cardIcon}><GrowthIcon /></div>
          <h3 className={styles.cardTitle}>
            {jobs.filter((j: any) => j.status === "COMPLETED").length}
          </h3>
          <p className={styles.cardDesc}>Completed analyses</p>
        </div>
        <div className={styles.card}>
          <div className={styles.cardIcon}><FlagIcon /></div>
          <h3 className={styles.cardTitle}>
            {jobs.filter((j: any) => j.status === "FAILED").length}
          </h3>
          <p className={styles.cardDesc}>Failed jobs</p>
        </div>
        <div className={styles.card}>
          <div className={styles.cardIcon}><ExportIcon /></div>
          <h3 className={styles.cardTitle}>Export</h3>
          <p className={styles.cardDesc}>XLSX / CSV downloads in job results</p>
        </div>
      </div>

      {/* ── Recent Datasets ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Datasets</h2>
        {datasets.length === 0 ? (
          <p className={styles.empty}>No datasets yet. <a href="/upload" className={styles.link}>Upload one →</a></p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Uploaded</th>
                  <th>Size</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {datasets.slice(0, 10).map((ds: any) => (
                  <tr key={ds._id}>
                    <td className={styles.cellBold}>{ds.name || "Unnamed"}</td>
                    <td>{new Date(ds.createdAt).toLocaleDateString()}</td>
                    <td>{ds.file_size_bytes ? `${(ds.file_size_bytes / 1024).toFixed(0)} KB` : "—"}</td>
                    <td>
                      <button
                        className={styles.tableBtn}
                        onClick={() => router.push(`/upload?datasetId=${ds._id}`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recent Jobs ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Alignment Jobs</h2>
        {jobs.length === 0 ? (
          <p className={styles.empty}>No alignment jobs yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Status</th>
                  <th>ML</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job: any) => (
                  <tr key={job._id}>
                    <td className={styles.cellMono}>{job._id.slice(-8)}</td>
                    <td><span className={statusColor(job.status)}>{job.status}</span></td>
                    <td>{job.enable_ml ? "On" : "Off"}</td>
                    <td>{new Date(job.createdAt).toLocaleDateString()}</td>
                    <td>
                      {job.status === "COMPLETED" && (
                        <button
                          className={styles.tableBtn}
                          onClick={() => router.push(`/jobs/${job._id}`)}
                        >
                          Results →
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DashboardLayout>
  );
}
