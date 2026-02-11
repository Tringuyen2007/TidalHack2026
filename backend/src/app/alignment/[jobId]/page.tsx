'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { StageStepper } from '@/components/pipeline-progress/StageStepper';
import { SummaryTab } from '@/components/results/SummaryTab';
import { TableTab } from '@/components/results/TableTab';
import { VisualizationTab } from '@/components/results/VisualizationTab';
import { AuditTab } from '@/components/results/AuditTab';
import { StandardsTab } from '@/components/results/StandardsTab';
import type { VisualizationData } from '@/components/visualizations/AlignmentDiagram';

type JobPayload = {
  status: string;
  progress_pct: number;
  stage_status: Array<{ stage: number; name: string; status: string; message?: string }>;
};

type SummaryPayload = {
  totalMatches: number;
  totalExceptions: number;
  confidence: { high: number; medium: number; low: number };
  avg_growth_pct_yr?: number;
  standards?: {
    severity: { immediate: number; scheduled: number; monitoring: number };
    acceleratingGrowth: number;
    interactionZones: number;
  };
};

type MatchRow = {
  _id: string;
  confidence_score: number;
  confidence_category: 'HIGH' | 'MEDIUM' | 'LOW';
  match_category: string;
  distance_residual_ft: number;
  clock_residual_hrs?: number | null;
  depth_growth_pct_yr?: number | null;
  years_between: number;
  standards_applied?: {
    asme_b31_8s?: {
      applied?: boolean;
      interaction_zone?: boolean;
      interaction_severity?: string | null;
      severity_level?: string;
      repair_recommendation?: string;
      rationale?: string;
    };
    api_1163?: {
      applied?: boolean;
      tool_weight?: number;
      adjusted_confidence?: number;
      adjustment_reason?: string;
    };
    nace_sp0502?: {
      applied?: boolean;
      corrosion_class?: string;
      remaining_life_years?: number | null;
      reassessment_interval_years?: number | null;
    };
    phmsa?: {
      audit_logged?: boolean;
      decision_rationale?: string;
    };
  };
};

export default function AlignmentJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);

  const [job, setJob] = useState<JobPayload | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [vizData, setVizData] = useState<VisualizationData | null>(null);

  useEffect(() => {
    if (!jobId) return;

    let mounted = true;

    const load = async () => {
      const [jobRes, summaryRes, matchRes, auditRes] = await Promise.all([
        fetch(`/api/alignment/jobs/${jobId}`),
        fetch(`/api/alignment/results/${jobId}`),
        fetch(`/api/alignment/results/${jobId}/matches?page=1&pageSize=10000`),
        fetch(`/api/alignment/results/${jobId}/audit`)
      ]);

      if (!mounted) return;

      const jobPayload = await jobRes.json().catch(() => ({}));
      const summaryPayload = await summaryRes.json().catch(() => ({}));
      const matchPayload = await matchRes.json().catch(() => ({}));
      const auditPayload = await auditRes.json().catch(() => ({}));

      setJob(jobPayload.job ?? null);
      setSummary(summaryPayload.summary ?? null);
      setMatches(matchPayload.rows ?? []);
      setAudit(auditPayload.rows ?? []);

      // Fetch visualization data once pipeline is completed
      const status = jobPayload.job?.status;
      if (status === 'COMPLETED') {
        fetch(`/api/alignment/results/${jobId}/visualization`)
          .then((r) => r.json())
          .then((d) => { if (mounted && d.runs) setVizData(d); })
          .catch(() => {});
      }
    };

    void load();
    const id = setInterval(load, 3000);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [jobId]);

  return (
    <div className="space-y-4">
      {job && <StageStepper status={job.status} progress={job.progress_pct ?? 0} stages={job.stage_status ?? []} />}

      <div className="flex flex-wrap gap-2">
        <Link href={`/api/export/${jobId}/xlsx`}>
          <Button variant="secondary">Download XLSX</Button>
        </Link>
        <Link href={`/api/export/${jobId}/matches`}>
          <Button variant="secondary">Download Matches CSV</Button>
        </Link>
        <Link href={`/api/export/${jobId}/exceptions`}>
          <Button variant="secondary">Download Exceptions CSV</Button>
        </Link>
      </div>

      <Tabs defaultValue="visual">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="table">Matches Table</TabsTrigger>
          <TabsTrigger value="visual">Visualization</TabsTrigger>
          <TabsTrigger value="standards">Standards</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">{summary && <SummaryTab summary={summary} />}</TabsContent>
        <TabsContent value="table">
          <TableTab rows={matches} />
        </TabsContent>
        <TabsContent value="visual">
          <VisualizationTab vizData={vizData} />
        </TabsContent>
        <TabsContent value="standards">
          <StandardsTab matches={matches} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab rows={audit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
