import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { connectToDatabase } from '@/lib/db/mongoose';
import { AlignmentJob, Exception } from '@/lib/db/models';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  await connectToDatabase();
  const job = await AlignmentJob.findOne({ _id: id, org_id: session.user.orgId }).lean();
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const rows = await Exception.find({ job_id: id }).sort({ createdAt: -1 }).lean();

  return NextResponse.json({ rows });
}
