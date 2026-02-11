import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { connectToDatabase } from '@/lib/db/mongoose';
import { AlignmentJob, MatchedPair } from '@/lib/db/models';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(200, Math.max(10, Number(searchParams.get('pageSize') ?? '100')));

  await connectToDatabase();
  const job = await AlignmentJob.findOne({ _id: id, org_id: session.user.orgId }).lean();
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const [rows, total] = await Promise.all([
    MatchedPair.find({ job_id: id })
      .sort({ confidence_score: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    MatchedPair.countDocuments({ job_id: id })
  ]);

  return NextResponse.json({ rows, total, page, pageSize });
}
