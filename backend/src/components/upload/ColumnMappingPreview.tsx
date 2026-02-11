import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function ColumnMappingPreview({ runs }: { runs: Array<{ year: number; total_features: number; vendor?: string }> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Parsed Runs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Features</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.year}>
                <TableCell>{run.year}</TableCell>
                <TableCell>{run.vendor || '-'}</TableCell>
                <TableCell>{run.total_features ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
