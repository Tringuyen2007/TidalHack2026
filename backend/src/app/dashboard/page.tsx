import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Dataset, AlignmentJob } from '@/lib/db/models';
import { SummaryCards } from '@/components/dashboard/SummaryCards';
import { RecentJobsTable } from '@/components/dashboard/RecentJobsTable';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login');
  }

  await connectToDatabase();

  const [datasets, jobs] = await Promise.all([
    Dataset.find({ org_id: session.user.orgId }).lean(),
    AlignmentJob.find({ org_id: session.user.orgId }).sort({ createdAt: -1 }).limit(20).lean()
  ]);

  const completed = jobs.filter((job) => job.status === 'COMPLETED').length;
  const avgConfidence =
    jobs.length > 0
      ? jobs.reduce((acc, job) => acc + Number((job.result_summary as { high_confidence?: number })?.high_confidence ?? 0), 0) /
        jobs.length
      : 0;

  return (
    <div className="space-y-5">
      <SummaryCards datasets={datasets.length} jobs={jobs.length} completed={completed} avgConfidence={avgConfidence} />
      <RecentJobsTable jobs={jobs as unknown as Array<Record<string, unknown>>} />
    </div>
  );
}
