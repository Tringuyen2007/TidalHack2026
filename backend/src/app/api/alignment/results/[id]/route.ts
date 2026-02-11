import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { connectToDatabase } from '@/lib/db/mongoose';
import { AlignmentJob, MatchedPair, Exception, AuditLog } from '@/lib/db/models';

type AlignmentJobSummaryRecord = {
  result_summary?: Record<string, unknown>;
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  await connectToDatabase();

  const job = await AlignmentJob.findOne({ _id: id, org_id: session.user.orgId }).lean<AlignmentJobSummaryRecord | null>();
  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [totalMatches, totalExceptions, high, medium, low,
    immediateCount, scheduledCount, monitoringCount,
    acceleratingGrowth, interactionZoneCount, mlAuditDoc] = await Promise.all([
    MatchedPair.countDocuments({ job_id: id }),
    Exception.countDocuments({ job_id: id }),
    MatchedPair.countDocuments({ job_id: id, confidence_category: 'HIGH' }),
    MatchedPair.countDocuments({ job_id: id, confidence_category: 'MEDIUM' }),
    MatchedPair.countDocuments({ job_id: id, confidence_category: 'LOW' }),
    MatchedPair.countDocuments({ job_id: id, 'standards_applied.asme_b31_8s.severity_level': 'IMMEDIATE' }),
    MatchedPair.countDocuments({ job_id: id, 'standards_applied.asme_b31_8s.severity_level': 'SCHEDULED' }),
    MatchedPair.countDocuments({ job_id: id, 'standards_applied.asme_b31_8s.severity_level': 'MONITORING' }),
    MatchedPair.countDocuments({ job_id: id, 'standards_applied.nace_sp0502.corrosion_class': 'accelerating' }),
    MatchedPair.countDocuments({ job_id: id, 'standards_applied.asme_b31_8s.interaction_zone': true }),
    AuditLog.findOne({ job_id: id, action: 'ML_HOOKS_STATUS' }).sort({ _id: -1 }).lean() as Promise<{ payload?: Record<string, unknown> } | null>,
  ]);

  // Extract ML sidecar status from audit log
  const mlPayload = mlAuditDoc?.payload as { providerName?: string; pairsScored?: number; growthsAssessed?: number; subgraphsScored?: number; errors?: number } | undefined;
  const mlSidecar = mlPayload ? {
    active: mlPayload.providerName !== 'no-op',
    pairsScored: mlPayload.pairsScored ?? 0,
    growthsAssessed: mlPayload.growthsAssessed ?? 0,
    clustersFound: mlPayload.subgraphsScored ?? 0,
    errors: mlPayload.errors ?? 0,
  } : undefined;

  return NextResponse.json({
    summary: {
      ...job.result_summary,
      totalMatches,
      totalExceptions,
      confidence: { high, medium, low },
      standards: {
        severity: { immediate: immediateCount, scheduled: scheduledCount, monitoring: monitoringCount },
        acceleratingGrowth,
        interactionZones: interactionZoneCount,
      },
      mlSidecar,
    }
  });
}
