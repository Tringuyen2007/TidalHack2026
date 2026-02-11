import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function SummaryCards({
  datasets,
  jobs,
  completed,
  avgConfidence
}: {
  datasets: number;
  jobs: number;
  completed: number;
  avgConfidence: number;
}) {
  const cards = [
    { label: 'Datasets', value: datasets },
    { label: 'Alignment Jobs', value: jobs },
    { label: 'Completed Jobs', value: completed },
    { label: 'Avg Confidence', value: `${avgConfidence.toFixed(1)}%` }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-muted-foreground">{card.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
