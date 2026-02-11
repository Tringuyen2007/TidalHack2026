/* ------------------------------------------------------------------ */
/*  API client — all calls proxied to backend via Next.js rewrites    */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(path, {
      ...options,
      credentials: "include",
    });

    // Binary responses (CSV / XLSX downloads)
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/csv") || ct.includes("spreadsheetml")) {
      return { data: res as unknown as T, status: res.status };
    }

    const json = await res.json();
    if (!res.ok) return { error: json.error || "Request failed", status: res.status };
    return { data: json as T, status: res.status };
  } catch (err) {
    return { error: (err as Error).message, status: 0 };
  }
}

/* ─── Dataset endpoints ─── */

export interface DatasetListResponse {
  datasets: any[];
}
export interface DatasetDetailResponse {
  dataset: any;
  runs: any[];
}
export interface DatasetUploadResponse {
  datasetId: string;
  runs: any[];
  totalFeatures: number;
}

/* ─── Job endpoints ─── */

export interface JobListResponse {
  jobs: any[];
}
export interface JobDetailResponse {
  job: any;
}
export interface JobRunResponse {
  jobId: string;
  status: string;
}

/* ─── Result endpoints ─── */

export interface ResultSummaryResponse {
  summary: any;
}
export interface MatchesResponse {
  rows: any[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ExceptionsResponse {
  rows: any[];
}
export interface AuditResponse {
  rows: any[];
}

/* ─── Centralized API ─── */

export const api = {
  /* ── Datasets ── */
  datasets: {
    list: () => request<DatasetListResponse>("/api/datasets"),

    get: (id: string) =>
      request<DatasetDetailResponse>(`/api/datasets/${id}`),

    upload: (file: File, name?: string) => {
      const form = new FormData();
      form.append("file", file);
      if (name) form.append("name", name);
      return request<DatasetUploadResponse>("/api/datasets", {
        method: "POST",
        body: form,
      });
    },
  },

  /* ── Alignment jobs ── */
  jobs: {
    list: () => request<JobListResponse>("/api/alignment/jobs"),

    get: (id: string) =>
      request<JobDetailResponse>(`/api/alignment/jobs/${id}`),

    run: (datasetId: string, enableMl = false) =>
      request<JobRunResponse>("/api/alignment/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, enableMl }),
      }),
  },

  /* ── Results ── */
  results: {
    summary: (jobId: string) =>
      request<ResultSummaryResponse>(`/api/alignment/results/${jobId}`),

    matches: (jobId: string, page = 1, pageSize = 100) =>
      request<MatchesResponse>(
        `/api/alignment/results/${jobId}/matches?page=${page}&pageSize=${pageSize}`
      ),

    exceptions: (jobId: string) =>
      request<ExceptionsResponse>(`/api/alignment/results/${jobId}/exceptions`),

    audit: (jobId: string) =>
      request<AuditResponse>(`/api/alignment/results/${jobId}/audit`),

    visualization: (jobId: string) =>
      request<any>(`/api/alignment/results/${jobId}/visualization`),
  },

  /* ── File exports ── */
  exports: {
    download: async (
      jobId: string,
      type: "xlsx" | "matches" | "exceptions"
    ) => {
      const res = await fetch(`/api/export/${jobId}/${type}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = type === "xlsx" ? "xlsx" : "csv";
      a.download = `${type}-${jobId}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  },
};
