# ILI Data Alignment Platform — Workflow Guide

> **Two-app architecture:** The **Frontend** (`:3000`) provides the animated landing page, login/register, and proxies all API calls. The **Backend** (`:3001`) houses the full pipeline engine, results dashboard, and visualization suite. Both share a single MongoDB Atlas database.

---

## Table of Contents

1. [Registration & Account Setup](#1-registration--account-setup)
2. [Login & Authentication](#2-login--authentication)
3. [Dashboard Overview](#3-dashboard-overview)
4. [Uploading an ILI Dataset](#4-uploading-an-ili-dataset)
5. [Running the Alignment Pipeline](#5-running-the-alignment-pipeline)
6. [Viewing Pipeline Progress](#6-viewing-pipeline-progress)
7. [Exploring Results — Summary](#7-exploring-results--summary)
8. [Exploring Results — Matches Table](#8-exploring-results--matches-table)
9. [Exploring Results — Visualization](#9-exploring-results--visualization)
10. [Exploring Results — Standards Assessment](#10-exploring-results--standards-assessment)
11. [Exploring Results — Audit Trail](#11-exploring-results--audit-trail)
12. [Exporting Reports](#12-exporting-reports)
13. [ML Sidecar (Experimental)](#13-ml-sidecar-experimental)
14. [AI Event Type Canonicalization](#14-ai-event-type-canonicalization)

---

## 1. Registration & Account Setup

**Where:** Frontend — `http://localhost:3000/register`

### Steps

1. Navigate to the Register page from the Login screen or directly via URL.
2. Fill in the registration form:
   - **Name** — Your full name
   - **Email** — Must be unique; becomes your login credential
   - **Password** — Minimum 6 characters
   - **Organization** — Your pipeline operating company name. If the org already exists in the system, you'll be added to it; otherwise a new org is created.
3. Click **Create Account**.
4. The system:
   - Validates all fields (Zod schema)
   - Checks email uniqueness against the `users` collection
   - Finds or creates the `Org` document
   - Creates the `User` document with bcrypt-hashed password
   - Auto-logs you in via NextAuth credentials flow
5. You're redirected to the **Dashboard**.

### What Happens Behind the Scenes

- `POST /api/auth/register` → creates User + Org in MongoDB
- `POST /api/auth/callback/credentials` → establishes JWT session
- Session cookie (`next-auth.session-token`) is set for subsequent requests

---

## 2. Login & Authentication

**Where:** Frontend — `http://localhost:3000/login`

### Steps

1. Arrive at the Login page — an animated icy mountain landscape with GSAP-driven clouds, snow particles, and parallax mountain layers.
2. Enter your **Email** and **Password**.
3. Click **Sign In**.
4. On success, you're redirected to the Dashboard.
5. On failure, an error message appears on the login card.

### Navigation Shortcut

- From the **Landing Page** (`/`), scroll down to auto-navigate to the Login page.
- From the **Login page**, scroll up to return to the Landing page.

### Session Management

- JWT-based sessions via NextAuth (no database sessions)
- Protected routes (`/dashboard`, `/upload`, `/jobs/*`) are guarded by the frontend proxy middleware
- Sessions include your `orgId` for multi-tenant data scoping — you only see your organization's data

---

## 3. Dashboard Overview

**Where:** Frontend — `http://localhost:3000/dashboard`

### What You See

- **Quick-action stat cards:**
  - Total Datasets uploaded
  - Total Alignment Jobs
  - Completed jobs
  - Failed jobs
  - Upload shortcut card
- **Recent Datasets table** — Name, upload date, size, with a "View" button for each
- **Recent Alignment Jobs table** — Job ID (last 8 chars), color-coded status badge (COMPLETED = green, RUNNING = blue, FAILED = red, QUEUED = gray), ML toggle state, creation timestamp, and a "Results →" link for completed jobs

### Actions Available

| Action | Where It Goes |
|--------|---------------|
| Click "Upload Dataset" | `/upload` |
| Click dataset "View" | `/upload?datasetId=X` (loads that dataset's details) |
| Click job "Results →" | Redirects to backend: `localhost:3001/alignment/{jobId}` |

---

## 4. Uploading an ILI Dataset

**Where:** Frontend — `http://localhost:3000/upload`

### Supported Formats

- **Excel files** (`.xlsx`, `.xls`) — each sheet named by inspection year (e.g., `2018`, `2021`, `2024`)
- **CSV files** (`.csv`)
- **Maximum size:** 50 MB

### Steps

1. **Drag-and-drop** your file onto the upload zone, or click **Browse** to select it.
2. Give the dataset a **name** (e.g., `Pipeline Segment 142 — 3 Run History`).
3. Click **Upload & Parse**.
4. The system runs **Stage 1 (Ingest)** and **Stage 2 (Normalize)** immediately:
   - Parses Excel sheets by year
   - Detects ILI vendor column layouts
   - Canonicalizes event types (using Gemini AI if available, regex fallback otherwise)
   - Normalizes distances, clock positions, depth measurements
   - Creates `Run` and `Feature` documents in the database
5. A success card appears showing:
   - Number of ILI runs detected (one per sheet/year)
   - Total features parsed across all runs
   - Per-run details: year, vendor (if detected), feature count

### Expected Column Names

The parser looks for columns containing (case-insensitive partial match):

| Data | Column names recognized |
|------|------------------------|
| Distance | `dist`, `odometer`, `log_dist`, `abs_dist` |
| Event type | `event`, `type`, `anomaly`, `indication` |
| Clock position | `clock`, `orient`, `o'clock` |
| Depth | `depth`, `wall_loss`, `metal_loss` |
| Joint/weld number | `joint`, `weld`, `jt_num` |
| Width/length | `width`, `length`, `axial`, `circ` |

---

## 5. Running the Alignment Pipeline

**Where:** Frontend upload page, after a dataset is loaded

### Steps

1. After uploading (or selecting an existing dataset), you'll see run summary cards.
2. **(Optional)** Toggle the **Enable ML Sidecar** switch:
   - When ON: XGBoost similarity scoring, DBSCAN clustering, and growth prediction run alongside the deterministic pipeline
   - Results are blended at 80% deterministic / 20% ML (advisory only)
   - Requires the ML sidecar server to be running on port 8100
3. Click **Run Alignment Pipeline**.
4. The system creates an `AlignmentJob` and queues it for processing.
5. You're redirected to the **Results page** on the backend (`localhost:3001/alignment/{jobId}`).

### What the Pipeline Does (7 Stages)

| # | Stage | Duration | What Happens |
|---|-------|----------|--------------|
| 1 | Ingest | Already done | File parsed at upload time |
| 2 | Normalize | Already done | Events canonicalized at upload time |
| 3 | Anchor Match | ~2–10s | Matches girth welds between runs using DTW (Dynamic Time Warping) to establish alignment reference points |
| 4 | Distance Correction | ~1–5s | Piecewise-linear odometer correction using anchor pairs, refined by ICP (Iterative Closest Point) per weld segment |
| 5 | Anomaly Match | ~5–30s | Hungarian algorithm assignment with ensemble scoring (distance + clock + type + depth). Refines baseline matches, identifies new/unsupported anomalies |
| 6 | Score & Standards | ~5–20s | Final confidence scoring (HIGH/MEDIUM/LOW), ASME B31.8S severity, API 1163 tool confidence, NACE SP0502 growth classification, PHMSA compliance, interaction zone graph analysis. ML sidecar scoring if enabled |
| 7 | Export | ~2–5s | Generates XLSX report + CSV files to disk |

---

## 6. Viewing Pipeline Progress

**Where:** Backend — `http://localhost:3001/alignment/{jobId}`

### Real-Time Progress

- The page **polls every 3 seconds** while the pipeline is running.
- The **Stage Stepper** at the top shows each of the 7 stages with status indicators:
  - ⬜ PENDING (gray)
  - 🔵 RUNNING (blue, pulsing)
  - ✅ DONE (green)
  - ❌ FAILED (red)
- Overall **progress percentage** updates as stages complete.

### If a Stage Fails

- The error message is displayed on the failed stage.
- Subsequent stages show as PENDING (they won't run).
- Check the **Audit** tab for detailed error context.

---

## 7. Exploring Results — Summary

**Where:** Backend results page → **Summary** tab

### Key Metrics Displayed

| Metric | Description |
|--------|-------------|
| **Total Matches** | Number of anomaly pairs matched across runs |
| **Total Exceptions** | Unmatched features, severity alerts, and flagged items |
| **Confidence Breakdown** | Count of HIGH (≥75%), MEDIUM (50–74%), and LOW (<50%) confidence matches |
| **Avg Growth Rate** | Mean depth-change rate across all matched corrosion pairs (%/yr) |
| **ASME B31.8S Severity** | Count of IMMEDIATE, SCHEDULED, and MONITORING findings |
| **Accelerating Growth** | Number of anomalies showing accelerating corrosion (NACE SP0502) |
| **Interaction Zones** | Anomaly clusters within interaction distance (ASME B31.8S §A-4.3) |

### ML Sidecar Summary (if enabled)

- Pairs scored by XGBoost
- Growth trends assessed
- DBSCAN clusters found
- ML errors encountered

---

## 8. Exploring Results — Matches Table

**Where:** Backend results page → **Matches** tab

### Table Columns

| Column | Description |
|--------|-------------|
| **Confidence** | Match confidence score (0–100%) with colored badge |
| **Category** | HIGH / MEDIUM / LOW |
| **Match Category** | `CONTROL_POINT`, `ANOMALY_MATCHED`, `NEW_ANOMALY`, etc. |
| **Event Type** | Canonical event type (METAL_LOSS, GIRTH_WELD, DENT, etc.) |
| **Dist A / Dist B** | Reported distance in each run (ft) |
| **Residual** | Distance difference after correction (ft) |
| **Clock Residual** | Clock position difference (hours) |
| **Depth Growth %/yr** | Annual depth change rate |
| **Years Between** | Time gap between the matched runs |
| **ASME Severity** | IMMEDIATE / SCHEDULED / MONITORING |
| **NACE Class** | accelerating / growing / stable / undetermined |
| **API 1163 Adj.** | Tool-adjusted confidence (%) |

### Sorting & Pagination

- Click any column header to sort.
- Default sort: confidence score descending (highest confidence matches first).
- Paginated at 10,000 rows per page.

---

## 9. Exploring Results — Visualization

**Where:** Backend results page → **Visualization** tab

### 2D Alignment Diagram

The primary visualization is a multi-run **pipe strip chart**:

- Each run is a horizontal bar representing the pipeline, positioned vertically by inspection year.
- **Feature markers** appear along each run at their reported distances:
  - **Gray rectangles** = Girth Welds
  - **Gold bowties** = Valves
  - **Blue circles (T)** = Tees
  - **Red circles** = Bends
  - **Tan ovals** = Anomalies (existing)
  - **Red dashed ovals** = New anomalies (not seen in previous runs)
- **Match lines** connect corresponding features across runs when you click a feature.
- **Severity rings** highlight IMMEDIATE (red) and SCHEDULED (orange) findings.
- **Interaction zone diamonds** (purple) show ASME B31.8S cluster indicators.

### Interactive Controls

| Control | Action |
|---------|--------|
| **Scroll wheel** | Zoom in/out at cursor position |
| **◀ / ▶ buttons** | Pan left/right |
| **+ / − / Reset** | Zoom in, zoom out, reset to full view |
| **Click a feature** | Highlight it and all matched partners across runs; show connecting match lines |
| **Hover a feature** | Show detailed tooltip with distance, drift, depth, clock position, match status, standards assessment, and ML augmentation |
| **Show Severity** | Toggle severity ring overlay |
| **Show Low-Conf** | Toggle display of hidden (low-confidence) features |
| **Control Points checkbox** | Show/hide girth welds, valves, tees, bends |
| **Anomalies checkbox** | Show/hide anomaly markers |

### Visibility Gating

Features are scored on 4 confidence dimensions and assigned visibility states:
- **Full** — High confidence, normally visible
- **Dimmed** — Moderate confidence, shown at reduced opacity (25%)
- **Hidden** — Low confidence, hidden unless "Show Low-Conf" is toggled on

### Tooltip Details

Hovering any feature shows:
- Type and raw type string
- Distance (ft) from pipeline start
- Drift from reported position (ft)
- Depth (% wall loss) and clock position
- Joint number
- Match status and confidence score
- Growth rate (%/yr)
- ASME B31.8S severity + repair recommendation
- NACE SP0502 corrosion class + remaining life estimate
- API 1163 tool-adjusted confidence
- ML augmentation score (if applicable) with model ID and blend formula

---

## 10. Exploring Results — Standards Assessment

**Where:** Backend results page → **Standards** tab

### Standards Applied Per Match

| Standard | What It Assesses |
|----------|-----------------|
| **ASME B31.8S** | Severity classification (IMMEDIATE / SCHEDULED / MONITORING), repair recommendation, interaction zone detection per §A-4.3 |
| **API 1163** | ILI tool qualification — adjusts confidence score based on tool weight (accuracy characteristics) |
| **NACE SP0502** | Corrosion growth classification — `accelerating`, `growing`, `stable`, or `undetermined`. Includes remaining-life estimate (years) |
| **PHMSA** | Regulatory compliance record — documents audit-ready information for pipeline safety reporting |

### What You See

- Per-match breakdown of all four standards
- Color-coded severity indicators
- Interaction zone graph analysis results
- Corrosion growth trends over time

---

## 11. Exploring Results — Audit Trail

**Where:** Backend results page → **Audit** tab

### Audit Events Logged

| Event | When | What's Recorded |
|-------|------|-----------------|
| `JOB_CREATED` | Pipeline start | Job ID, dataset ID, ML enabled flag |
| `DTW_ALIGNMENT` | Stage 3 | DTW path length, cost, normalized score per run pair |
| `ICP_REFINEMENT` | Stage 4 | Per-segment ICP convergence, rotation, translation |
| `GRAPH_ANALYSIS` | Stage 6 | Interaction graph node/edge counts, clusters found |
| `STANDARDS_ASSESSMENT` | Stage 6 | Summary of severity counts, growth classifications |
| `PHMSA_COMPLIANCE` | Stage 6 | Compliance record generation details |
| `ML_HOOKS_STATUS` | Stage 6 | ML sidecar connection status, pairs scored, errors |
| `ML_CLUSTERING` | Stage 6 | DBSCAN cluster count, noise point count |
| `PIPELINE_COMPLETED` | Stage 7 done | Total runtime, final counts |
| `PIPELINE_FAILED` | On error | Error message, failed stage, stack trace |

---

## 12. Exporting Reports

**Where:** Backend results page → download buttons at the bottom

### Available Exports

| Export | Format | Contents |
|--------|--------|----------|
| **Full Report** | `.xlsx` | Multi-sheet Excel workbook: Summary, All Matches, Exceptions, Standards Details, Audit Log |
| **Matches** | `.csv` | All matched pairs with scores, categories, distances, growth rates, standards_applied |
| **Exceptions** | `.csv` | All flagged items: unmatched features, severity alerts, accelerated growth warnings |

### How to Download

1. Navigate to any completed job's results page.
2. Click the **Download** button for the format you need.
3. The file downloads directly to your browser's downloads folder.

---

## 13. ML Sidecar (Experimental)

**Where:** Toggle on the Upload page before running alignment

### What It Does

The ML sidecar is an **advisory** system that runs alongside the deterministic pipeline:

| Model | Purpose | Algorithm |
|-------|---------|-----------|
| **Similarity Scoring** | Predicts whether two features are the same anomaly | XGBoost binary classifier |
| **Spatial Clustering** | Groups nearby anomalies into clusters | DBSCAN |
| **Growth Prediction** | Estimates future corrosion growth trends | Growth regression model |

### Blending Rule

```
final_score = deterministic_score × 0.8 + ml_similarity × 0.2
```

The ML score never overrides the deterministic pipeline — it can only nudge scores up or down by ±20%.

### Starting the ML Sidecar

```bash
cd backend/ml-sidecar
pip install -r requirements.txt
uvicorn main:app --port 8100
```

### Graceful Degradation

If the ML sidecar is not running when a job is started with ML enabled:
- The pipeline logs a warning and continues without ML
- All deterministic scoring works normally
- The results page shows "ML sidecar unavailable" in the ML section

---

## 14. AI Event Type Canonicalization

**Where:** Runs automatically during dataset upload (Stage 2 — Normalize)

### What It Does

Raw ILI data comes with vendor-specific event type names that vary wildly:
- `"METALLOSS"`, `"Metal Loss"`, `"ML"`, `"Corr"` → all map to `METAL_LOSS`
- `"GIRTH WELD"`, `"GW"`, `"Circ-Weld"` → all map to `GIRTH_WELD`

The system uses **Google Gemini 2.5 Flash** to intelligently map raw strings to canonical tokens:

```
METAL_LOSS | CLUSTER | METAL_LOSS_MFG | DENT | SEAM_WELD_MFG |
GIRTH_WELD | VALVE | TEE | TAP | BEND | FIELD_BEND |
FLANGE | SUPPORT | LAUNCHER | RECEIVER | AGM | OTHER
```

### Fallback

If Gemini is unavailable (no API key, rate limited, network error):
- A regex-based fallback (`regexCanonicalize()`) handles common patterns
- Unknown types default to `OTHER`
- The system never blocks on AI — it's purely advisory
