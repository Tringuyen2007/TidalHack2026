import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { connectToDatabase } from '@/lib/db/mongoose';
import { AlignmentJob } from '@/lib/db/models';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectToDatabase();

  const jobs = await AlignmentJob.find({ org_id: session.user.orgId }).sort({ createdAt: -1 }).limit(20).lean();
  return NextResponse.json({ jobs });
}
