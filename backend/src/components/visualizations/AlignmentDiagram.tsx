'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────
export type VisibilityInfo = {
  visibilityScore: number;
  visibilityState: 'full' | 'dimmed' | 'hidden';
  components: {
    matchConfidence: number;
    temporalPersistence: number;
    spatialReinforcement: number;
    dataCompleteness: number;
  };
  reasons: string[];
};

export type StandardsInfo = {
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

export type VisualizationFeature = {
  id: string;
  distance: number;
  originalDistance: number;
  drift: number;
  type: string;
  typeRaw?: string;
  depthPercent?: number | null;
  depthIn?: number | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  clockDecimal?: number | null;
  clockRaw?: string;
  jointNumber?: number | null;
  isReferencePoint: boolean;
  matchStatus: 'matched' | 'new' | 'missing' | 'unlinked';
  matchInfo?: {
    partnerId: string;
    score: number;
    category: string;
    residualFt: number;
    growthPctYr?: number;
    standards?: StandardsInfo;
    mlAugmentation?: {
      adjusted_score?: number;
      ml_confidence?: number;
      model_id?: string;
      explanation?: string;
      experimental?: boolean;
    };
  } | null;
  visibility?: VisibilityInfo;
};

export type VisualizationRun = {
  runId: string;
  year: number;
  label: string;
  vendor?: string;
  isBaseline: boolean;
  runIndex: number;
  driftLabel: string;
  features: VisualizationFeature[];
};

export type VisualizationData = {
  runs: VisualizationRun[];
  distanceRange: { min: number; max: number };
  totalMatches: number;
  baselineRunId: string;
  visibilitySummary?: {
    full: number;
    dimmed: number;
    hidden: number;
    total: number;
  };
};

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────
const CONTROL_POINT_TYPES = new Set([
  'GIRTH_WELD', 'VALVE', 'TEE', 'TAP', 'BEND', 'FIELD_BEND',
  'FLANGE', 'SUPPORT', 'LAUNCHER', 'RECEIVER', 'AGM'
]);

const ANOMALY_TYPES = new Set([
  'METAL_LOSS', 'CLUSTER', 'METAL_LOSS_MFG', 'DENT',
  'SEAM_WELD_MFG', 'OTHER'
]);

const COLORS = {
  pipeBackground: '#1a1a1a',
  pipeStroke: '#444',
  girthWeld: '#555555',
  valve: '#d4a017',
  tee: '#3498db',
  bend: '#e74c3c',
  anomalyFill: '#f5e6c8',
  anomalyStroke: '#b8860b',
  newAnomalyFill: 'transparent',
  newAnomalyStroke: '#e74c3c',
  matchedLine: 'rgba(46, 204, 113, 0.3)',
  alignmentRef: '#c0392b',
  baselineTag: '#27ae60',
  driftedTag: '#e67e22',
  moreDriftTag: '#e74c3c',
  background: '#ffffff',
  text: '#333',
  textLight: '#888',
  highlight: '#3498db',
  tooltipBg: '#1a1a1a',
  tooltipText: '#fff'
};

const LAYOUT = {
  marginLeft: 160,
  marginRight: 60,
  marginTop: 80,
  marginBottom: 50,
  runHeight: 180,      // vertical space per run row
  pipeY: 90,           // y-offset of pipe centerline within row
  pipeThickness: 16,
  featureMarkerH: 45,
  legendHeight: 190,
  minCanvasWidth: 1100,
};

// ──────────────────────────────────────────────────────────────────────
// Feature Marker SVG Shapes
// ──────────────────────────────────────────────────────────────────────
function GirthWeldMarker({ x, y }: { x: number; y: number }) {
  return (
    <rect
      x={x - 5}
      y={y - 27}
      width={10}
      height={54}
      fill={COLORS.girthWeld}
      stroke="#333"
      strokeWidth={0.8}
      rx={1}
    />
  );
}

function ValveMarker({ x, y }: { x: number; y: number }) {
  // Butterfly valve / bowtie shape
  const size = 16;
  return (
    <g>
      <polygon
        points={`${x - size},${y - size} ${x},${y} ${x - size},${y + size}`}
        fill={COLORS.valve}
        stroke="#8B6914"
        strokeWidth={1.5}
      />
      <polygon
        points={`${x + size},${y - size} ${x},${y} ${x + size},${y + size}`}
        fill={COLORS.valve}
        stroke="#8B6914"
        strokeWidth={1.5}
      />
      <circle cx={x} cy={y} r={5} fill="#fff" stroke="#8B6914" strokeWidth={1.5} />
    </g>
  );
}

function TeeMarker({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y + 33} r={17} fill={COLORS.tee} stroke="#2980b9" strokeWidth={2} />
      <text x={x} y={y + 39} textAnchor="middle" fill="#fff" fontSize={17} fontWeight="bold">T</text>
      <line x1={x} y1={y + 8} x2={x} y2={y + 16} stroke={COLORS.tee} strokeWidth={3} />
    </g>
  );
}

function BendMarker({ x, y }: { x: number; y: number }) {
  // Red circle with upward stem
  return (
    <g>
      <line x1={x} y1={y - 8} x2={x} y2={y - 30} stroke={COLORS.bend} strokeWidth={3} />
      <circle cx={x} cy={y - 33} r={10} fill={COLORS.bend} stroke="#c0392b" strokeWidth={1.5} />
      {/* Curved top */}
      <path
        d={`M${x - 6},${y - 30} Q${x},${y - 44} ${x + 6},${y - 30}`}
        fill="none"
        stroke={COLORS.bend}
        strokeWidth={3}
      />
    </g>
  );
}

function AnomalyMarker({ x, y, isNew }: { x: number; y: number; isNew: boolean }) {
  // Oval shape
  return (
    <ellipse
      cx={x}
      cy={y}
      rx={13}
      ry={10}
      fill={isNew ? COLORS.newAnomalyFill : COLORS.anomalyFill}
      stroke={isNew ? COLORS.newAnomalyStroke : COLORS.anomalyStroke}
      strokeWidth={isNew ? 3 : 2}
      strokeDasharray={isNew ? '5,3' : undefined}
    />
  );
}

function OtherMarker({ x, y }: { x: number; y: number }) {
  return (
    <rect
      x={x - 6}
      y={y - 6}
      width={12}
      height={12}
      fill="#aaa"
      stroke="#666"
      strokeWidth={1.5}
      rx={3}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helper: choose marker for feature type
// ──────────────────────────────────────────────────────────────────────
function FeatureIcon({
  x,
  y,
  type,
  matchStatus,
  opacity
}: {
  x: number;
  y: number;
  type: string;
  matchStatus: string;
  opacity: number;
}) {
  const isNew = matchStatus === 'new';
  const isAnomaly = ANOMALY_TYPES.has(type);
  const isControlPoint = CONTROL_POINT_TYPES.has(type);

  if (type === 'GIRTH_WELD') return <g opacity={opacity}><GirthWeldMarker x={x} y={y} /></g>;
  if (type === 'VALVE') return <g opacity={opacity}><ValveMarker x={x} y={y} /></g>;
  if (type === 'TEE' || type === 'TAP') return <g opacity={opacity}><TeeMarker x={x} y={y} /></g>;
  if (type === 'BEND' || type === 'FIELD_BEND') return <g opacity={opacity}><BendMarker x={x} y={y} /></g>;
  if (isAnomaly || !isControlPoint) return <g opacity={opacity}><AnomalyMarker x={x} y={y} isNew={isNew} /></g>;
  return <g opacity={opacity}><OtherMarker x={x} y={y} /></g>;
}

// ──────────────────────────────────────────────────────────────────────
// Drift Tag
// ──────────────────────────────────────────────────────────────────────
function DriftTag({ label, y }: { label: string; y: number }) {
  let bg = COLORS.baselineTag;
  if (label.includes('Drift') && !label.includes('More')) bg = COLORS.driftedTag;
  if (label.includes('More')) bg = COLORS.moreDriftTag;

  return (
    <g>
      <rect x={0} y={y - 12} width={100} height={24} rx={12} fill={bg} opacity={0.15} />
      <rect x={0} y={y - 12} width={100} height={24} rx={12} fill="none" stroke={bg} strokeWidth={1.5} />
      <text x={50} y={y + 4} textAnchor="middle" fill={bg} fontSize={11} fontWeight="600">{label}</text>
    </g>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Run Label
// ──────────────────────────────────────────────────────────────────────
function RunLabel({ run, y }: { run: VisualizationRun; y: number }) {
  return (
    <g>
      <rect x={4} y={y - 28} width={100} height={22} rx={4} fill="#e74c3c" opacity={0.9} />
      <text x={54} y={y - 13} textAnchor="middle" fill="#fff" fontSize={12} fontWeight="bold">
        ILI Run {run.runIndex + 1}
      </text>
      <text x={54} y={y + 2} textAnchor="middle" fill={COLORS.textLight} fontSize={10}>
        {run.year} {run.vendor ? `· ${run.vendor}` : ''}
      </text>
    </g>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tooltip Component
// ──────────────────────────────────────────────────────────────────────
function Tooltip({
  feature,
  x,
  y,
  svgRect
}: {
  feature: VisualizationFeature;
  x: number;
  y: number;
  svgRect: DOMRect | null;
}) {
  if (!svgRect) return null;

  const tooltipW = 290;
  const hasVisibility = feature.visibility && feature.visibility.visibilityState !== 'full';
  const hasStandards = feature.matchInfo?.standards?.asme_b31_8s?.applied;
  const hasML = feature.matchInfo?.mlAugmentation?.experimental && (feature.matchInfo.mlAugmentation.ml_confidence ?? 0) > 0;
  const tooltipH = (hasStandards ? 340 : hasVisibility ? 240 : 180) + (hasML ? 80 : 0);
  // Position tooltip above or below, flipping if near edge
  let tx = x - tooltipW / 2;
  let ty = y - tooltipH - 15;
  if (ty < 0) ty = y + 25;
  if (tx < 5) tx = 5;

  const std = feature.matchInfo?.standards;
  const severity = std?.asme_b31_8s?.severity_level;
  const severityColor = severity === 'IMMEDIATE' ? '#e74c3c' : severity === 'SCHEDULED' ? '#e67e22' : severity === 'MONITORING' ? '#f1c40f' : '#2ecc71';
  const growthClass = std?.nace_sp0502?.corrosion_class;
  const growthColor = growthClass === 'accelerating' ? '#e74c3c' : growthClass === 'growing' ? '#e67e22' : growthClass === 'stable' ? '#2ecc71' : '#888';

  return (
    <foreignObject x={tx} y={ty} width={tooltipW} height={tooltipH}>
      <div
        style={{
          background: COLORS.tooltipBg,
          color: COLORS.tooltipText,
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 12,
          lineHeight: 1.5,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          border: '1px solid #444',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#fff' }}>
          {feature.type} {feature.typeRaw ? `(${feature.typeRaw})` : ''}
        </div>
        <div><span style={{ color: '#aaa' }}>Distance:</span> {feature.distance.toFixed(1)} ft</div>
        {feature.drift !== 0 && (
          <div><span style={{ color: '#aaa' }}>Drift:</span> {feature.drift > 0 ? '+' : ''}{feature.drift.toFixed(2)} ft</div>
        )}
        {feature.depthPercent != null && (
          <div><span style={{ color: '#aaa' }}>Depth:</span> {feature.depthPercent.toFixed(1)}%</div>
        )}
        {feature.clockDecimal != null && (
          <div><span style={{ color: '#aaa' }}>Clock:</span> {feature.clockRaw || `${feature.clockDecimal.toFixed(1)}h`}</div>
        )}
        {feature.jointNumber != null && (
          <div><span style={{ color: '#aaa' }}>Joint #:</span> {feature.jointNumber}</div>
        )}
        <div style={{ marginTop: 4, fontWeight: 600, color: feature.matchStatus === 'matched' ? '#2ecc71' : feature.matchStatus === 'new' ? '#e74c3c' : '#f39c12' }}>
          {feature.matchStatus === 'matched' ? `\u2713 Matched (${feature.matchInfo?.score.toFixed(0)}%)` :
           feature.matchStatus === 'new' ? '\u25CF New Anomaly' :
           feature.matchStatus === 'missing' ? '\u26A0 Unmatched' : '\u25CB Unlinked'}
        </div>
        {feature.matchInfo?.growthPctYr != null && (
          <div><span style={{ color: '#aaa' }}>Growth:</span> {feature.matchInfo.growthPctYr.toFixed(2)} %/yr</div>
        )}

        {/* ── Standards Assessment Section ── */}
        {hasStandards && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #444' }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: '#9b59b6', marginBottom: 3 }}>\u2696 Standards Assessment</div>
            {severity && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: severityColor }} />
                <span style={{ color: '#aaa', fontSize: 11 }}>ASME B31.8S:</span>
                <span style={{ color: severityColor, fontWeight: 600, fontSize: 11 }}>{severity}</span>
              </div>
            )}
            {std?.asme_b31_8s?.repair_recommendation && (
              <div style={{ fontSize: 10, color: '#aaa', marginLeft: 12 }}>Repair: {std.asme_b31_8s.repair_recommendation}</div>
            )}
            {std?.asme_b31_8s?.interaction_zone && (
              <div style={{ fontSize: 10, color: '#e67e22', marginLeft: 12 }}>\u26A0 Interaction Zone ({std.asme_b31_8s.interaction_severity})</div>
            )}
            {growthClass && growthClass !== 'undetermined' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: growthColor }} />
                <span style={{ color: '#aaa', fontSize: 11 }}>NACE SP0502:</span>
                <span style={{ color: growthColor, fontWeight: 600, fontSize: 11 }}>{growthClass}</span>
                {std?.nace_sp0502?.remaining_life_years != null && (
                  <span style={{ color: '#888', fontSize: 10 }}>({std.nace_sp0502.remaining_life_years.toFixed(0)}yr life)</span>
                )}
              </div>
            )}
            {std?.api_1163?.applied && std?.api_1163?.adjusted_confidence != null && (
              <div style={{ fontSize: 11, marginTop: 2 }}>
                <span style={{ color: '#aaa' }}>API 1163 Adj.:</span>
                <span style={{ color: '#3498db', fontWeight: 600 }}> {std.api_1163.adjusted_confidence.toFixed(0)}%</span>
                <span style={{ color: '#666', fontSize: 9 }}> (wt {std.api_1163.tool_weight?.toFixed(2)})</span>
              </div>
            )}
          </div>
        )}

        {/* ── ML Augmentation Section (Experimental) ── */}
        {feature.matchInfo?.mlAugmentation?.experimental && feature.matchInfo.mlAugmentation.ml_confidence != null && feature.matchInfo.mlAugmentation.ml_confidence > 0 && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #444' }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: '#e67e22', marginBottom: 3 }}>
              &#x1F9EA; ML Augmentation <span style={{ fontWeight: 400, fontSize: 9, color: '#888' }}>(experimental)</span>
            </div>
            <div style={{ fontSize: 11 }}>
              <span style={{ color: '#aaa' }}>ML Adjusted:</span>
              <span style={{ color: '#3498db', fontWeight: 600 }}> {feature.matchInfo.mlAugmentation.adjusted_score?.toFixed(1)}%</span>
              <span style={{ color: '#666', fontSize: 10 }}> (det: {feature.matchInfo.score.toFixed(0)}%)</span>
            </div>
            <div style={{ fontSize: 11 }}>
              <span style={{ color: '#aaa' }}>ML Confidence:</span>
              <span style={{ color: '#2ecc71', fontWeight: 600 }}> {((feature.matchInfo.mlAugmentation.ml_confidence ?? 0) * 100).toFixed(0)}%</span>
            </div>
            <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
              {feature.matchInfo.mlAugmentation.model_id} · formula: det·0.8 + ml·0.2
            </div>
          </div>
        )}

        {feature.visibility && (
          <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #444' }}>
            <div style={{ color: feature.visibility.visibilityState === 'full' ? '#2ecc71' : feature.visibility.visibilityState === 'dimmed' ? '#f39c12' : '#e74c3c', fontWeight: 600, fontSize: 11 }}>
              Confidence: {feature.visibility.visibilityScore.toFixed(0)}% ({feature.visibility.visibilityState})
            </div>
            {feature.visibility.reasons.length > 0 && feature.visibility.visibilityState !== 'full' && (
              <div style={{ color: '#888', fontSize: 10, marginTop: 2 }}>
                {feature.visibility.reasons.slice(0, 2).join(' \u00B7 ')}
              </div>
            )}
          </div>
        )}
      </div>
    </foreignObject>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Legend Component
// ──────────────────────────────────────────────────────────────────────
function Legend({
  x,
  y,
  width,
  showControlPoints,
  showAnomalies,
  showLowConfidence,
  hasHiddenFeatures,
  onToggleControlPoints,
  onToggleAnomalies,
  onToggleLowConfidence
}: {
  x: number;
  y: number;
  width: number;
  showControlPoints: boolean;
  showAnomalies: boolean;
  showLowConfidence: boolean;
  hasHiddenFeatures: boolean;
  onToggleControlPoints: () => void;
  onToggleAnomalies: () => void;
  onToggleLowConfidence: () => void;
}) {
  const boxW = width - 20;
  const midX = x + boxW / 2;

  return (
    <g>
      {/* Legend box */}
      <rect x={x} y={y} width={boxW} height={130} rx={6} fill="#fafafa" stroke="#ddd" strokeWidth={1} />

      {/* Header: Alignment Control Points */}
      <text x={x + 20} y={y + 20} fontSize={12} fontWeight="700" fill={COLORS.text}>
        Alignment Control Points
      </text>

      {/* Girth Weld */}
      <rect x={x + 20} y={y + 30} width={6} height={20} fill={COLORS.girthWeld} stroke="#333" strokeWidth={0.5} rx={1} />
      <text x={x + 32} y={y + 44} fontSize={10} fill={COLORS.text}>Girth Weld</text>

      {/* Valve */}
      <g transform={`translate(${x + 100}, ${y + 40})`}>
        <polygon points="-6,-6 0,0 -6,6" fill={COLORS.valve} stroke="#8B6914" strokeWidth={0.8} />
        <polygon points="6,-6 0,0 6,6" fill={COLORS.valve} stroke="#8B6914" strokeWidth={0.8} />
      </g>
      <text x={x + 112} y={y + 44} fontSize={10} fill={COLORS.text}>Valve</text>

      {/* Tee */}
      <circle cx={x + 170} cy={y + 40} r={8} fill={COLORS.tee} stroke="#2980b9" strokeWidth={1} />
      <text x={x + 170} y={y + 44} textAnchor="middle" fill="#fff" fontSize={8} fontWeight="bold">T</text>
      <text x={x + 183} y={y + 44} fontSize={10} fill={COLORS.text}>Tee</text>

      {/* Bend */}
      <circle cx={x + 220} cy={y + 34} r={5} fill={COLORS.bend} stroke="#c0392b" strokeWidth={1} />
      <line x1={x + 220} y1={y + 39} x2={x + 220} y2={y + 48} stroke={COLORS.bend} strokeWidth={1.5} />
      <text x={x + 230} y={y + 44} fontSize={10} fill={COLORS.text}>Bend</text>

      {/* Header: Other Features */}
      <text x={midX + 20} y={y + 20} fontSize={12} fontWeight="700" fill={COLORS.text}>
        Other Features
      </text>

      {/* Anomaly */}
      <ellipse cx={midX + 30} cy={y + 40} rx={8} ry={5} fill={COLORS.anomalyFill} stroke={COLORS.anomalyStroke} strokeWidth={1.5} />
      <text x={midX + 45} y={y + 44} fontSize={10} fill={COLORS.text}>Anomaly</text>

      {/* New Anomaly */}
      <ellipse cx={midX + 120} cy={y + 40} rx={8} ry={5} fill="transparent" stroke={COLORS.newAnomalyStroke} strokeWidth={2} strokeDasharray="3,2" />
      <text x={midX + 135} y={y + 44} fontSize={10} fill={COLORS.text}>New Anomaly</text>

      {/* Alignment Reference */}
      <line x1={midX + 240} y1={y + 30} x2={midX + 240} y2={y + 50} stroke={COLORS.alignmentRef} strokeWidth={1.5} strokeDasharray="4,3" />
      <text x={midX + 250} y={y + 44} fontSize={10} fill={COLORS.text}>Alignment Reference</text>

      {/* Toggle buttons */}
      <g
        style={{ cursor: 'pointer' }}
        onClick={onToggleControlPoints}
        opacity={showControlPoints ? 1 : 0.4}
      >
        <rect x={x + 20} y={y + 65} width={12} height={12} rx={2} fill={showControlPoints ? COLORS.highlight : '#ccc'} stroke="#999" strokeWidth={1} />
        {showControlPoints && <text x={x + 26} y={y + 75} textAnchor="middle" fill="#fff" fontSize={10} fontWeight="bold">✓</text>}
        <text x={x + 38} y={y + 75} fontSize={10} fill={COLORS.text}>Control Points</text>
      </g>
      <g
        style={{ cursor: 'pointer' }}
        onClick={onToggleAnomalies}
        opacity={showAnomalies ? 1 : 0.4}
      >
        <rect x={x + 140} y={y + 65} width={12} height={12} rx={2} fill={showAnomalies ? COLORS.highlight : '#ccc'} stroke="#999" strokeWidth={1} />
        {showAnomalies && <text x={x + 146} y={y + 75} textAnchor="middle" fill="#fff" fontSize={10} fontWeight="bold">✓</text>}
        <text x={x + 158} y={y + 75} fontSize={10} fill={COLORS.text}>Anomalies</text>
      </g>
      {hasHiddenFeatures && (
        <g
          style={{ cursor: 'pointer' }}
          onClick={onToggleLowConfidence}
          opacity={showLowConfidence ? 1 : 0.4}
        >
          <rect x={x + 260} y={y + 65} width={12} height={12} rx={2} fill={showLowConfidence ? '#e74c3c' : '#ccc'} stroke="#999" strokeWidth={1} />
          {showLowConfidence && <text x={x + 266} y={y + 75} textAnchor="middle" fill="#fff" fontSize={10} fontWeight="bold">✓</text>}
          <text x={x + 278} y={y + 75} fontSize={10} fill={COLORS.text}>Low-Confidence</text>
        </g>
      )}

      {/* Standards severity legend row */}
      <text x={x + 20} y={y + 98} fontSize={12} fontWeight="700" fill={COLORS.text}>
        Standards
      </text>
      <circle cx={x + 100} cy={y + 95} r={5} fill="none" stroke="#e74c3c" strokeWidth={2} />
      <text x={x + 110} y={y + 99} fontSize={10} fill={COLORS.text}>Immediate</text>
      <circle cx={x + 180} cy={y + 95} r={5} fill="none" stroke="#e67e22" strokeWidth={2} />
      <text x={x + 190} y={y + 99} fontSize={10} fill={COLORS.text}>Scheduled</text>
      <polygon points={`${x + 260},${y + 89} ${x + 265},${y + 95} ${x + 260},${y + 101} ${x + 255},${y + 95}`} fill="#9b59b6" stroke="#8e44ad" strokeWidth={0.8} />
      <text x={x + 272} y={y + 99} fontSize={10} fill={COLORS.text}>Interaction Zone</text>
    </g>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Distance Axis
// ──────────────────────────────────────────────────────────────────────
function DistanceAxis({
  xScale,
  y,
  domainMin,
  domainMax,
  width
}: {
  xScale: (d: number) => number;
  y: number;
  domainMin: number;
  domainMax: number;
  width: number;
}) {
  const range = domainMax - domainMin;
  // Choose nice tick interval
  const candidates = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000];
  const targetTicks = Math.max(5, Math.min(20, Math.floor(width / 80)));
  const interval = candidates.find((c) => range / c <= targetTicks) ?? 50000;

  const ticks: number[] = [];
  const start = Math.ceil(domainMin / interval) * interval;
  for (let t = start; t <= domainMax; t += interval) {
    ticks.push(t);
  }

  return (
    <g>
      {ticks.map((t) => {
        const tx = xScale(t);
        return (
          <g key={t}>
            <line x1={tx} y1={y} x2={tx} y2={y + 6} stroke="#ccc" strokeWidth={1} />
            <text x={tx} y={y + 18} textAnchor="middle" fill={COLORS.textLight} fontSize={9}>
              {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}k` : t.toFixed(0)}
            </text>
          </g>
        );
      })}
      <text x={xScale((domainMin + domainMax) / 2)} y={y + 32} textAnchor="middle" fill={COLORS.textLight} fontSize={10}>
        Distance (ft)
      </text>
    </g>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────────────────
export function AlignmentDiagram({ data }: { data: VisualizationData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [hovered, setHovered] = useState<{ feature: VisualizationFeature; run: VisualizationRun; x: number; y: number } | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [showControlPoints, setShowControlPoints] = useState(true);
  const [showAnomalies, setShowAnomalies] = useState(true);
  const [showLowConfidence, setShowLowConfidence] = useState(false);
  const [highlightSeverity, setHighlightSeverity] = useState(false);
  const [viewRange, setViewRange] = useState<{ min: number; max: number } | null>(null);
  const [svgRect, setSvgRect] = useState<DOMRect | null>(null);
  const [containerWidth, setContainerWidth] = useState(LAYOUT.minCanvasWidth);

  // Observe container width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(([entry]) => {
      setContainerWidth(Math.max(LAYOUT.minCanvasWidth, entry.contentRect.width));
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  const { runs, distanceRange } = data;

  // SVG rect for tooltip positioning
  useEffect(() => {
    if (svgRef.current) {
      setSvgRect(svgRef.current.getBoundingClientRect());
    }
  }, [containerWidth]);

  // Scroll-wheel zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      // Convert pixel position to distance
      const frac = (mouseX - LAYOUT.marginLeft) / (rect.width - LAYOUT.marginLeft - LAYOUT.marginRight);
      const currentMin = viewRange?.min ?? distanceRange.min;
      const currentMax = viewRange?.max ?? distanceRange.max;
      const currentRange = currentMax - currentMin;
      const mouseDistance = currentMin + frac * currentRange;

      const factor = e.deltaY > 0 ? 1.2 : 0.8;
      const newRange = currentRange * factor;
      const newMin = Math.max(distanceRange.min, mouseDistance - frac * newRange);
      const newMax = Math.min(distanceRange.max, mouseDistance + (1 - frac) * newRange);

      if (newMax - newMin >= distanceRange.max - distanceRange.min) {
        setViewRange(null);
      } else if (newMax - newMin > 10) {
        setViewRange({ min: newMin, max: newMax });
      }
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, [distanceRange, viewRange]);

  // Effective distance range (viewport)
  const effectiveRange = viewRange ?? distanceRange;
  const domainMin = effectiveRange.min;
  const domainMax = effectiveRange.max;

  // X scale: distance → pixel (left-to-right)
  const plotWidth = containerWidth - LAYOUT.marginLeft - LAYOUT.marginRight;
  const xScale = useCallback(
    (d: number) => {
      const range = domainMax - domainMin || 1;
      return LAYOUT.marginLeft + ((d - domainMin) / range) * plotWidth;
    },
    [domainMin, domainMax, plotWidth]
  );

  // Total SVG height
  const totalRunsHeight = runs.length * LAYOUT.runHeight;
  const svgHeight = LAYOUT.marginTop + totalRunsHeight + LAYOUT.legendHeight + LAYOUT.marginBottom + 30;

  // Alignment reference position: use first girth weld of baseline
  const alignmentRefDistance = useMemo(() => {
    const baseline = runs.find((r) => r.isBaseline);
    if (!baseline) return null;
    const firstWeld = baseline.features.find((f) => f.type === 'GIRTH_WELD');
    return firstWeld?.distance ?? null;
  }, [runs]);

  // Build matched partner lookup
  const partnerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of runs) {
      for (const f of run.features) {
        if (f.matchInfo?.partnerId) {
          map.set(f.id, f.matchInfo.partnerId);
        }
      }
    }
    return map;
  }, [runs]);

  // Get the highlighted set (selected + all matched partners across runs)
  const highlightedIds = useMemo(() => {
    if (!selectedFeatureId) return new Set<string>();
    const ids = new Set<string>([selectedFeatureId]);
    // Follow match chain
    let current = selectedFeatureId;
    for (let i = 0; i < 10; i++) {
      const partner = partnerMap.get(current);
      if (!partner || ids.has(partner)) break;
      ids.add(partner);
      current = partner;
    }
    return ids;
  }, [selectedFeatureId, partnerMap]);

  // Zoom controls
  const zoomIn = () => {
    const range = domainMax - domainMin;
    const mid = (domainMin + domainMax) / 2;
    const newHalf = range * 0.35;
    setViewRange({ min: Math.max(distanceRange.min, mid - newHalf), max: Math.min(distanceRange.max, mid + newHalf) });
  };

  const zoomOut = () => {
    if (!viewRange) return;
    const range = domainMax - domainMin;
    const mid = (domainMin + domainMax) / 2;
    const newHalf = range * 0.75;
    const newMin = mid - newHalf;
    const newMax = mid + newHalf;
    if (newMin <= distanceRange.min && newMax >= distanceRange.max) {
      setViewRange(null);
    } else {
      setViewRange({ min: Math.max(distanceRange.min, newMin), max: Math.min(distanceRange.max, newMax) });
    }
  };

  const resetZoom = () => setViewRange(null);

  // Pan left/right
  const pan = (direction: number) => {
    const range = domainMax - domainMin;
    const shift = range * 0.2 * direction;
    const newMin = Math.max(distanceRange.min, domainMin + shift);
    const newMax = Math.min(distanceRange.max, domainMax + shift);
    setViewRange({ min: newMin, max: newMax });
  };

  // Filter features based on toggles + visibility + viewport culling + pixel deduplication
  const getVisibleFeatures = useCallback((features: VisualizationFeature[]) => {
    // First: type + visibility + viewport filter
    const inView = features.filter((f) => {
      const isControl = CONTROL_POINT_TYPES.has(f.type);
      const isAnomaly = ANOMALY_TYPES.has(f.type) || !isControl;
      if (isControl && !showControlPoints) return false;
      if (isAnomaly && !showAnomalies && f.type !== 'GIRTH_WELD') return false;
      if (f.distance < domainMin || f.distance > domainMax) return false;

      // Visibility gating: hide low-confidence unless toggle is on
      if (!showLowConfidence && f.visibility?.visibilityState === 'hidden') return false;

      return true;
    });

    // If < 2000 features, render all
    if (inView.length < 2000) return inView;

    // Pixel-level deduplication: keep max 1 feature per pixel bucket
    // Prioritize: highlighted > control points > anomalies
    const bucketSize = 2; // 2px minimum spacing
    const buckets = new Map<number, VisualizationFeature>();
    for (const f of inView) {
      const px = Math.round(xScale(f.distance) / bucketSize);
      const existing = buckets.get(px);
      if (!existing) {
        buckets.set(px, f);
      } else {
        // Prefer highlighted, then control points, then matched
        const fPriority = highlightedIds.has(f.id) ? 3 : CONTROL_POINT_TYPES.has(f.type) ? 2 : f.matchStatus === 'new' ? 1.5 : 1;
        const ePriority = highlightedIds.has(existing.id) ? 3 : CONTROL_POINT_TYPES.has(existing.type) ? 2 : existing.matchStatus === 'new' ? 1.5 : 1;
        if (fPriority > ePriority) buckets.set(px, f);
      }
    }
    return Array.from(buckets.values());
  }, [showControlPoints, showAnomalies, showLowConfidence, domainMin, domainMax, xScale, highlightedIds]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-lg">ILI Data Alignment</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {runs.length} runs · {runs.reduce((s, r) => s + r.features.length, 0).toLocaleString()} features · {data.totalMatches.toLocaleString()} matches
            {data.visibilitySummary && (data.visibilitySummary.dimmed > 0 || data.visibilitySummary.hidden > 0) && (
              <span className="ml-2">
                · <span className="text-amber-500">{data.visibilitySummary.dimmed} dimmed</span>
                · <span className="text-red-400">{data.visibilitySummary.hidden} hidden</span>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={highlightSeverity ? 'default' : 'outline'}
            onClick={() => setHighlightSeverity(!highlightSeverity)}
            className="text-xs"
          >
            {highlightSeverity ? 'Hide Severity' : 'Show Severity'}
          </Button>
          {data.visibilitySummary && data.visibilitySummary.hidden > 0 && (
            <Button
              size="sm"
              variant={showLowConfidence ? 'default' : 'outline'}
              onClick={() => setShowLowConfidence(!showLowConfidence)}
              className="text-xs"
            >
              {showLowConfidence ? 'Hide Low-Conf' : 'Show Low-Conf'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => pan(-1)}>◀</Button>
          <Button size="sm" variant="outline" onClick={zoomIn}>+</Button>
          <Button size="sm" variant="outline" onClick={zoomOut}>−</Button>
          <Button size="sm" variant="outline" onClick={resetZoom}>Reset</Button>
          <Button size="sm" variant="outline" onClick={() => pan(1)}>▶</Button>
        </div>
      </CardHeader>
      <CardContent ref={containerRef} className="overflow-x-auto p-0">
        <p className="text-center text-sm text-muted-foreground pt-1 pb-0">
          Same pipeline features appear at different reported locations in each ILI run
        </p>
        <svg
          ref={svgRef}
          width={containerWidth}
          height={svgHeight}
          viewBox={`0 0 ${containerWidth} ${svgHeight}`}
          style={{ display: 'block', userSelect: 'none' }}
        >
          {/* Distance axis at top */}
          <DistanceAxis
            xScale={xScale}
            y={LAYOUT.marginTop - 30}
            domainMin={domainMin}
            domainMax={domainMax}
            width={plotWidth}
          />

          {/* Alignment reference dashed vertical line */}
          {alignmentRefDistance != null && alignmentRefDistance >= domainMin && alignmentRefDistance <= domainMax && (
            <line
              x1={xScale(alignmentRefDistance)}
              y1={LAYOUT.marginTop}
              x2={xScale(alignmentRefDistance)}
              y2={LAYOUT.marginTop + totalRunsHeight}
              stroke={COLORS.alignmentRef}
              strokeWidth={1.5}
              strokeDasharray="6,4"
              opacity={0.7}
            />
          )}

          {/* Run rows */}
          {runs.map((run, rowIndex) => {
            const rowY = LAYOUT.marginTop + rowIndex * LAYOUT.runHeight;
            const pipeY = rowY + LAYOUT.pipeY;

            return (
              <g key={run.runId}>
                {/* Row background */}
                <rect
                  x={0}
                  y={rowY}
                  width={containerWidth}
                  height={LAYOUT.runHeight}
                  fill={rowIndex % 2 === 0 ? '#fafafa' : '#f4f4f4'}
                />

                {/* Run label */}
                <RunLabel run={run} y={pipeY} />

                {/* Drift tag on right */}
                <g transform={`translate(${containerWidth - 110}, ${pipeY - 12})`}>
                  <DriftTag label={run.driftLabel} y={12} />
                </g>

                {/* Pipeline bar */}
                <rect
                  x={LAYOUT.marginLeft}
                  y={pipeY - LAYOUT.pipeThickness / 2}
                  width={plotWidth}
                  height={LAYOUT.pipeThickness}
                  fill={COLORS.pipeBackground}
                  rx={3}
                />

                {/* Drift arrows for non-baseline */}
                {!run.isBaseline && alignmentRefDistance != null && (
                  <g>
                    {/* Small drift arrow at the left side */}
                    <line
                      x1={LAYOUT.marginLeft + 6}
                      y1={pipeY}
                      x2={LAYOUT.marginLeft + 20}
                      y2={pipeY}
                      stroke={COLORS.alignmentRef}
                      strokeWidth={2}
                      markerEnd="url(#arrowhead)"
                    />
                  </g>
                )}

                {/* Feature markers */}
                {getVisibleFeatures(run.features)
                  .map((feature) => {
                    const fx = xScale(feature.distance);
                    const isHighlighted = highlightedIds.has(feature.id);
                    const isDimmed = selectedFeatureId != null && !isHighlighted;
                    // Visibility-aware opacity: dimmed features at 0.25, selection dimming at 0.2
                    const visState = feature.visibility?.visibilityState ?? 'full';
                    const visOpacity = visState === 'dimmed' ? 0.25 : 1;
                    const opacity = isDimmed ? 0.2 : visOpacity;

                    return (
                      <g
                        key={feature.id}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={(e) => {
                          const svg = svgRef.current;
                          if (!svg) return;
                          const pt = svg.createSVGPoint();
                          pt.x = e.clientX;
                          pt.y = e.clientY;
                          const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
                          setHovered({ feature, run, x: svgP.x, y: svgP.y });
                        }}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => {
                          setSelectedFeatureId(selectedFeatureId === feature.id ? null : feature.id);
                        }}
                      >
                        <FeatureIcon
                          x={fx}
                          y={pipeY}
                          type={feature.type}
                          matchStatus={feature.matchStatus}
                          opacity={opacity}
                        />

                        {/* Severity ring for ASME B31.8S severity (IMMEDIATE=red, SCHEDULED=orange) */}
                        {feature.matchInfo?.standards?.asme_b31_8s?.severity_level &&
                         ['IMMEDIATE', 'SCHEDULED'].includes(feature.matchInfo.standards.asme_b31_8s.severity_level!) && (
                          <circle
                            cx={fx}
                            cy={pipeY}
                            r={16}
                            fill="none"
                            stroke={feature.matchInfo.standards.asme_b31_8s.severity_level === 'IMMEDIATE' ? '#e74c3c' : '#e67e22'}
                            strokeWidth={2.5}
                            opacity={opacity * 0.8}
                          />
                        )}

                        {/* Interaction zone indicator (small diamond) */}
                        {feature.matchInfo?.standards?.asme_b31_8s?.interaction_zone && (
                          <polygon
                            points={`${fx},${pipeY - 20} ${fx + 5},${pipeY - 15} ${fx},${pipeY - 10} ${fx - 5},${pipeY - 15}`}
                            fill="#9b59b6"
                            stroke="#8e44ad"
                            strokeWidth={1}
                            opacity={opacity * 0.9}
                          />
                        )}

                        {/* Highlight ring for selected/matched */}
                        {isHighlighted && (
                          <circle
                            cx={fx}
                            cy={pipeY}
                            r={14}
                            fill="none"
                            stroke={COLORS.highlight}
                            strokeWidth={2}
                            strokeDasharray="4,2"
                          />
                        )}
                      </g>
                    );
                  })}
              </g>
            );
          })}

          {/* Match lines connecting matched features across runs */}
          {selectedFeatureId && runs.map((run, rowIndex) => {
            if (rowIndex >= runs.length - 1) return null;
            const nextRun = runs[rowIndex + 1];
            const pipeY1 = LAYOUT.marginTop + rowIndex * LAYOUT.runHeight + LAYOUT.pipeY;
            const pipeY2 = LAYOUT.marginTop + (rowIndex + 1) * LAYOUT.runHeight + LAYOUT.pipeY;

            return run.features
              .filter((f) => highlightedIds.has(f.id))
              .map((f) => {
                const partner = nextRun.features.find((nf) => highlightedIds.has(nf.id) && partnerMap.get(f.id) === nf.id);
                if (!partner) return null;
                if (f.distance < domainMin || f.distance > domainMax) return null;
                if (partner.distance < domainMin || partner.distance > domainMax) return null;

                return (
                  <line
                    key={`match-${f.id}-${partner.id}`}
                    x1={xScale(f.distance)}
                    y1={pipeY1 + LAYOUT.pipeThickness / 2 + 2}
                    x2={xScale(partner.distance)}
                    y2={pipeY2 - LAYOUT.pipeThickness / 2 - 2}
                    stroke={COLORS.highlight}
                    strokeWidth={2}
                    strokeDasharray="4,2"
                    opacity={0.7}
                  />
                );
              });
          })}

          {/* Arrowhead marker def */}
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={COLORS.alignmentRef} />
            </marker>
          </defs>

          {/* Legend */}
          <Legend
            x={LAYOUT.marginLeft}
            y={LAYOUT.marginTop + totalRunsHeight + 15}
            width={plotWidth}
            showControlPoints={showControlPoints}
            showAnomalies={showAnomalies}
            showLowConfidence={showLowConfidence}
            hasHiddenFeatures={(data.visibilitySummary?.hidden ?? 0) > 0}
            onToggleControlPoints={() => setShowControlPoints(!showControlPoints)}
            onToggleAnomalies={() => setShowAnomalies(!showAnomalies)}
            onToggleLowConfidence={() => setShowLowConfidence(!showLowConfidence)}
          />

          {/* Tooltip */}
          {hovered && (
            <Tooltip
              feature={hovered.feature}
              x={hovered.x}
              y={hovered.y}
              svgRect={svgRect}
            />
          )}
        </svg>
      </CardContent>
    </Card>
  );
}
