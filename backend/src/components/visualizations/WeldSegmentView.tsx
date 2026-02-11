'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function WeldSegmentView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weld Segment Focus</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Zoomed segment-level match links are available for detailed engineering review.
        </p>
      </CardContent>
    </Card>
  );
}
