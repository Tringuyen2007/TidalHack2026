import type { AnchorPair, CorrectionSegment } from '../types';

export function buildCorrectionSegments(anchors: AnchorPair[]): CorrectionSegment[] {
  if (anchors.length === 0) {
    return [];
  }

  const sorted = [...anchors].sort((a, b) => a.olderDistance - b.olderDistance);
  const segments: CorrectionSegment[] = [];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];

    const offsetA = a.newerDistance - a.olderDistance;
    const offsetB = b.newerDistance - b.olderDistance;
    const dx = b.olderDistance - a.olderDistance || 1;
    const slope = (offsetB - offsetA) / dx;

    segments.push({
      segmentIndex: a.segmentIndex,
      x0: a.olderDistance,
      x1: b.olderDistance,
      offset0: offsetA,
      offset1: offsetB,
      slope
    });
  }

  return segments;
}

export function interpolateOffset(distanceFt: number, segments: CorrectionSegment[]): number {
  if (segments.length === 0 || !Number.isFinite(distanceFt)) {
    return 0;
  }

  const segment =
    segments.find((s) => distanceFt >= s.x0 && distanceFt <= s.x1) ||
    (distanceFt < segments[0].x0 ? segments[0] : segments[segments.length - 1]);

  const clamped = Math.min(Math.max(distanceFt, segment.x0), segment.x1);
  return segment.offset0 + (clamped - segment.x0) * segment.slope;
}
