import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const statusVariant: Record<string, 'secondary' | 'warning' | 'success' | 'danger'> = {
  QUEUED: 'secondary',
  RUNNING: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger'
};

export function RecentJobsTable({ jobs }: { jobs: Array<Record<string, unknown>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Alignment Jobs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={String(job._id)}>
                <TableCell className="font-mono text-sm">{String(job._id).slice(-8)}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant[String(job.status)] ?? 'secondary'}>{String(job.status)}</Badge>
                </TableCell>
                <TableCell>{String(job.progress_pct ?? 0)}%</TableCell>
                <TableCell>{new Date(String(job.createdAt)).toLocaleString()}</TableCell>
                <TableCell>
                  <Link className="text-primary underline" href={`/alignment/${String(job._id)}`}>
                    Open
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
