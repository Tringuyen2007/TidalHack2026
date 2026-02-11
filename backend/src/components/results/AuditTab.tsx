'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function AuditTab({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="rounded border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Timestamp</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={String(row._id)}>
              <TableCell>{new Date(String(row.createdAt)).toLocaleString()}</TableCell>
              <TableCell>{String(row.action ?? '')}</TableCell>
              <TableCell>{String(row.entity ?? '')}</TableCell>
              <TableCell className="max-w-[600px] truncate">{JSON.stringify(row.payload ?? {})}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
