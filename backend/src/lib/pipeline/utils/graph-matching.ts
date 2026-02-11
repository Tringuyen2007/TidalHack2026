/**
 * Graph-Based Anomaly Interaction Analysis
 *
 * ───────────────────────────────────────────────────────────────────
 * Purpose:
 *
 *   Graph structures allow us to reason about anomaly interactions
 *   beyond pairwise matching. They capture:
 *
 *     - Spatial proximity clusters (anomalies near each other)
 *     - Interaction zones per ASME B31.8S interaction rules
 *     - Merge / split behavior across runs
 *     - Temporal continuity chains (same anomaly across 3+ runs)
 *
 * ───────────────────────────────────────────────────────────────────
 * Architecture:
 *
 *   Nodes = individual anomaly features
 *   Edges = relationships typed by:
 *     - SPATIAL_PROXIMITY: features within interaction distance
 *     - MATCH_LINK: features matched across runs
 *     - TEMPORAL_CHAIN: same anomaly tracked across 3+ runs
 *     - INTERACTION_ZONE: ASME B31.8S interaction candidate
 *
 *   No graph neural networks are used.
 *   Graphs support standards-based reasoning (ASME B31.8S).
 *   All operations are deterministic.
 *
 * ───────────────────────────────────────────────────────────────────
 * ASME B31.8S Interaction Rules (§A-4.3):
 *
 *   Two anomalies interact if their separation is less than:
 *     - Axial: 3 × wall_thickness OR 1 × length (whichever less)
 *     - Circumferential: 3 × wall_thickness OR 1 × width
 *   When anomalies interact, they must be assessed as a combined
 *   feature for burst pressure calculations.
 *
 * ───────────────────────────────────────────────────────────────────
 * References:
 *
 *   - ASME B31.8S-2018 §A-4.3 — Interaction rules
 *   - API 1163 §4 — Feature reporting and clustering guidelines
 *   - NACE SP0502 §7 — External corrosion assessment methodology
 */

import { clockCircularDistance } from './clock';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type GraphNode = {
  id: string;
  runId: string;
  runYear: number;
  type: string;
  distance: number;
  clock: number | null;
  depthPercent: number | null;
  depthIn: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  wallThicknessIn: number | null;
};

export type EdgeType =
  | 'SPATIAL_PROXIMITY'
  | 'MATCH_LINK'
  | 'TEMPORAL_CHAIN'
  | 'INTERACTION_ZONE';

export type GraphEdge = {
  sourceId: string;
  targetId: string;
  type: EdgeType;
  weight: number;
  metadata: Record<string, unknown>;
};

export type InteractionCluster = {
  clusterId: string;
  featureIds: string[];
  runId: string;
  interactionType: 'AXIAL' | 'CIRCUMFERENTIAL' | 'COMBINED';
  /** Combined effective length for burst pressure calculation */
  combinedLengthIn: number;
  /** Combined effective depth (max of interacting features) */
  combinedDepthPercent: number;
  /** ASME B31.8S interaction rule applied */
  standardRef: string;
  /** Distance span of the cluster */
  distanceSpanFt: number;
  /** All edges in this cluster */
  edges: GraphEdge[];
};

export type TemporalChain = {
  chainId: string;
  /** Feature IDs ordered from oldest to newest run */
  featureIds: string[];
  runYears: number[];
  /** Growth rate if computable */
  depthGrowthPctYr: number | null;
  lengthGrowthInYr: number | null;
  confidence: number;
};

export type GraphAnalysisResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  interactionClusters: InteractionCluster[];
  temporalChains: TemporalChain[];
  /** Summary stats */
  totalNodes: number;
  totalEdges: number;
  totalClusters: number;
  totalChains: number;
  /** Features involved in interaction zones (need combined assessment) */
  interactingFeatureIds: string[];
};

// ──────────────────────────────────────────────────────────────────────
// ASME B31.8S Interaction Distance
// ──────────────────────────────────────────────────────────────────────

/**
 * Compute ASME B31.8S interaction threshold distance.
 *
 * Per §A-4.3: Two corrosion anomalies interact if separation
 * is less than min(3t, L) axially or min(3t, W) circumferentially,
 * where t = wall thickness, L = anomaly length, W = anomaly width.
 *
 * Default wall thickness: 0.25 inches (conservative for typical pipeline).
 */
function interactionThresholdFt(
  wallThickness: number | null,
  anomalyDimension: number | null,
): number {
  const t = wallThickness ?? 0.25; // inches
  const dim = anomalyDimension ?? t * 3; // inches
  const thresholdIn = Math.min(3 * t, dim);
  return thresholdIn / 12; // convert to feet
}

/**
 * Check if two features interact per ASME B31.8S §A-4.3.
 * Returns the interaction type or null if no interaction.
 */
function checkInteraction(
  a: GraphNode,
  b: GraphNode,
): { type: 'AXIAL' | 'CIRCUMFERENTIAL' | 'COMBINED'; axialSep: number; circSep: number } | null {
  // Only corrosion-type features interact
  const CORROSION_TYPES = new Set(['METAL_LOSS', 'CLUSTER', 'METAL_LOSS_MFG']);
  if (!CORROSION_TYPES.has(a.type) || !CORROSION_TYPES.has(b.type)) return null;
  if (a.runId !== b.runId) return null; // Interaction is within a single run

  const axialSep = Math.abs(a.distance - b.distance);
  const wt = a.wallThicknessIn ?? b.wallThicknessIn;
  const axialThreshold = interactionThresholdFt(wt, Math.min(a.lengthIn ?? 999, b.lengthIn ?? 999));

  const axialInteracts = axialSep <= axialThreshold;

  // Circumferential check (clock-based)
  const clockDist = clockCircularDistance(a.clock, b.clock);
  let circInteracts = false;
  if (clockDist != null) {
    // Convert clock-hours to approximate circumferential inches
    // For ~30" OD pipe: circumference ≈ 94", so 1 clock-hour = 94/12 ≈ 7.85"
    const circSepIn = clockDist * 7.85;
    const circThresholdIn = Math.min(3 * (wt ?? 0.25), Math.min(a.widthIn ?? 999, b.widthIn ?? 999));
    circInteracts = circSepIn <= circThresholdIn;
  }

  if (axialInteracts && circInteracts) {
    return { type: 'COMBINED', axialSep, circSep: clockDist ?? 0 };
  }
  if (axialInteracts) {
    return { type: 'AXIAL', axialSep, circSep: clockDist ?? 0 };
  }
  if (circInteracts) {
    return { type: 'CIRCUMFERENTIAL', axialSep, circSep: clockDist ?? 0 };
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Graph Construction
// ──────────────────────────────────────────────────────────────────────

/**
 * Build the anomaly interaction graph.
 *
 * @param nodes — all anomaly features across all runs
 * @param matchLinks — matched pairs (from Hungarian assignment)
 * @param spatialProximityFt — max distance for spatial proximity edges (default 10ft)
 */
export function buildInteractionGraph(
  nodes: GraphNode[],
  matchLinks: Array<{ sourceId: string; targetId: string; score: number }>,
  spatialProximityFt = 10,
): GraphAnalysisResult {
  const edges: GraphEdge[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // ── 1. Match link edges (from existing Hungarian matches) ──
  for (const link of matchLinks) {
    edges.push({
      sourceId: link.sourceId,
      targetId: link.targetId,
      type: 'MATCH_LINK',
      weight: link.score / 100,
      metadata: { score: link.score },
    });
  }

  // ── 2. Spatial proximity + ASME B31.8S interaction edges ──
  // Group nodes by run for within-run interaction checks
  const byRun = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = byRun.get(node.runId) ?? [];
    list.push(node);
    byRun.set(node.runId, list);
  }

  for (const [, runNodes] of byRun) {
    // Sort by distance for efficient windowed comparison
    const sorted = [...runNodes].sort((a, b) => a.distance - b.distance);

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const distSep = sorted[j].distance - sorted[i].distance;
        if (distSep > spatialProximityFt) break; // No more proximate features

        // Spatial proximity edge
        edges.push({
          sourceId: sorted[i].id,
          targetId: sorted[j].id,
          type: 'SPATIAL_PROXIMITY',
          weight: 1 - distSep / spatialProximityFt,
          metadata: { separationFt: distSep },
        });

        // ASME B31.8S interaction check
        const interaction = checkInteraction(sorted[i], sorted[j]);
        if (interaction) {
          edges.push({
            sourceId: sorted[i].id,
            targetId: sorted[j].id,
            type: 'INTERACTION_ZONE',
            weight: 1,
            metadata: {
              interactionType: interaction.type,
              axialSeparationFt: interaction.axialSep,
              circumferentialSeparationHrs: interaction.circSep,
              standardRef: 'ASME B31.8S §A-4.3',
            },
          });
        }
      }
    }
  }

  // ── 3. Temporal chains (same anomaly across 3+ runs) ──
  const temporalChains = buildTemporalChains(nodes, matchLinks);

  // For temporal chain edges
  for (const chain of temporalChains) {
    for (let i = 0; i < chain.featureIds.length - 1; i++) {
      const existing = edges.find(
        e => e.sourceId === chain.featureIds[i] && e.targetId === chain.featureIds[i + 1] && e.type === 'MATCH_LINK'
      );
      if (!existing) {
        edges.push({
          sourceId: chain.featureIds[i],
          targetId: chain.featureIds[i + 1],
          type: 'TEMPORAL_CHAIN',
          weight: chain.confidence / 100,
          metadata: { chainId: chain.chainId },
        });
      }
    }
  }

  // ── 4. Extract interaction clusters ──
  const interactionClusters = extractInteractionClusters(nodes, edges, nodeMap);

  const interactingFeatureIds = new Set<string>();
  for (const cluster of interactionClusters) {
    for (const fid of cluster.featureIds) {
      interactingFeatureIds.add(fid);
    }
  }

  return {
    nodes,
    edges,
    interactionClusters,
    temporalChains,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    totalClusters: interactionClusters.length,
    totalChains: temporalChains.length,
    interactingFeatureIds: [...interactingFeatureIds],
  };
}

// ──────────────────────────────────────────────────────────────────────
// Temporal Chains
// ──────────────────────────────────────────────────────────────────────

function buildTemporalChains(
  nodes: GraphNode[],
  matchLinks: Array<{ sourceId: string; targetId: string; score: number }>,
): TemporalChain[] {
  // Build adjacency list from match links
  const adj = new Map<string, string[]>();
  for (const link of matchLinks) {
    const list = adj.get(link.sourceId) ?? [];
    list.push(link.targetId);
    adj.set(link.sourceId, list);
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set<string>();
  const chains: TemporalChain[] = [];
  let chainCounter = 0;

  // Find chains by following match links forward
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    if (!adj.has(node.id)) continue;

    // Trace forward
    const chain: string[] = [node.id];
    let current = node.id;
    visited.add(current);

    while (adj.has(current)) {
      const next = adj.get(current)!.find(id => !visited.has(id));
      if (!next) break;
      chain.push(next);
      visited.add(next);
      current = next;
    }

    if (chain.length >= 3) {
      const chainNodes = chain.map(id => nodeMap.get(id)).filter(Boolean) as GraphNode[];
      const years = chainNodes.map(n => n.runYear).sort((a, b) => a - b);

      // Compute growth rate from first to last
      const first = chainNodes[0];
      const last = chainNodes[chainNodes.length - 1];
      const yearSpan = last.runYear - first.runYear;

      const depthGrowth = (first.depthPercent != null && last.depthPercent != null && yearSpan > 0)
        ? (last.depthPercent - first.depthPercent) / yearSpan
        : null;

      const lengthGrowth = (first.lengthIn != null && last.lengthIn != null && yearSpan > 0)
        ? (last.lengthIn - first.lengthIn) / yearSpan
        : null;

      // Confidence: based on chain length and coverage
      const confidence = Math.min(100, 50 + chain.length * 15);

      chains.push({
        chainId: `chain-${++chainCounter}`,
        featureIds: chain,
        runYears: years,
        depthGrowthPctYr: depthGrowth,
        lengthGrowthInYr: lengthGrowth,
        confidence,
      });
    }
  }

  return chains;
}

// ──────────────────────────────────────────────────────────────────────
// Interaction Cluster Extraction (Union-Find)
// ──────────────────────────────────────────────────────────────────────

function extractInteractionClusters(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeMap: Map<string, GraphNode>,
): InteractionCluster[] {
  // Union-find for connected components of INTERACTION_ZONE edges
  const interactionEdges = edges.filter(e => e.type === 'INTERACTION_ZONE');
  if (interactionEdges.length === 0) return [];

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  for (const edge of interactionEdges) {
    union(edge.sourceId, edge.targetId);
  }

  // Group by root
  const groups = new Map<string, { featureIds: Set<string>; edges: GraphEdge[] }>();
  for (const edge of interactionEdges) {
    const root = find(edge.sourceId);
    const group = groups.get(root) ?? { featureIds: new Set(), edges: [] };
    group.featureIds.add(edge.sourceId);
    group.featureIds.add(edge.targetId);
    group.edges.push(edge);
    groups.set(root, group);
  }

  const clusters: InteractionCluster[] = [];
  let clusterCounter = 0;

  for (const [, group] of groups) {
    const ids = [...group.featureIds];
    const features = ids.map(id => nodeMap.get(id)).filter(Boolean) as GraphNode[];

    if (features.length < 2) continue;

    // Determine interaction type from edges
    const types = new Set(group.edges.map(e => e.metadata.interactionType as string));
    const interactionType = types.has('COMBINED') ? 'COMBINED'
      : types.has('CIRCUMFERENTIAL') ? 'CIRCUMFERENTIAL'
      : 'AXIAL';

    // Combined dimensions per ASME B31.8S
    const distances = features.map(f => f.distance);
    const distanceSpanFt = Math.max(...distances) - Math.min(...distances);

    // Combined length: span from leading edge to trailing edge
    const combinedLengthIn = features.reduce((sum, f) => sum + (f.lengthIn ?? 0), 0)
      + distanceSpanFt * 12; // Add gap between features

    // Combined depth: maximum of all interacting features
    const combinedDepthPercent = Math.max(...features.map(f => f.depthPercent ?? 0));

    clusters.push({
      clusterId: `interaction-${++clusterCounter}`,
      featureIds: ids,
      runId: features[0].runId,
      interactionType: interactionType as 'AXIAL' | 'CIRCUMFERENTIAL' | 'COMBINED',
      combinedLengthIn,
      combinedDepthPercent,
      standardRef: 'ASME B31.8S §A-4.3',
      distanceSpanFt,
      edges: group.edges,
    });
  }

  return clusters;
}

// ──────────────────────────────────────────────────────────────────────
// Graph Audit Record
// ──────────────────────────────────────────────────────────────────────

export type GraphAuditPayload = {
  algorithm: 'GRAPH_ANALYSIS';
  totalNodes: number;
  totalEdges: number;
  edgesByType: Record<string, number>;
  interactionClusters: number;
  temporalChains: number;
  interactingFeatures: number;
  standardsApplied: string[];
};

export function buildGraphAudit(result: GraphAnalysisResult): GraphAuditPayload {
  const edgesByType: Record<string, number> = {};
  for (const edge of result.edges) {
    edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
  }

  return {
    algorithm: 'GRAPH_ANALYSIS',
    totalNodes: result.totalNodes,
    totalEdges: result.totalEdges,
    edgesByType,
    interactionClusters: result.totalClusters,
    temporalChains: result.totalChains,
    interactingFeatures: result.interactingFeatureIds.length,
    standardsApplied: ['ASME B31.8S §A-4.3', 'API 1163 §4'],
  };
}
