import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Types } from 'mongoose';
import { authOptions } from '@/lib/auth/options';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Dataset, Run } from '@/lib/db/models';

type DatasetWithRuns = {
  _id: Types.ObjectId;
  run_ids: Types.ObjectId[];
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  await connectToDatabase();

  const dataset = await Dataset.findOne({ _id: id, org_id: session.user.orgId }).lean<DatasetWithRuns | null>();
  if (!dataset) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  }

  const runs = await Run.find({ _id: { $in: dataset.run_ids } }).sort({ year: 1 }).lean();

  return NextResponse.json({ dataset, runs });
}
