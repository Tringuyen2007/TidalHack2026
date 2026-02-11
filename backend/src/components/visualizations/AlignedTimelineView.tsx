'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AlignedTimelineView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aligned Timeline View</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Run bands and drift connectors can be expanded here using aligned features from each run.
        </p>
      </CardContent>
    </Card>
  );
}
