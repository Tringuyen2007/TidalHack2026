'use client';

import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';

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
    asme_b31_8s?: { severity_level?: string };
    nace_sp0502?: { corrosion_class?: string };
  };
};

function confidenceVariant(category: string): 'success' | 'warning' | 'danger' {
  if (category === 'HIGH') return 'success';
  if (category === 'MEDIUM') return 'warning';
  return 'danger';
}

export function TableTab({ rows }: { rows: MatchRow[] }) {
  const columns = useMemo<ColumnDef<MatchRow>[]>(
    () => [
      { accessorKey: '_id', header: 'Pair ID' },
      {
        accessorKey: 'confidence_category',
        header: 'Confidence',
        cell: ({ row }) => <Badge variant={confidenceVariant(row.original.confidence_category)}>{row.original.confidence_category}</Badge>
      },
      { accessorKey: 'confidence_score', header: 'Score' },
      { accessorKey: 'match_category', header: 'Category' },
      { accessorKey: 'distance_residual_ft', header: 'Distance Residual (ft)' },
      { accessorKey: 'clock_residual_hrs', header: 'Clock Residual (hr)' },
      { accessorKey: 'depth_growth_pct_yr', header: 'Depth Growth %/yr' },
      { accessorKey: 'years_between', header: 'Years' },
      {
        id: 'severity',
        header: 'Severity',
        cell: ({ row }) => {
          const sev = row.original.standards_applied?.asme_b31_8s?.severity_level;
          if (!sev) return <span className="text-gray-300">—</span>;
          const color = sev === 'IMMEDIATE' ? 'danger' : sev === 'SCHEDULED' ? 'warning' : 'success';
          return <Badge variant={color as 'success' | 'warning' | 'danger'}>{sev}</Badge>;
        }
      }
    ],
    []
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const { rows: tableRows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 44,
    overscan: 10
  });

  return (
    <div className="rounded border bg-white">
      <div className="grid grid-cols-9 border-b bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
        {table.getFlatHeaders().map((header) => (
          <div key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</div>
        ))}
      </div>
      <div className="h-[480px] overflow-auto" ref={tableContainerRef}>
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = tableRows[virtualRow.index];
            return (
              <div
                key={row.id}
                className="grid grid-cols-9 border-b px-3 py-2 text-xs"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <div key={cell.id} className="truncate pr-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
