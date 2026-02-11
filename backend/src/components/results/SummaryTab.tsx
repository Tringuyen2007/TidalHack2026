'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const COLORS = ['#16a34a', '#f59e0b', '#dc2626'];

export function SummaryTab({
  summary
}: {
  summary: {
    totalMatches: number;
    totalExceptions: number;
    confidence: { high: number; medium: number; low: number };
    avg_growth_pct_yr?: number;
    standards?: {
      severity: { immediate: number; scheduled: number; monitoring: number };
      acceleratingGrowth: number;
      interactionZones: number;
    };
    mlSidecar?: {
      active: boolean;
      pairsScored: number;
      growthsAssessed: number;
      clustersFound: number;
      errors: number;
    };
  };
}) {
  const confidenceData = [
    { name: 'High', value: summary.confidence.high },
    { name: 'Medium', value: summary.confidence.medium },
    { name: 'Low', value: summary.confidence.low }
  ];

  const metrics = [
    { label: 'Matches', value: summary.totalMatches },
    { label: 'Exceptions', value: summary.totalExceptions },
    { label: 'Avg Depth Growth %/yr', value: (summary.avg_growth_pct_yr ?? 0).toFixed(3) }
  ];

  const std = summary.standards;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">{metric.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Standards Assessment Summary */}
      {std && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>⚖</span> Standards Assessment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="text-center p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-2xl font-bold text-red-600">{std.severity.immediate}</p>
                <p className="text-xs text-red-500 font-medium mt-1">IMMEDIATE</p>
                <p className="text-[10px] text-muted-foreground">ASME B31.8S</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-orange-50 border border-orange-200">
                <p className="text-2xl font-bold text-orange-600">{std.severity.scheduled}</p>
                <p className="text-xs text-orange-500 font-medium mt-1">SCHEDULED</p>
                <p className="text-[10px] text-muted-foreground">ASME B31.8S</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-2xl font-bold text-red-600">{std.acceleratingGrowth}</p>
                <p className="text-xs text-red-500 font-medium mt-1">ACCELERATING</p>
                <p className="text-[10px] text-muted-foreground">NACE SP0502</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-purple-50 border border-purple-200">
                <p className="text-2xl font-bold text-purple-600">{std.interactionZones}</p>
                <p className="text-xs text-purple-500 font-medium mt-1">INTERACTION ZONES</p>
                <p className="text-[10px] text-muted-foreground">ASME B31.8S</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ML Sidecar Status */}
      {summary.mlSidecar && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>🧪</span> ML Sidecar
              <span className={`text-xs px-2 py-0.5 rounded-full ${summary.mlSidecar.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {summary.mlSidecar.active ? 'Active' : 'Inactive'}
              </span>
              <span className="text-xs text-muted-foreground font-normal">(experimental / advisory only)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="text-center p-3 rounded-lg bg-blue-50 border border-blue-200">
                <p className="text-2xl font-bold text-blue-600">{summary.mlSidecar.pairsScored}</p>
                <p className="text-xs text-blue-500 font-medium mt-1">PAIRS SCORED</p>
                <p className="text-[10px] text-muted-foreground">Siamese similarity</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-teal-50 border border-teal-200">
                <p className="text-2xl font-bold text-teal-600">{summary.mlSidecar.clustersFound}</p>
                <p className="text-xs text-teal-500 font-medium mt-1">CLUSTERS FOUND</p>
                <p className="text-[10px] text-muted-foreground">DBSCAN clustering</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-indigo-50 border border-indigo-200">
                <p className="text-2xl font-bold text-indigo-600">{summary.mlSidecar.growthsAssessed}</p>
                <p className="text-xs text-indigo-500 font-medium mt-1">GROWTHS PREDICTED</p>
                <p className="text-[10px] text-muted-foreground">Bayesian regression</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-gray-50 border border-gray-200">
                <p className="text-2xl font-bold text-gray-600">{summary.mlSidecar.errors}</p>
                <p className="text-xs text-gray-500 font-medium mt-1">ERRORS</p>
                <p className="text-[10px] text-muted-foreground">Graceful fallback</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">
              ML outputs are advisory only. Blending: <code className="bg-muted px-1 rounded">final = deterministic × 0.8 + ml × 0.2</code>.
              The deterministic pipeline remains authoritative.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Confidence Distribution</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={confidenceData} dataKey="value" nameKey="name" outerRadius={90}>
                  {confidenceData.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={confidenceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#334155" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
