import { clockCircularDistance } from './clock';

export type ScoreBreakdown = {
  distanceScore: number;
  clockScore: number;
  typeScore: number;
  dimensionalScore: number;
  total: number;
  clockResidual: number | null;
};

const TYPE_COMPATIBILITY: Record<string, string[]> = {
  METAL_LOSS: ['CLUSTER', 'METAL_LOSS_MFG'],
  CLUSTER: ['METAL_LOSS', 'METAL_LOSS_MFG'],
  METAL_LOSS_MFG: ['METAL_LOSS', 'CLUSTER'],
  BEND: ['FIELD_BEND'],
  FIELD_BEND: ['BEND']
};

function safeRatio(diff: number, max: number) {
  if (!Number.isFinite(diff) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.min(1, diff / max);
}

function typeCompatibility(a: string, b: string): number {
  if (a === b) return 1;
  if (TYPE_COMPATIBILITY[a]?.includes(b) || TYPE_COMPATIBILITY[b]?.includes(a)) {
    return 0.7;
  }
  return 0;
}

export function calculateScore(args: {
  distanceResidualFt: number;
  olderClock: number | null | undefined;
  newerClock: number | null | undefined;
  olderType: string;
  newerType: string;
  olderDepthIn?: number | null;
  newerDepthIn?: number | null;
  olderLengthIn?: number | null;
  newerLengthIn?: number | null;
  olderWidthIn?: number | null;
  newerWidthIn?: number | null;
}): ScoreBreakdown {
  const distanceScore = Math.max(0, 1 - Math.abs(args.distanceResidualFt) / 3.0);

  const clockResidual = clockCircularDistance(args.olderClock, args.newerClock);
  const clockScore = clockResidual == null ? 0 : Math.max(0, 1 - clockResidual / 1.0);
  const clockWeight = clockResidual == null ? 0 : 0.25;

  const typeScore = typeCompatibility(args.olderType, args.newerType);

  const maxDepth = Math.max(args.olderDepthIn ?? 0, args.newerDepthIn ?? 0, 0.0001);
  const maxLength = Math.max(args.olderLengthIn ?? 0, args.newerLengthIn ?? 0, 0.0001);
  const maxWidth = Math.max(args.olderWidthIn ?? 0, args.newerWidthIn ?? 0, 0.0001);

  const depthRatio = safeRatio(Math.abs((args.newerDepthIn ?? 0) - (args.olderDepthIn ?? 0)), maxDepth);
  const lengthRatio = safeRatio(Math.abs((args.newerLengthIn ?? 0) - (args.olderLengthIn ?? 0)), maxLength);
  const widthRatio = safeRatio(Math.abs((args.newerWidthIn ?? 0) - (args.olderWidthIn ?? 0)), maxWidth);

  const dimensionalScore = Math.max(0, 1 - (depthRatio + lengthRatio + widthRatio) / 3);

  const weightTotal = 0.35 + clockWeight + 0.2 + 0.2;
  const total =
    ((0.35 * distanceScore + clockWeight * clockScore + 0.2 * typeScore + 0.2 * dimensionalScore) / weightTotal) *
    100;

  return {
    distanceScore,
    clockScore,
    typeScore,
    dimensionalScore,
    total,
    clockResidual
  };
}

export function confidenceCategory(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}
