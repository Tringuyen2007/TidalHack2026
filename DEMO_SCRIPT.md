# ILI Data Alignment Platform — Demo Script

> **Estimated demo time:** 10–15 minutes
> **Prerequisites:** Both servers running (`backend :3001`, `frontend :3000`), MongoDB connected, sample `.xlsx` dataset ready

---

## Pre-Demo Setup Checklist

```bash
# Terminal 1 — Backend
cd backend && npm run dev          # Starts on :3001

# Terminal 2 — Frontend
cd frontend && npm run dev         # Starts on :3000

# Terminal 3 — ML Sidecar (optional, for ML demo)
cd backend/ml-sidecar && pip install -r requirements.txt && uvicorn main:app --port 8100
```

Verify: Open `http://localhost:3000` — you should see the animated landing page.

---

## ACT 1: First Impressions (2 min)

### Scene 1 — Landing Page

**Open** `http://localhost:3000` in your browser.

**Say:**
> "This is the ILI Data Alignment Platform. It takes inline inspection data from multiple pipeline runs — often years apart — and aligns them to quantify corrosion growth, flag critical anomalies, and generate audit-ready reports that comply with ASME B31.8S, API 1163, and NACE SP0502."

**Show:**
- The animated mountain landscape — SVG peaks, drifting clouds, falling snow
- The hero text: *"Corrosion growth quantification and anomaly matching for pipeline integrity"*
- Point out the clean, polished UI

**Action:** Scroll down to transition to the login page.

**Say:**
> "The scroll gesture navigates between the landing and login views — a smooth, app-like experience."

---

### Scene 2 — Registration

**Action:** Click "Create Account" or navigate to `/register`.

**Say:**
> "Let's create a new account. The platform is multi-tenant — each user belongs to an organization, and all data is scoped to that org."

**Fill in:**
- Name: `Demo User`
- Email: `demo@tidalhacks.com`
- Password: `demo12345`
- Organization: `TidalHacks Pipeline Co`

**Click** Create Account.

**Say:**
> "Behind the scenes, this creates the user with bcrypt-hashed credentials, finds or creates the organization, and establishes a JWT session — all through NextAuth."

---

## ACT 2: Uploading Data (3 min)

### Scene 3 — Dashboard

**You're now on the dashboard.**

**Say:**
> "The dashboard shows all your datasets and alignment jobs at a glance. Since this is a fresh account, it's empty — let's upload some data."

**Action:** Click "Upload Dataset".

---

### Scene 4 — Upload Page

**Say:**
> "The platform accepts Excel workbooks where each sheet represents a different ILI inspection run, named by year. It also handles CSVs."

**Action:** Drag your sample `.xlsx` file onto the upload zone.

**Say:**
> "Watch what happens when we upload — the system immediately runs two pipeline stages: **Ingest** parses the Excel sheets, and **Normalize** canonicalizes all the event types, distances, and clock positions."

**Action:** Enter a dataset name and click **Upload & Parse**.

**Wait** for the success card.

**Say:**
> "It detected [X] inspection runs spanning [years]. That's [Y] total features — girth welds, anomalies, valves, and other pipeline components. The event type normalization used **Google Gemini AI** to intelligently map vendor-specific codes like 'METALLOSS' or 'ML' to our canonical taxonomy. If Gemini is unavailable, a regex fallback handles it — the system never blocks on AI."

**Point out** the run cards showing year, feature count, and vendor.

---

## ACT 3: Running the Pipeline (2 min)

### Scene 5 — Pipeline Launch

**Say:**
> "Now let's run the alignment pipeline. This is the core of the platform — 7 stages that take raw ILI data and produce fully aligned, standards-assessed results."

**(Optional) Toggle the ML sidecar switch ON.**

**Say (if toggling ML):**
> "I'm enabling the ML sidecar. This runs an XGBoost model alongside the deterministic pipeline. It's advisory — the ML score is blended at 80/20 with the deterministic score, so it can nudge results but never override them."

**Action:** Click **Run Alignment Pipeline**.

---

### Scene 6 — Pipeline Progress

**You're now on the backend results page.**

**Say:**
> "The page polls every 3 seconds. Watch the stage stepper update as each stage completes."

**Point to the Stage Stepper** as stages go from pending → running → done.

**Walk through each stage as it completes:**

> "**Stage 3 — Anchor Match:** The system matches girth welds between runs using Dynamic Time Warping. Girth welds are the fixed reference points in a pipeline — they don't move. By matching them, we establish alignment anchors."

> "**Stage 4 — Distance Correction:** Using those anchors, piecewise-linear odometer correction adjusts for tool drift. Then ICP — Iterative Closest Point — refines alignment within each weld-to-weld segment."

> "**Stage 5 — Anomaly Matching:** A segment-based Hungarian algorithm matches anomalies across runs using an ensemble of distance, clock position, type, and depth similarity. It identifies truly new anomalies and flags unsupported ones."

> "**Stage 6 — Scoring & Standards:** Every match gets a final confidence score and four standards assessments — ASME B31.8S severity, API 1163 tool confidence, NACE SP0502 corrosion growth class, and a PHMSA compliance record."

> "**Stage 7 — Export:** The system generates an Excel report and CSV files, ready for download."

---

## ACT 4: Exploring Results (5 min)

### Scene 7 — Summary Tab

**Say:**
> "Let's look at the results. The Summary tab gives you the high-level picture."

**Point out:**
- Total matches and exceptions
- Confidence breakdown (HIGH / MEDIUM / LOW)
- ASME severity distribution (IMMEDIATE / SCHEDULED / MONITORING)
- Accelerating growth count
- Interaction zones

**Say:**
> "Any IMMEDIATE severity findings need urgent attention. Accelerating growth means corrosion is speeding up. Interaction zones are clusters of anomalies close enough to weaken each other — detected per ASME B31.8S section A-4.3."

---

### Scene 8 — Matches Table

**Click** the Matches tab.

**Say:**
> "Here's every matched pair. You can sort by confidence, growth rate, or severity. Each row shows the distance in both runs, the residual after correction, clock position match, depth-change rate, and full standards attribution."

**Click a high-confidence match** to highlight details.

**Say:**
> "This 95% confidence match shows the same metal loss anomaly growing at [X]% per year. ASME rates it [SEVERITY], and NACE classifies the growth as [CLASS]. The API 1163 tool-adjusted confidence is [Y]%."

---

### Scene 9 — Visualization ⭐

**Click** the Visualization tab.

**Say:**
> "This is the alignment diagram — the signature view of the platform."

**Point out:**
- Multiple horizontal pipe bars (one per run, stacked by year)
- Feature markers: girth welds (gray bars), valves (gold bowties), tees (blue T), anomalies (ovals)
- The alignment reference line

**Action:** Click on a feature.

**Say:**
> "When I click this anomaly, watch the match lines appear — they connect the same feature across all runs, showing how its reported position drifts between inspections. That drift is exactly what the correction algorithm resolves."

**Action:** Hover over an anomaly with severity.

**Say:**
> "The tooltip shows everything — the corrected distance, drift, depth, growth rate, and the full standards assessment. See the severity ring? Red means IMMEDIATE action needed."

**Action:** Zoom in with scroll wheel, pan with arrow buttons.

**Say:**
> "You can zoom into any section of the pipeline. The diagram handles thousands of features efficiently through pixel-level deduplication — it only renders what fits on screen."

**Action:** Toggle checkboxes in the legend.

**Say:**
> "You can filter by feature type — hide control points to focus on anomalies, or toggle low-confidence features to see what the system flagged as uncertain."

---

### Scene 10 — Standards Tab

**Click** the Standards tab.

**Say:**
> "The Standards tab shows the per-match standards breakdown. Every match is assessed against four industry standards — this is what makes the data audit-ready for regulatory submission."

---

### Scene 11 — Audit Trail

**Click** the Audit tab.

**Say:**
> "Full traceability. Every algorithmic decision is logged — DTW alignment costs, ICP convergence metrics, graph analysis results, standards assessment counts. This is critical for PHMSA reporting and integrity management programs."

---

## ACT 5: Export & Wrap-up (1 min)

### Scene 12 — Downloads

**Point to** the download buttons.

**Say:**
> "Finally, everything exports to standard formats. The Excel workbook contains all tabs — summary, matches, exceptions, standards, audit — in a single file. The CSVs are there for teams that want to import into their own tools."

**Click** Download XLSX.

**Say (wrap-up):**
> "To summarize: this platform takes raw inline inspection data, aligns runs separated by years using DTW and ICP algorithms, matches anomalies with an ensemble scoring approach, assesses every finding against ASME, API, NACE, and PHMSA standards, and produces audit-ready reports — all with optional ML augmentation and full AI-powered data normalization. The whole pipeline runs in under a minute for typical datasets."

---

## Backup Talking Points

### If asked about the tech stack:
> "The frontend is Next.js 16 with React 19 and Tailwind CSS 4, using GSAP for the animations. The backend is Next.js 14 with Mongoose for MongoDB, and NextAuth for authentication. The ML sidecar is Python FastAPI with XGBoost and scikit-learn. Both apps share a MongoDB Atlas database."

### If asked about scalability:
> "The pipeline uses Bull queues backed by Redis for job processing — multiple alignments can run concurrently. If Redis isn't available, it gracefully degrades to inline processing. The visualization handles 10,000+ features through pixel-level deduplication."

### If asked about the ML:
> "The ML is strictly advisory. It uses an XGBoost binary classifier trained on feature-pair similarity, DBSCAN for spatial clustering, and a growth regression model. The blend is capped at 80/20 — the deterministic pipeline always dominates. You can toggle it per-job, and if the sidecar is down, everything still works."

### If asked about standards compliance:
> "Four standards are assessed automatically: ASME B31.8S for severity classification and interaction zones, API 1163 for ILI tool qualification, NACE SP0502 for corrosion growth trending, and PHMSA for regulatory audit documentation. The standards enrich matches post-alignment — they never influence the matching itself."

### If asked about AI:
> "Gemini 2.5 Flash handles event type canonicalization — mapping messy vendor-specific codes to a clean taxonomy. It's a fire-and-forget call with a regex fallback, so the system never blocks on AI availability."
