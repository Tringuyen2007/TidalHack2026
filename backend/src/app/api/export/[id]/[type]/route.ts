import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { connectToDatabase } from '@/lib/db/mongoose';
import { AlignmentJob } from '@/lib/db/models';

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  matches: 'text/csv',
  exceptions: 'text/csv'
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, type: rawType } = await params;
  await connectToDatabase();
  const job = await AlignmentJob.findOne({ _id: id, org_id: session.user.orgId }).lean();
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const type = rawType.toLowerCase();
  const filename =
    type === 'xlsx' ? 'alignment-report.xlsx' : type === 'matches' ? 'matches.csv' : type === 'exceptions' ? 'exceptions.csv' : null;

  if (!filename) {
    return NextResponse.json({ error: 'Unsupported export type' }, { status: 400 });
  }

  const filePath = path.join('/tmp', 'ili-exports', id, filename);

  try {
    const file = await fs.readFile(filePath);
    return new NextResponse(file, {
      headers: {
        'Content-Type': MIME[type] ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename=\"${filename}\"`
      }
    });
  } catch {
    return NextResponse.json({ error: 'Export not ready. Run pipeline first.' }, { status: 404 });
  }
}
