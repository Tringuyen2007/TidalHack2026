# ILI Data Alignment Platform

Web application for pipeline integrity engineers to align multi-year ILI datasets, match anomalies between runs, compute corrosion growth rates, and export audit-ready reports.

## Stack

- Next.js 14 App Router + TypeScript
- MongoDB Atlas + Mongoose
- NextAuth credentials (JWT session)
- Tailwind + shadcn-style UI components
- Bull (Redis-backed) async job queue
- SheetJS (`xlsx`) + PapaParse (`papaparse`)
- Recharts + D3 visualizations
- TanStack Table + TanStack Virtual
- Google Gemini 2.5 Flash via `@google/generative-ai`

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy envs:

```bash
cp .env.example .env.local
```

3. Set values in `.env.local`:

- `MONGODB_URI`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL=http://localhost:3000`
- `GEMINI_API_KEY`
- `REDIS_URL=redis://localhost:6379`

4. Run app:

```bash
npm run dev
```

5. Optional separate queue worker:

```bash
npm run worker
```

## Core Workflow

1. Register/login.
2. Upload workbook (`Summary`, `2007`, `2015`, `2022`).
3. Start alignment job.
4. Monitor stage progress.
5. Review summary, virtualized match table, visualization, audit log.
6. Export XLSX / CSV outputs.

## Pipeline Stages

1. Ingest parse
2. Normalize + canonicalize
3. Anchor match (girth welds)
4. Distance correction to 2022 baseline
5. Segment matching with Hungarian assignment
6. Confidence scoring + growth rates + exception tagging
7. Export generation
