'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DragDropUploader } from '@/components/upload/DragDropUploader';
import { ColumnMappingPreview } from '@/components/upload/ColumnMappingPreview';
import { Button } from '@/components/ui/button';

export default function UploadPage() {
  const router = useRouter();
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [runInfo, setRunInfo] = useState<Array<{ year: number; total_features: number; vendor?: string }>>([]);
  const [starting, setStarting] = useState(false);
  const [enableMl, setEnableMl] = useState(false);

  async function handleUploaded(id: string) {
    setDatasetId(id);

    const response = await fetch(`/api/datasets/${id}`);
    const payload = await response.json();
    const runs = (payload.runs ?? []).map((run: Record<string, unknown>) => ({
      year: Number(run.year),
      total_features: Number(run.total_features ?? 0),
      vendor: String(run.vendor ?? '')
    }));
    setRunInfo(runs);
  }

  async function startAlignment() {
    if (!datasetId) return;
    setStarting(true);
    const response = await fetch('/api/alignment/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId, enableMl })
    });
    setStarting(false);

    if (!response.ok) return;
    const payload = await response.json();
    router.push(`/alignment/${payload.jobId}`);
  }

  return (
    <div className="space-y-4">
      <DragDropUploader onUploaded={handleUploaded} />
      {runInfo.length > 0 && <ColumnMappingPreview runs={runInfo} />}

      {/* ML Sidecar Toggle */}
      <div className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={enableMl}
          onClick={() => setEnableMl(prev => !prev)}
          className={`
            relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full
            border-2 border-transparent transition-colors duration-200 ease-in-out
            focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500
            ${enableMl ? 'bg-blue-600' : 'bg-zinc-600'}
          `}
        >
          <span
            className={`
              pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow
              ring-0 transition duration-200 ease-in-out
              ${enableMl ? 'translate-x-5' : 'translate-x-0'}
            `}
          />
        </button>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-zinc-200">
            ML Scoring {enableMl ? 'ON' : 'OFF'}
          </span>
          <span className="text-xs text-zinc-400">
            {enableMl
              ? 'XGBoost similarity model will augment deterministic scores (experimental)'
              : 'Deterministic scoring only — ML sidecar disabled'}
          </span>
        </div>
        {enableMl && (
          <span className="ml-auto rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
            EXPERIMENTAL
          </span>
        )}
      </div>

      <Button disabled={!datasetId || starting} onClick={startAlignment}>
        {starting ? 'Starting job...' : 'Run Alignment Pipeline'}
      </Button>
    </div>
  );
}
