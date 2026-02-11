import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Dataset, Run } from '@/lib/db/models';
import { parseDatasetFile } from '@/lib/pipeline/01-ingest';
import { normalizeAndPersistRuns } from '@/lib/pipeline/02-normalize';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectToDatabase();

  const datasets = await Dataset.find({ org_id: session.user.orgId }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ datasets });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File exceeds 50 MB limit' }, { status: 413 });
    }

    await connectToDatabase();

    const bytes = Buffer.from(await file.arrayBuffer());
    const parsedRuns = parseDatasetFile(bytes, file.name);
    if (parsedRuns.length === 0) {
      return NextResponse.json({ error: 'No run sheets found — workbook must have sheets named by year (e.g. 2007, 2015, 2022)' }, { status: 400 });
    }

    const dataset = await Dataset.create({
      org_id: session.user.orgId,
      uploaded_by: session.user.id,
      name: (form.get('name') as string) || file.name.replace(/\.[^.]+$/, ''),
      source_filename: file.name,
      metadata: {
        run_years: parsedRuns.map((run) => run.year),
        uploaded_at: new Date().toISOString()
      }
    });

    const persisted = await normalizeAndPersistRuns({
      datasetId: dataset._id.toString(),
      orgId: session.user.orgId,
      runs: parsedRuns
    });

    const runs = await Run.find({ _id: { $in: persisted.runIds } }).sort({ year: 1 }).lean();

    return NextResponse.json({
      datasetId: dataset._id,
      runs,
      totalFeatures: persisted.totalFeatures
    });
  } catch (err) {
    console.error('[datasets/POST]', err);
    const message = err instanceof Error ? err.message : 'Upload processing failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
