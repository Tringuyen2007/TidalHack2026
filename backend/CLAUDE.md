# CLAUDE.md

Guidance for AI coding agents working in the **backend** directory — the main ILI Data Alignment Platform.

## Build & Run

```bash
npm run dev          # Next.js dev server (port 3000)
npm run build        # Production build
npm run typecheck    # tsc --noEmit  ← run after edits
npm run lint         # eslint src/
npm run worker       # Bull queue worker (tsx src/lib/queue/worker.ts)
```

ML sidecar (optional):
```bash
cd ml-sidecar && pip install -r requirements.txt && uvicorn main:app --port 8100
```

## Environment

Copy `.env.example` → `.env`. Required: `MONGODB_URI`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GEMINI_API_KEY`. Optional: `REDIS_URL` (queue falls back to inline without it), `ENABLE_ML_SIDECAR`, `ML_SIDECAR_URL`.

## Architecture

Next.js 14 App Router · TypeScript (strict, ES2022) · Mongoose 8 on MongoDB Atlas · NextAuth credentials/JWT · Bull/Redis queue · Tailwind 3 + shadcn-style UI (CVA + clsx + tailwind-merge) · Google Gemini 2.5 Flash for event canonicalization.

### Pipeline (`src/lib/pipeline/`)

The **841-line orchestrator** `index.ts` runs 7 numbered stages sequentially, then applies standards assessment, then optional ML sidecar integration:

| Stage | File | What it does |
|-------|------|-------------|
| 1 | `01-ingest.ts` | Parse Excel/CSV |
| 2 | `02-normalize.ts` | Standardize columns, Gemini event-type mapping |
| 3 | `03-anchor.ts` | Girth weld anchor matching |
| 4 | `04-correct.ts` | Piecewise-linear distance correction between anchors |
| 5 | `05-match.ts` | Hungarian optimal bipartite anomaly assignment |
| 6 | `06-score.ts` | 7-factor ensemble confidence scoring, growth rates, exceptions |
| 7 | `07-export.ts` | XLSX/CSV with flattened `standards_applied` columns |

Utilities in `src/lib/pipeline/utils/`: DTW, ICP, graph-matching, ensemble-scoring, standards-assessment, ml-hooks, ml-sidecar-client, scoring, correction, hungarian, column-mapper, clock, event-taxonomy, visibility-confidence, date-parser, run3-refinement.

### Standards Assessment (`src/lib/pipeline/utils/standards-assessment.ts`)

Pure functions — no side effects. Every matched pair gets `standards_applied` metadata:

- **ASME B31.8S** — severity (IMMEDIATE/SCHEDULED/MONITORING/INFORMATIONAL), repair recommendation, interaction zones
- **API 1163** — tool qualification weight, confidence adjustment per tool accuracy bands
- **NACE SP0502** — corrosion growth class (`accelerating`/`growing`/`stable`/`undetermined`), remaining life, reassessment interval. **Only applies to** `METAL_LOSS`, `CLUSTER`, `METAL_LOSS_MFG` feature types.
- **PHMSA 49 CFR 192/195** — audit logging, decision rationale, compliance record

**Critical invariant:** Standards enrich matched pairs post-match. They never override alignment math, matching logic, or scoring formulas.

### Database Models (`src/lib/db/models/`)

Barrel-exported from `index.ts`: `Org`, `User`, `Dataset`, `Run`, `Feature`, `AlignmentJob`, `AlignedFeature`, `MatchedPair`, `Exception`, `AuditLog`.

- `Feature.event_type_canonical` must be from `CANONICAL_EVENT_TYPES` in `Feature.ts`
- `MatchedPair.standards_applied.nace_sp0502.corrosion_class` enum: `['stable', 'growing', 'accelerating', 'undetermined', null]` — use lowercase only
- `AuditLog` stores `STANDARDS_ASSESSMENT` and `PHMSA_COMPLIANCE` payloads

### ML Sidecar (`ml-sidecar/`)

FastAPI Python service (XGBoost similarity, DBSCAN clustering, Bayesian growth). **Advisory only** — blending capped at 80/20: `final = deterministic × 0.8 + ml × 0.2`. Per-job toggle, graceful no-op fallback. Do not increase the 20% weight without explicit approval.

### API Routes (`src/app/api/`)

RESTful under App Router. Key endpoints:
- `/api/alignment/results/[id]/` — subroutes for matches, exceptions, audit, visualization; the main `route.ts` computes summary counts via MongoDB aggregation
- `/api/export/[id]/[type]/` — download generated CSV/XLSX
- `/api/gemini/canonicalize/` — event type mapping

### UI Components (`src/components/`)

Organized by feature: `dashboard/`, `results/` (SummaryTab, TableTab, StandardsTab, AuditTab, VisualizationTab), `visualizations/` (AlignmentDiagram, CylinderView, UnwrappedPipeView), `upload/`, `pipeline-progress/`, `ui/` (shadcn primitives).

## Conventions

- Path alias: `@/*` → `./src/*`
- Pipeline stages are **numbered files** — preserve the naming scheme
- Queue gracefully degrades to inline execution when Redis is unavailable
- All pipeline decisions must be **deterministic, traceable, auditable**
- Standards module uses pure functions — no DB calls, no side effects
- `getToolQualification()` is the single source of truth for API 1163 tool specs — do not hardcode tool weights elsewhere
- Growth categories must match the Mongoose enum exactly (lowercase: `accelerating`, `growing`, `stable`, `undetermined`)
- NACE SP0502 must only be applied to corrosion-type features (guard via `NACE_APPLICABLE_TYPES`)
- Export flattens `standards_applied` to dot-delimited CSV columns — keep `MATCH_COLUMNS` array in sync with schema changes
