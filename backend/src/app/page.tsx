import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-gradient-to-r from-slate-100 to-cyan-50 p-10">
        <h2 className="text-5xl font-bold text-slate-900">Align ILI Runs. Quantify Growth. Export Audit Reports.</h2>
        <p className="mt-4 max-w-3xl text-lg text-slate-700">
          Upload multi-year in-line inspection datasets, anchor against 2022 baseline, auto-match anomalies, and generate
          corrosion-growth outputs your integrity team can defend.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/upload">
            <Button>Upload Dataset</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="secondary">Open Dashboard</Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>7-Stage Pipeline</CardTitle>
            <CardDescription>Anchor match, correction, Hungarian assignment, and scoring.</CardDescription>
          </CardHeader>
          <CardContent>Asynchronous run processing with progress tracking.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>10K+ Row Performance</CardTitle>
            <CardDescription>Virtualized tables for large matched-pair result sets.</CardDescription>
          </CardHeader>
          <CardContent>TanStack Table + Virtual for fast interaction.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Audit-Ready Exports</CardTitle>
            <CardDescription>Generate XLSX and CSV deliverables per alignment job.</CardDescription>
          </CardHeader>
          <CardContent>Includes matches, exceptions, and audit log outputs.</CardContent>
        </Card>
      </section>
    </div>
  );
}
