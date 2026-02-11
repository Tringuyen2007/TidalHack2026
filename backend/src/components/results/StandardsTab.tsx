'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type StandardsApplied = {
  asme_b31_8s?: {
    applied?: boolean;
    interaction_zone?: boolean;
    interaction_severity?: string | null;
    severity_level?: string;
    repair_recommendation?: string;
    rationale?: string;
  };
  api_1163?: {
    applied?: boolean;
    tool_weight?: number;
    adjusted_confidence?: number;
    adjustment_reason?: string;
  };
  nace_sp0502?: {
    applied?: boolean;
    corrosion_class?: string;
    remaining_life_years?: number | null;
    reassessment_interval_years?: number | null;
  };
  phmsa?: {
    audit_logged?: boolean;
    decision_rationale?: string;
  };
};

type MatchRow = {
  _id: string;
  confidence_score?: number;
  confidence_category?: string;
  match_category?: string;
  distance_residual_ft?: number;
  depth_growth_pct_yr?: number | null;
  standards_applied?: StandardsApplied;
};

type FilterMode = 'all' | 'immediate' | 'scheduled' | 'accelerating' | 'interaction';

const SEVERITY_COLORS: Record<string, string> = {
  IMMEDIATE: 'text-red-600 bg-red-50 border-red-200',
  SCHEDULED: 'text-orange-600 bg-orange-50 border-orange-200',
  MONITORING: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  INFORMATIONAL: 'text-green-600 bg-green-50 border-green-200',
};

const GROWTH_COLORS: Record<string, string> = {
  accelerating: 'text-red-600',
  growing: 'text-orange-500',
  stable: 'text-green-600',
  undetermined: 'text-gray-400',
};

export function StandardsTab({ matches }: { matches: MatchRow[] }) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const withStandards = matches.filter(m => m.standards_applied?.asme_b31_8s?.applied);
    switch (filter) {
      case 'immediate':
        return withStandards.filter(m => m.standards_applied?.asme_b31_8s?.severity_level === 'IMMEDIATE');
      case 'scheduled':
        return withStandards.filter(m => m.standards_applied?.asme_b31_8s?.severity_level === 'SCHEDULED');
      case 'accelerating':
        return withStandards.filter(m => m.standards_applied?.nace_sp0502?.corrosion_class === 'accelerating');
      case 'interaction':
        return withStandards.filter(m => m.standards_applied?.asme_b31_8s?.interaction_zone);
      default:
        return withStandards;
    }
  }, [matches, filter]);

  const counts = useMemo(() => {
    const withStandards = matches.filter(m => m.standards_applied?.asme_b31_8s?.applied);
    return {
      all: withStandards.length,
      immediate: withStandards.filter(m => m.standards_applied?.asme_b31_8s?.severity_level === 'IMMEDIATE').length,
      scheduled: withStandards.filter(m => m.standards_applied?.asme_b31_8s?.severity_level === 'SCHEDULED').length,
      accelerating: withStandards.filter(m => m.standards_applied?.nace_sp0502?.corrosion_class === 'accelerating').length,
      interaction: withStandards.filter(m => m.standards_applied?.asme_b31_8s?.interaction_zone).length,
    };
  }, [matches]);

  return (
    <div className="space-y-4">
      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
          All Standards ({counts.all})
        </Button>
        <Button size="sm" variant={filter === 'immediate' ? 'default' : 'outline'} onClick={() => setFilter('immediate')}
          className={filter === 'immediate' ? '' : 'text-red-600 border-red-300'}>
          Immediate ({counts.immediate})
        </Button>
        <Button size="sm" variant={filter === 'scheduled' ? 'default' : 'outline'} onClick={() => setFilter('scheduled')}
          className={filter === 'scheduled' ? '' : 'text-orange-600 border-orange-300'}>
          Scheduled ({counts.scheduled})
        </Button>
        <Button size="sm" variant={filter === 'accelerating' ? 'default' : 'outline'} onClick={() => setFilter('accelerating')}
          className={filter === 'accelerating' ? '' : 'text-red-600 border-red-300'}>
          Accelerating ({counts.accelerating})
        </Button>
        <Button size="sm" variant={filter === 'interaction' ? 'default' : 'outline'} onClick={() => setFilter('interaction')}
          className={filter === 'interaction' ? '' : 'text-purple-600 border-purple-300'}>
          Interaction Zones ({counts.interaction})
        </Button>
      </div>

      {/* Results list */}
      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No anomalies match the current filter.
            </CardContent>
          </Card>
        )}
        {filtered.map((match) => {
          const std = match.standards_applied!;
          const severity = std.asme_b31_8s?.severity_level ?? 'INFORMATIONAL';
          const isExpanded = expandedId === match._id;

          return (
            <Card key={match._id} className={`cursor-pointer transition-all ${isExpanded ? 'ring-2 ring-blue-400' : ''}`}
              onClick={() => setExpandedId(isExpanded ? null : match._id)}>
              <CardContent className="py-3 px-4">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold border ${SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.INFORMATIONAL}`}>
                      {severity}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {match._id.toString().slice(-8)}
                    </span>
                    <span className="text-xs">
                      Score: <strong>{(match.confidence_score ?? 0).toFixed(0)}%</strong>
                    </span>
                    {std.asme_b31_8s?.interaction_zone && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
                        INTERACTION
                      </span>
                    )}
                    {std.nace_sp0502?.corrosion_class && std.nace_sp0502.corrosion_class !== 'undetermined' && (
                      <span className={`text-xs font-semibold ${GROWTH_COLORS[std.nace_sp0502.corrosion_class] ?? ''}`}>
                        {std.nace_sp0502.corrosion_class}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t space-y-3">
                    {/* ASME B31.8S */}
                    <div>
                      <h4 className="text-xs font-bold text-muted-foreground mb-1">ASME B31.8S — Severity & Interaction</h4>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <div><span className="text-muted-foreground">Severity:</span> {severity}</div>
                        <div><span className="text-muted-foreground">Repair:</span> {std.asme_b31_8s?.repair_recommendation ?? 'N/A'}</div>
                        <div><span className="text-muted-foreground">Interaction Zone:</span> {std.asme_b31_8s?.interaction_zone ? `Yes (${std.asme_b31_8s.interaction_severity})` : 'No'}</div>
                      </div>
                      {std.asme_b31_8s?.rationale && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic">{std.asme_b31_8s.rationale}</p>
                      )}
                    </div>

                    {/* API 1163 */}
                    <div>
                      <h4 className="text-xs font-bold text-muted-foreground mb-1">API 1163 — Tool Qualification</h4>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <div><span className="text-muted-foreground">Tool Weight:</span> {std.api_1163?.tool_weight?.toFixed(2) ?? 'N/A'}</div>
                        <div><span className="text-muted-foreground">Adjusted Confidence:</span> {std.api_1163?.adjusted_confidence?.toFixed(1) ?? 'N/A'}%</div>
                      </div>
                      {std.api_1163?.adjustment_reason && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic">{std.api_1163.adjustment_reason}</p>
                      )}
                    </div>

                    {/* NACE SP0502 */}
                    {std.nace_sp0502?.applied && (
                      <div>
                        <h4 className="text-xs font-bold text-muted-foreground mb-1">NACE SP0502 — Corrosion Growth</h4>
                        <div className="grid grid-cols-3 gap-1 text-xs">
                          <div>
                            <span className="text-muted-foreground">Class:</span>{' '}
                            <span className={`font-semibold ${GROWTH_COLORS[std.nace_sp0502.corrosion_class ?? ''] ?? ''}`}>
                              {std.nace_sp0502.corrosion_class ?? 'undetermined'}
                            </span>
                          </div>
                          <div><span className="text-muted-foreground">Remaining Life:</span> {std.nace_sp0502.remaining_life_years?.toFixed(1) ?? '—'} yr</div>
                          <div><span className="text-muted-foreground">Reassess:</span> {std.nace_sp0502.reassessment_interval_years?.toFixed(0) ?? '—'} yr</div>
                        </div>
                      </div>
                    )}

                    {/* PHMSA */}
                    <div>
                      <h4 className="text-xs font-bold text-muted-foreground mb-1">PHMSA 49 CFR 192/195 — Audit Trail</h4>
                      <div className="text-xs">
                        <span className="text-muted-foreground">Audit Logged:</span>{' '}
                        <span className={std.phmsa?.audit_logged ? 'text-green-600' : 'text-red-500'}>
                          {std.phmsa?.audit_logged ? '✓ Yes' : '✗ No'}
                        </span>
                      </div>
                      {std.phmsa?.decision_rationale && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic break-words">{std.phmsa.decision_rationale}</p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
