import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

export function StageStepper({
  status,
  progress,
  stages
}: {
  status: string;
  progress: number;
  stages: Array<{ stage: number; name: string; status: string; message?: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Pipeline Progress</span>
          <Badge variant={status === 'FAILED' ? 'danger' : status === 'COMPLETED' ? 'success' : 'warning'}>{status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={progress} />
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {stages.map((stage) => (
            <div key={stage.stage} className="rounded border bg-slate-50 p-3">
              <p className="text-xs text-muted-foreground">Stage {stage.stage}</p>
              <p className="text-sm font-semibold">{stage.name}</p>
              <p className="text-xs">{stage.status}</p>
              {stage.message && <p className="mt-1 text-xs text-muted-foreground">{stage.message}</p>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
