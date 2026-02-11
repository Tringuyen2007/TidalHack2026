import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/options';

export const runtime = 'nodejs';
export const maxDuration = 300;
import { connectToDatabase } from '@/lib/db/mongoose';
import { AlignmentJob, Dataset, AuditLog } from '@/lib/db/models';
import { enqueueAlignmentJob } from '@/lib/queue/alignment-queue';

const schema = z.object({ datasetId: z.string().min(1), enableMl: z.boolean().optional().default(false) });
type DatasetRecord = { _id: Types.ObjectId };

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
  }

  await connectToDatabase();

  const dataset = await Dataset.findOne({ _id: parsed.data.datasetId, org_id: session.user.orgId }).lean<DatasetRecord | null>();
  if (!dataset) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  }

  const stageStatus = [
    { stage: 1, name: 'Parse/ingest', status: 'PENDING' },
    { stage: 2, name: 'Normalize', status: 'PENDING' },
    { stage: 3, name: 'Anchor match', status: 'PENDING' },
    { stage: 4, name: 'Distance correction', status: 'PENDING' },
    { stage: 5, name: 'Anomaly matching', status: 'PENDING' },
    { stage: 6, name: 'Scoring', status: 'PENDING' },
    { stage: 7, name: 'Export', status: 'PENDING' }
  ];

  const job = await AlignmentJob.create({
    org_id: session.user.orgId,
    dataset_id: dataset._id,
    created_by: session.user.id,
    status: 'QUEUED',
    current_stage: 0,
    progress_pct: 0,
    stage_status: stageStatus,
    enable_ml: parsed.data.enableMl
  });

  await AuditLog.create({
    job_id: job._id,
    user_id: session.user.id,
    action: 'JOB_CREATED',
    entity: 'AlignmentJob',
    entity_id: job._id,
    payload: { datasetId: parsed.data.datasetId }
  });

  void enqueueAlignmentJob(job._id.toString()).catch(async (error) => {
    await AlignmentJob.updateOne(
      { _id: job._id },
      { status: 'FAILED', error: error instanceof Error ? error.message : 'Queue dispatch failed' }
    );
  });

  return NextResponse.json({ jobId: job._id.toString(), status: 'QUEUED' }, { status: 202 });
}
