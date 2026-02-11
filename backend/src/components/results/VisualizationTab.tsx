'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { AlignmentDiagram, type VisualizationData } from '@/components/visualizations/AlignmentDiagram';
import { Button } from '@/components/ui/button';

// Lazy-load CylinderView to avoid SSR issues with Three.js
const CylinderView = dynamic(
  () => import('@/components/visualizations/CylinderView').then((m) => m.CylinderView),
  { ssr: false, loading: () => <div className="h-[500px] flex items-center justify-center text-muted-foreground">Loading 3D view…</div> }
);

export function VisualizationTab({ vizData }: { vizData: VisualizationData | null }) {
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');

  if (!vizData || !vizData.runs?.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">No visualization data available yet.</p>
        <p className="text-sm mt-2">Run the alignment pipeline to generate the ILI alignment diagram.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 3D toggle hidden — code preserved in CylinderView.tsx */}
      <AlignmentDiagram data={vizData} />
    </div>
  );
}
