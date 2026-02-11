'use client';

/**
 * 2.5D Cylindrical Surface Visualization — Performance-Optimized
 *
 * Projects aligned ILI data onto a cylindrical surface to provide
 * circumferential context beyond the 2D strip-chart view.
 *
 * ───────────────────────────────────────────────────────────────────
 * Data Model (read-only projection):
 *
 *   X-axis   = corrected_distance_ft (from 2D alignment — unchanged)
 *   θ-angle  = clock_position mapped to angle (12h → 2π radians)
 *   Radius   = constant (visual only, no physical meaning)
 *
 *   This is the ONLY defensible "3D" representation for ILI data
 *   because ILI tools measure two spatial dimensions:
 *     1. Distance along the pipe centerline (odometer)
 *     2. Clock position around the circumference
 *   They do NOT measure pipe curvature, elevation, terrain, or
 *   wall geometry. Any attempt to reconstruct those would be
 *   data invention — explicitly prohibited.
 *
 * ───────────────────────────────────────────────────────────────────
 * Performance Strategy (vs. naive per-feature React components):
 *
 *   1. InstancedMesh: All anomalies, control points, and welds
 *      rendered via THREE.InstancedMesh — reduces draw calls from
 *      O(n) to O(1) per geometry type (sphere, box, torus).
 *
 *   2. Spatial Index: Features pre-sorted by distance for O(log n)
 *      binary-search viewport queries (vs. O(n) filter).
 *
 *   3. Opacity Groups: Separate instanced meshes for full (1.0) and
 *      dimmed (0.25) opacity — avoids per-instance shader branching.
 *
 *   4. Shared Geometry: Module-level geometry objects created once,
 *      reused across all instances and re-renders.
 *
 *   5. Hover Overlay: Single highlight mesh instead of per-instance
 *      hover state (eliminates N useState hooks from old code).
 *
 *   6. React.memo: Instanced components skip re-render on hover state
 *      changes — only re-render when items/opacity actually change.
 *
 *   7. Feature Cap: ≤5,000 visible markers, priority-sorted.
 *
 * ───────────────────────────────────────────────────────────────────
 * Integration:
 *
 *   Consumes the IDENTICAL VisualizationData from the 2D view.
 *   No recomputation, reinterpretation, or filtering.
 *   All visibility rules (confidence gating) are respected.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type {
  VisualizationData,
  VisualizationFeature,
  VisualizationRun,
} from './AlignmentDiagram';

// ══════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════

const PIPE_RADIUS = 1.0;
const PIPE_SEGMENTS = 64;
const MAX_VISIBLE = 5000;

const RUN_COLORS = [
  '#e74c3c', // oldest → red
  '#f39c12', // middle → amber
  '#2ecc71', // newest → green
  '#3498db', // 4th run → blue
  '#9b59b6', // 5th run → purple
];

const ANOMALY_COLORS: Record<string, string> = {
  METAL_LOSS: '#f5e6c8',
  CLUSTER: '#e8d5b7',
  METAL_LOSS_MFG: '#dbc8a0',
  DENT: '#c0392b',
  SEAM_WELD_MFG: '#8e44ad',
  OTHER: '#95a5a6',
};

const CONTROL_TYPES = new Set([
  'GIRTH_WELD', 'VALVE', 'TEE', 'TAP', 'BEND', 'FIELD_BEND',
  'FLANGE', 'SUPPORT', 'LAUNCHER', 'RECEIVER', 'AGM',
]);

// ══════════════════════════════════════════════════════════════════════
// Shared Geometries — created once at module load, never disposed.
// Safe because this module is loaded client-only via next/dynamic.
// ══════════════════════════════════════════════════════════════════════

const GEO_SPHERE = new THREE.SphereGeometry(1, 10, 7);
const GEO_BOX    = new THREE.BoxGeometry(1, 1, 1);
const GEO_TORUS  = new THREE.TorusGeometry(PIPE_RADIUS, 0.015, 6, PIPE_SEGMENTS);

/** Reusable scratch objects for instance matrix/color updates */
const _obj = new THREE.Object3D();
const _col = new THREE.Color();

// ══════════════════════════════════════════════════════════════════════
// Geometry Mapping (deterministic only)
// ══════════════════════════════════════════════════════════════════════

/**
 * Convert clock position (0–12h) to angle in radians.
 * 12:00 = top (π/2), proceeding clockwise when looking downstream.
 */
function clockToAngle(clock: number | null | undefined): number {
  if (clock == null || !Number.isFinite(clock)) return 0;
  const n = ((clock % 12) + 12) % 12;
  return Math.PI / 2 - (n / 12) * 2 * Math.PI;
}

/** Map distance + clock to [x, y, z] on the cylinder surface. */
function toSurface(
  dist: number,
  clock: number | null | undefined,
  scale: number,
  r = PIPE_RADIUS,
): [number, number, number] {
  const a = clockToAngle(clock);
  return [dist * scale, Math.sin(a) * r, Math.cos(a) * r];
}

// ══════════════════════════════════════════════════════════════════════
// Spatial Index
// ══════════════════════════════════════════════════════════════════════

type IdxFeature = {
  feature: VisualizationFeature;
  run: VisualizationRun;
  dist: number;
  pos: [number, number, number];
  color: string;
  size: number;
  opacity: number;
  isCtrl: boolean;
  isWeld: boolean;
  priority: number;
};

/**
 * Build a distance-sorted index of all visible features.
 * Deterministic: same inputs → same output, no randomness.
 */
function buildIndex(
  runs: VisualizationRun[],
  visRunIds: Set<string>,
  showLow: boolean,
  scale: number,
  selId: string | null,
): IdxFeature[] {
  const out: IdxFeature[] = [];

  for (const run of runs) {
    if (!visRunIds.has(run.runId)) continue;
    const rc = RUN_COLORS[run.runIndex % RUN_COLORS.length];

    for (const f of run.features) {
      const vs = f.visibility?.visibilityState ?? 'full';
      if (!showLow && vs === 'hidden') continue;

      const isCtrlRaw = CONTROL_TYPES.has(f.type);
      const isWeld = f.type === 'GIRTH_WELD';
      const pos = toSurface(f.distance, f.clockDecimal, scale);

      // Color
      let color: string;
      if (isWeld) {
        color = '#555555';
      } else if (isCtrlRaw) {
        color = f.type === 'VALVE' ? '#d4a017'
          : f.type === 'TEE' ? '#3498db'
          : (f.type === 'BEND' || f.type === 'FIELD_BEND') ? '#e74c3c'
          : '#888888';
      } else {
        const tc = ANOMALY_COLORS[f.type] ?? rc;
        color = f.matchStatus === 'new' ? '#e74c3c'
          : f.matchStatus === 'matched' ? tc
          : '#f39c12';
      }

      // Size (anomalies scale with depth percentage)
      const base = isCtrlRaw ? 0.03 : 0.04;
      const df = (!isCtrlRaw && f.depthPercent != null)
        ? Math.max(0.5, Math.min(2, f.depthPercent / 30))
        : 1;

      out.push({
        feature: f,
        run,
        dist: f.distance,
        pos,
        color,
        size: base * df,
        opacity: f.id === selId ? 1 : vs === 'dimmed' ? 0.25 : 1,
        isCtrl: isCtrlRaw && !isWeld,
        isWeld,
        priority: f.id === selId ? 10
          : f.matchStatus === 'matched' ? 5
          : isCtrlRaw ? 4
          : f.matchStatus === 'new' ? 3 : 1,
      });
    }
  }

  out.sort((a, b) => a.dist - b.dist);
  return out;
}

/** Binary search: first index where dist >= min */
function lb(arr: IdxFeature[], min: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    arr[m].dist < min ? (lo = m + 1) : (hi = m);
  }
  return lo;
}

/** Binary search: first index where dist > max */
function ub(arr: IdxFeature[], max: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    arr[m].dist <= max ? (lo = m + 1) : (hi = m);
  }
  return lo;
}

// ── Grouped output for instanced rendering ──

type Groups = {
  anomFull: IdxFeature[];
  anomDim: IdxFeature[];
  ctrlFull: IdxFeature[];
  ctrlDim: IdxFeature[];
  weldX: number[];
};

function windowGroups(idx: IdxFeature[], vMin: number, vMax: number): Groups {
  let win = idx.slice(lb(idx, vMin), ub(idx, vMax));

  // Cap with priority-based sorting
  if (win.length > MAX_VISIBLE) {
    win.sort((a, b) => b.priority - a.priority);
    win.length = MAX_VISIBLE;
  }

  const af: IdxFeature[] = [], ad: IdxFeature[] = [];
  const cf: IdxFeature[] = [], cd: IdxFeature[] = [];
  const wx: number[] = [];

  for (const f of win) {
    if (f.isWeld) {
      wx.push(f.pos[0]);
    } else if (f.isCtrl) {
      (f.opacity >= 1 ? cf : cd).push(f);
    } else {
      (f.opacity >= 1 ? af : ad).push(f);
    }
  }

  // Deduplicate weld positions (within 0.01 world units)
  const uniqueWelds = [...new Set(wx.map(w => Math.round(w * 100) / 100))];

  return {
    anomFull: af,
    anomDim: ad,
    ctrlFull: cf,
    ctrlDim: cd,
    weldX: uniqueWelds,
  };
}

// ══════════════════════════════════════════════════════════════════════
// Hover State
// ══════════════════════════════════════════════════════════════════════

type HoverInfo = {
  feature: VisualizationFeature;
  run: VisualizationRun;
  screenX: number;
  screenY: number;
  pos: [number, number, number];
  size: number;
  color: string;
  isCtrl: boolean;
};

// ══════════════════════════════════════════════════════════════════════
// Instanced Mesh Components
//
// Each renders ALL items of its type in a SINGLE draw call via
// THREE.InstancedMesh. Per-instance color via setColorAt().
// Wrapped in React.memo to skip re-renders on hover state changes.
// ══════════════════════════════════════════════════════════════════════

/** Render N anomaly spheres in 1 draw call */
const ISpheres = React.memo(function ISpheres({
  items,
  opacity,
  onOver,
  onOut,
  onClick,
}: {
  items: IdxFeature[];
  opacity: number;
  onOver: (e: ThreeEvent<PointerEvent>, f: IdxFeature) => void;
  onOut: () => void;
  onClick?: (e: ThreeEvent<MouseEvent>, f: IdxFeature) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    _obj.rotation.set(0, 0, 0); // reset from any prior torus usage
    for (let i = 0; i < items.length; i++) {
      _obj.position.set(...items[i].pos);
      _obj.scale.setScalar(items[i].size);
      _obj.updateMatrix();
      m.setMatrixAt(i, _obj.matrix);
      _col.set(items[i].color);
      m.setColorAt(i, _col);
    }
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);

  if (!items.length) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[GEO_SPHERE, undefined, MAX_VISIBLE]}
      onPointerOver={(e) => {
        e.stopPropagation();
        const i = e.instanceId;
        if (i != null && itemsRef.current[i]) onOver(e, itemsRef.current[i]);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onOut();
      }}
      onClick={onClick ? (e) => {
        e.stopPropagation();
        const i = e.instanceId;
        if (i != null && itemsRef.current[i]) onClick(e, itemsRef.current[i]);
      } : undefined}
    >
      <meshStandardMaterial transparent opacity={opacity} depthWrite={opacity >= 1} />
    </instancedMesh>
  );
});

/** Render N control-point boxes in 1 draw call */
const IBoxes = React.memo(function IBoxes({
  items,
  opacity,
  onOver,
  onOut,
}: {
  items: IdxFeature[];
  opacity: number;
  onOver: (e: ThreeEvent<PointerEvent>, f: IdxFeature) => void;
  onOut: () => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    _obj.rotation.set(0, 0, 0);
    for (let i = 0; i < items.length; i++) {
      _obj.position.set(...items[i].pos);
      _obj.scale.set(0.03, 0.06, 0.06);
      _obj.updateMatrix();
      m.setMatrixAt(i, _obj.matrix);
      _col.set(items[i].color);
      m.setColorAt(i, _col);
    }
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);

  if (!items.length) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[GEO_BOX, undefined, MAX_VISIBLE]}
      onPointerOver={(e) => {
        e.stopPropagation();
        const i = e.instanceId;
        if (i != null && itemsRef.current[i]) onOver(e, itemsRef.current[i]);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onOut();
      }}
    >
      <meshStandardMaterial transparent opacity={opacity} depthWrite={opacity >= 1} />
    </instancedMesh>
  );
});

/** Render N weld torus rings in 1 draw call */
const IWelds = React.memo(function IWelds({ xs }: { xs: number[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    for (let i = 0; i < xs.length; i++) {
      _obj.position.set(xs[i], 0, 0);
      _obj.rotation.set(0, 0, Math.PI / 2);
      _obj.scale.setScalar(1);
      _obj.updateMatrix();
      m.setMatrixAt(i, _obj.matrix);
    }
    m.count = xs.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [xs]);

  if (!xs.length) return null;

  return (
    <instancedMesh ref={ref} args={[GEO_TORUS, undefined, Math.max(1, xs.length)]}>
      <meshStandardMaterial color="#555555" transparent opacity={0.5} />
    </instancedMesh>
  );
});

// ══════════════════════════════════════════════════════════════════════
// Static Scene Elements
// ══════════════════════════════════════════════════════════════════════

function PipeSegment({ startX, endX }: { startX: number; endX: number }) {
  const len = endX - startX;
  return (
    <mesh position={[(startX + endX) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[PIPE_RADIUS, PIPE_RADIUS, len, PIPE_SEGMENTS, 1, true]} />
      <meshStandardMaterial
        color="#333333"
        transparent
        opacity={0.08}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function DistanceTicks({ dMin, dMax, scale }: { dMin: number; dMax: number; scale: number }) {
  const ticks = useMemo(() => {
    const range = dMax - dMin;
    const targetTicks = Math.min(20, Math.max(5, Math.floor(range / 200)));
    const interval = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000]
      .find(c => range / c <= targetTicks) ?? 50000;
    const out: number[] = [];
    for (let t = Math.ceil(dMin / interval) * interval; t <= dMax; t += interval) out.push(t);
    return out;
  }, [dMin, dMax]);

  return (
    <group>
      {ticks.map(t => (
        <group key={t}>
          <Text
            position={[t * scale, -PIPE_RADIUS - 0.3, 0]}
            fontSize={0.12}
            color="#888888"
            anchorX="center"
            anchorY="top"
          >
            {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}k ft` : `${t} ft`}
          </Text>
          <Line
            points={[[t * scale, -PIPE_RADIUS - 0.05, 0], [t * scale, -PIPE_RADIUS - 0.15, 0]]}
            color="#666666"
            lineWidth={1}
          />
        </group>
      ))}
    </group>
  );
}

function ClockLabels({ x }: { x: number }) {
  const labels: [number, string][] = [[0, '12:00'], [3, '3:00'], [6, '6:00'], [9, '9:00']];
  return (
    <group>
      {labels.map(([ck, label]) => {
        const a = clockToAngle(ck);
        const r = PIPE_RADIUS + 0.2;
        return (
          <Text
            key={label}
            position={[x, Math.sin(a) * r, Math.cos(a) * r]}
            fontSize={0.1}
            color="#aaaaaa"
            anchorX="center"
            anchorY="middle"
          >
            {label}
          </Text>
        );
      })}
    </group>
  );
}

/** Auto-frame the camera to show the visible range on first render */
function CameraSetup({ dMin, dMax, scale }: { dMin: number; dMax: number; scale: number }) {
  const { camera } = useThree();
  const done = useRef(false);

  useFrame(() => {
    if (!done.current) {
      const mx = ((dMin + dMax) / 2) * scale;
      camera.position.set(mx, 2, Math.max(3, (dMax - dMin) * scale * 0.15));
      camera.lookAt(mx, 0, 0);
      done.current = true;
    }
  });

  return null;
}

/** Single overlay mesh at hovered position — replaces N per-instance states */
function HoverHighlight({ info }: { info: HoverInfo }) {
  return (
    <mesh position={info.pos} scale={info.isCtrl ? 1.4 : 1.5}>
      {info.isCtrl
        ? <boxGeometry args={[0.03, 0.06, 0.06]} />
        : <sphereGeometry args={[info.size, 10, 7]} />}
      <meshStandardMaterial
        color="#ffffff"
        transparent
        opacity={0.7}
        emissive={info.color}
        emissiveIntensity={0.5}
        depthTest={false}
      />
    </mesh>
  );
}

// ══════════════════════════════════════════════════════════════════════
// HTML Overlay Tooltip
// ══════════════════════════════════════════════════════════════════════

function HtmlTooltip({ info }: { info: HoverInfo | null }) {
  if (!info) return null;
  const { feature: f, run, screenX, screenY } = info;

  return (
    <div
      style={{
        position: 'fixed',
        left: screenX + 15,
        top: screenY - 10,
        background: '#1a1a1a',
        color: '#fff',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 12,
        lineHeight: 1.5,
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        border: '1px solid #444',
        pointerEvents: 'none',
        zIndex: 1000,
        maxWidth: 280,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
        {f.type} {f.typeRaw ? `(${f.typeRaw})` : ''}
      </div>
      <div><span style={{ color: '#aaa' }}>Run:</span> {run.year} {run.label}</div>
      <div><span style={{ color: '#aaa' }}>Distance:</span> {f.distance.toFixed(1)} ft</div>
      {f.clockDecimal != null && (
        <div><span style={{ color: '#aaa' }}>Clock:</span> {f.clockRaw || `${f.clockDecimal.toFixed(1)}h`}</div>
      )}
      {f.depthPercent != null && (
        <div><span style={{ color: '#aaa' }}>Depth:</span> {f.depthPercent.toFixed(1)}%</div>
      )}
      <div style={{
        marginTop: 4,
        fontWeight: 600,
        color: f.matchStatus === 'matched' ? '#2ecc71'
          : f.matchStatus === 'new' ? '#e74c3c'
          : '#f39c12',
      }}>
        {f.matchStatus === 'matched' ? `✓ Matched (${f.matchInfo?.score.toFixed(0)}%)`
          : f.matchStatus === 'new' ? '● New'
          : f.matchStatus === 'missing' ? '⚠ Unmatched'
          : '○ Unlinked'}
      </div>
      {f.visibility && f.visibility.visibilityState !== 'full' && (
        <div style={{ color: '#888', fontSize: 10, marginTop: 2 }}>
          Confidence: {f.visibility.visibilityScore.toFixed(0)}% ({f.visibility.visibilityState})
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Scene Content (renders inside Canvas)
// ══════════════════════════════════════════════════════════════════════

function SceneContent({
  groups,
  viewRange,
  distanceScale,
  onHover,
  onUnhover,
  onSelect,
  hoveredInfo,
}: {
  groups: Groups;
  viewRange: { min: number; max: number };
  distanceScale: number;
  onHover: (info: HoverInfo) => void;
  onUnhover: () => void;
  onSelect: (id: string | null) => void;
  hoveredInfo: HoverInfo | null;
}) {
  // Stable callbacks — only depend on stable parent setters
  const handleOver = useCallback((e: ThreeEvent<PointerEvent>, f: IdxFeature) => {
    document.body.style.cursor = 'pointer';
    onHover({
      feature: f.feature,
      run: f.run,
      screenX: e.nativeEvent.clientX,
      screenY: e.nativeEvent.clientY,
      pos: f.pos,
      size: f.size,
      color: f.color,
      isCtrl: f.isCtrl,
    });
  }, [onHover]);

  const handleOut = useCallback(() => {
    document.body.style.cursor = 'auto';
    onUnhover();
  }, [onUnhover]);

  const handleClick = useCallback((_e: ThreeEvent<MouseEvent>, f: IdxFeature) => {
    onSelect(f.feature.id);
  }, [onSelect]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      <directionalLight position={[-5, -5, -5]} intensity={0.3} />

      {/* Pipe body */}
      <PipeSegment
        startX={viewRange.min * distanceScale}
        endX={viewRange.max * distanceScale}
      />

      {/* Instanced weld rings — 1 draw call for all welds */}
      <IWelds xs={groups.weldX} />

      {/* Instanced anomaly spheres — full opacity (1 draw call) */}
      <ISpheres
        items={groups.anomFull}
        opacity={1}
        onOver={handleOver}
        onOut={handleOut}
        onClick={handleClick}
      />

      {/* Instanced anomaly spheres — dimmed opacity (1 draw call) */}
      <ISpheres
        items={groups.anomDim}
        opacity={0.25}
        onOver={handleOver}
        onOut={handleOut}
        onClick={handleClick}
      />

      {/* Instanced control-point boxes — full opacity (1 draw call) */}
      <IBoxes
        items={groups.ctrlFull}
        opacity={1}
        onOver={handleOver}
        onOut={handleOut}
      />

      {/* Instanced control-point boxes — dimmed opacity (1 draw call) */}
      <IBoxes
        items={groups.ctrlDim}
        opacity={0.25}
        onOver={handleOver}
        onOut={handleOut}
      />

      {/* Hover highlight overlay — single mesh at hovered position */}
      {hoveredInfo && <HoverHighlight info={hoveredInfo} />}

      {/* Distance ticks + clock labels */}
      <DistanceTicks dMin={viewRange.min} dMax={viewRange.max} scale={distanceScale} />
      <ClockLabels x={viewRange.min * distanceScale - 0.3} />

      {/* Camera auto-frame + orbit controls */}
      <CameraSetup dMin={viewRange.min} dMax={viewRange.max} scale={distanceScale} />
      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        minDistance={0.5}
        maxDistance={50}
        enablePan
        panSpeed={1.5}
      />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Main Component (exported)
// ══════════════════════════════════════════════════════════════════════

export function CylinderView({ data }: { data: VisualizationData }) {
  const { runs, distanceRange } = data;

  const [viewRange, setViewRange] = useState<{ min: number; max: number } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLow, setShowLow] = useState(false);
  const [visRunIds, setVisRunIds] = useState<Set<string>>(
    () => new Set(runs.map(r => r.runId))
  );

  const range = viewRange ?? distanceRange;
  const fullSpan = distanceRange.max - distanceRange.min || 1;
  const scale = 20 / fullSpan;

  // ── Stable callbacks for SceneContent ──
  const handleUnhover = useCallback(() => setHoverInfo(null), []);
  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(prev => prev === id ? null : id);
  }, []);

  // ── Spatial index: recomputed only when data/filters change ──
  const sortedIdx = useMemo(
    () => buildIndex(runs, visRunIds, showLow, scale, selectedId),
    [runs, visRunIds, showLow, scale, selectedId],
  );

  // ── Windowed groups: recomputed only when index or viewport changes ──
  const groups = useMemo(
    () => windowGroups(sortedIdx, range.min, range.max),
    [sortedIdx, range.min, range.max],
  );

  // ── Viewport controls ──
  const zoomIn = () => {
    const span = range.max - range.min;
    const mid = (range.min + range.max) / 2;
    const h = span * 0.35;
    setViewRange({
      min: Math.max(distanceRange.min, mid - h),
      max: Math.min(distanceRange.max, mid + h),
    });
  };

  const zoomOut = () => {
    if (!viewRange) return;
    const span = range.max - range.min;
    const mid = (range.min + range.max) / 2;
    const h = span * 0.75;
    if (mid - h <= distanceRange.min && mid + h >= distanceRange.max) {
      setViewRange(null);
    } else {
      setViewRange({
        min: Math.max(distanceRange.min, mid - h),
        max: Math.min(distanceRange.max, mid + h),
      });
    }
  };

  const pan = (dir: number) => {
    const shift = (range.max - range.min) * 0.2 * dir;
    setViewRange({
      min: Math.max(distanceRange.min, range.min + shift),
      max: Math.min(distanceRange.max, range.max + shift),
    });
  };

  const toggleRun = (id: string) => setVisRunIds(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const totalFeatures = runs.reduce((s, r) => s + r.features.length, 0);
  const visibleCount = groups.anomFull.length + groups.anomDim.length
    + groups.ctrlFull.length + groups.ctrlDim.length + groups.weldX.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-lg">3D Surface View (Experimental)</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Cylindrical projection · {runs.length} runs · {totalFeatures.toLocaleString()} total · {visibleCount.toLocaleString()} visible
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5 italic">
            Instanced rendering · ≤6 draw calls · All positions from aligned 2D model
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.visibilitySummary && data.visibilitySummary.hidden > 0 && (
            <Button
              size="sm"
              variant={showLow ? 'default' : 'outline'}
              onClick={() => setShowLow(!showLow)}
              className="text-xs"
            >
              {showLow ? 'Hide Low-Conf' : 'Show Low-Conf'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => pan(-1)}>◀</Button>
          <Button size="sm" variant="outline" onClick={zoomIn}>+</Button>
          <Button size="sm" variant="outline" onClick={zoomOut}>−</Button>
          <Button size="sm" variant="outline" onClick={() => setViewRange(null)}>Reset</Button>
          <Button size="sm" variant="outline" onClick={() => pan(1)}>▶</Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Run toggle pills */}
        <div className="flex items-center gap-2 px-4 py-2 border-b">
          <span className="text-xs text-muted-foreground mr-1">Runs:</span>
          {runs.map(run => {
            const active = visRunIds.has(run.runId);
            const c = RUN_COLORS[run.runIndex % RUN_COLORS.length];
            return (
              <button
                key={run.runId}
                onClick={() => toggleRun(run.runId)}
                className="text-xs px-2 py-0.5 rounded-full border transition-all"
                style={{
                  backgroundColor: active ? c : 'transparent',
                  color: active ? '#fff' : c,
                  borderColor: c,
                  opacity: active ? 1 : 0.4,
                }}
              >
                {run.year} {run.isBaseline ? '(Baseline)' : ''}
              </button>
            );
          })}
        </div>

        {/* Three.js Canvas */}
        <div style={{ height: 500, position: 'relative', background: '#0d0d0d' }}>
          <Canvas
            camera={{ fov: 50, near: 0.01, far: 200 }}
            gl={{ antialias: true, alpha: false }}
            style={{ background: '#0d0d0d' }}
          >
            <SceneContent
              groups={groups}
              viewRange={range}
              distanceScale={scale}
              onHover={setHoverInfo}
              onUnhover={handleUnhover}
              onSelect={handleSelect}
              hoveredInfo={hoverInfo}
            />
          </Canvas>

          {/* HTML tooltip overlay */}
          <HtmlTooltip info={hoverInfo} />

          {/* Bottom-left info overlay */}
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              background: 'rgba(0,0,0,0.7)',
              color: '#aaa',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 10,
              lineHeight: 1.4,
              pointerEvents: 'none',
            }}
          >
            <div>Drag to rotate · Scroll to zoom · Right-drag to pan</div>
            <div>
              Viewing: {range.min.toFixed(0)}–{range.max.toFixed(0)} ft
              ({(range.max - range.min).toFixed(0)} ft range)
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}