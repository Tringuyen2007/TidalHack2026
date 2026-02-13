# ILI Data Alignment Platform — Monorepo

Integration of backend pipeline engine + frontend themed UI into a single repo.

## Architecture: Option A — Separate Servers with Proxy

```
Browser → Frontend (Next.js 16, port 3000)
            │
            ├── Landing (/), Login (/login), Register (/register)
            ├── Dashboard (/dashboard), Upload (/upload), Results (/jobs/:id)
            │
            └── /api/* ──(rewrite proxy)──▶ Backend (Next.js 14, port 3001)
                                              │
                                              ├── NextAuth (JWT sessions)
                                              ├── Mongoose → MongoDB Atlas
                                              ├── 7-stage alignment pipeline
                                              ├── Standards assessment
                                              └── ML sidecar (optional)
```

The frontend's `next.config.ts` rewrites all `/api/*` requests to `BACKEND_URL` (default `http://localhost:3001`). This means:
- **No CORS needed** — browser sees everything as same-origin
- **Cookies flow naturally** through the proxy (NextAuth session tokens)
- **No backend changes** — all API routes remain identical

## Quick Start

```bash
# 1. Backend (port 3001)
cd backend
cp .env.example .env          # fill in MONGODB_URI, NEXTAUTH_SECRET, GEMINI_API_KEY
npm install
npm run dev                   # starts on http://localhost:3001

# 2. Frontend (port 3000) — in a separate terminal
cd frontend
npm install
npm run dev                   # starts on http://localhost:3000

# 3. Open http://localhost:3000
```

## Required Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | ✅ | MongoDB Atlas connection string |
| `NEXTAUTH_SECRET` | ✅ | Random 32+ char secret for JWT signing |
| `NEXTAUTH_URL` | ✅ | `http://localhost:3001` (backend's own URL) |
| `GEMINI_API_KEY` | ✅ | Google AI Studio key for event canonicalization |
| `REDIS_URL` | ❌ | Redis URL for Bull queue (falls back to inline) |
| `ENABLE_ML_SIDECAR` | ❌ | `true` to enable ML advisory scoring |
| `ML_SIDECAR_URL` | ❌ | ML sidecar URL (default `http://localhost:8100`) |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `BACKEND_URL` | ✅ | Backend URL for API proxy (default `http://localhost:3001`) |

## Repo Structure

```
/
├── backend/                    # Next.js 14 — API, pipeline, auth, DB
│   ├── src/
│   │   ├── app/api/            # All API routes (unchanged)
│   │   ├── lib/pipeline/       # 7-stage alignment pipeline
│   │   ├── lib/db/models/      # Mongoose models
│   │   ├── lib/auth/           # NextAuth config
│   │   └── components/         # Backend UI (optional, not used by frontend)
│   ├── ml-sidecar/             # Python FastAPI ML service
│   └── package.json
│
├── frontend/                   # Next.js 16 — Themed UI
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx        # Animated landing page
│   │   │   ├── login/          # Login with mountain backdrop
│   │   │   ├── register/       # Registration page
│   │   │   ├── dashboard/      # Dashboard with real data
│   │   │   ├── upload/         # Dataset upload + pipeline trigger
│   │   │   └── jobs/[jobId]/   # Results with tabs + downloads
│   │   ├── components/
│   │   │   ├── DashboardLayout.tsx  # Shared layout (topbar + nav)
│   │   │   └── icons.tsx       # SVG icon components
│   │   ├── lib/
│   │   │   ├── api.ts          # Centralized API client
│   │   │   ├── auth.ts         # Auth helpers (login/logout/session)
│   │   │   └── mongodb.ts      # Raw driver (seed script only)
│   │   └── middleware.ts       # Auth guard for protected routes
│   └── package.json
│
├── shared/                     # Shared type definitions (no runtime code)
│   └── types/
│       └── api.ts              # API DTO interfaces
│
└── README.md                   # This file
```

## Frontend Screen → Backend Endpoint Mapping

| Frontend Page | Backend Endpoints Used |
|---|---|
| `/login` | `POST /api/auth/callback/credentials`, `GET /api/auth/csrf`, `GET /api/auth/session` |
| `/register` | `POST /api/auth/register`, then auto-login via NextAuth |
| `/dashboard` | `GET /api/datasets`, `GET /api/alignment/jobs`, `GET /api/auth/session` |
| `/upload` | `POST /api/datasets` (file upload), `GET /api/datasets/:id`, `POST /api/alignment/run` |
| `/jobs/:id` — Summary | `GET /api/alignment/jobs/:id`, `GET /api/alignment/results/:id` |
| `/jobs/:id` — Matches | `GET /api/alignment/results/:id/matches?page=N&pageSize=100` |
| `/jobs/:id` — Exceptions | `GET /api/alignment/results/:id/exceptions` |
| `/jobs/:id` — Audit | `GET /api/alignment/results/:id/audit` |
| `/jobs/:id` — Downloads | `GET /api/export/:id/xlsx`, `GET /api/export/:id/matches`, `GET /api/export/:id/exceptions` |

## Integration Approach

### What Changed

**Backend — zero logic changes:**
- `package.json`: `dev` script now runs on port 3001 (`next dev -p 3001`)
- `.env`: `NEXTAUTH_URL` updated to `http://localhost:3001`
- `.env.example`: Added `PORT=3001` note

**Frontend — minimal wiring changes:**
- `next.config.ts`: Added `rewrites()` to proxy `/api/*` → backend
- `src/middleware.ts`: New auth guard checking NextAuth session cookies
- `src/lib/auth.ts`: New — wraps NextAuth CSRF + credential flow
- `src/lib/api.ts`: New — centralized API client for all backend endpoints
- `src/app/login/page.tsx`: Switched from username/fetch to email/NextAuth
- `src/app/register/page.tsx`: New registration page (same theme)
- `src/app/dashboard/page.tsx`: Replaced stub with real data from API
- `src/app/upload/page.tsx`: New — file upload + pipeline trigger
- `src/app/jobs/[jobId]/page.tsx`: New — results with tabs/tables/downloads
- `src/components/DashboardLayout.tsx`: New shared layout (topbar + nav)
- `src/app/globals.css`: Removed `overflow: hidden` for scrollable dashboard pages

**No changes to:**
- Any backend API route
- Any pipeline stage logic
- Any database model/schema
- Any scoring, matching, or standards assessment code
- Export format or download mechanism
- ML sidecar integration

## Smoke Test Checklist

1. ☐ Backend starts on port 3001 (`cd backend && npm run dev`)
2. ☐ Frontend starts on port 3000 (`cd frontend && npm run dev`)
3. ☐ Landing page loads with mountain animation
4. ☐ Login page loads, "Register" link visible
5. ☐ Registration works (creates user + org in MongoDB)
6. ☐ Login works (email + password, sets NextAuth cookie)
7. ☐ Dashboard loads with real datasets/jobs from DB
8. ☐ Upload page: drag-drop .xlsx file, parse succeeds
9. ☐ Upload page: "Run Alignment" starts a pipeline job
10. ☐ Job results page: Summary tab shows counts
11. ☐ Job results page: Matches tab shows paginated table
12. ☐ Job results page: Exceptions tab shows data
13. ☐ Job results page: Audit tab shows log entries
14. ☐ Downloads: XLSX, matches CSV, exceptions CSV all download
15. ☐ Logout works, redirects to login
16. ☐ Protected routes redirect to login when not authenticated
17. ☐ `cd backend && npm run typecheck` passes
18. ☐ `cd frontend && npm run build` passes
