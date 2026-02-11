import { NextResponse } from 'next/server';
import { z } from 'zod';
import { canonicalizeWithGemini } from '@/lib/gemini/canonicalize';
import { requireSession } from '@/lib/auth/session';
import { rateLimit } from '@/lib/rate-limit';
import type { NextRequest } from 'next/server';

const schema = z.object({ eventType: z.string().min(1) });

export async function POST(request: NextRequest) {
  // Require authentication
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Basic rate limiting: 5 requests per minute per IP
  if (!rateLimit(request, 'gemini-canonicalize')) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const canonical = await canonicalizeWithGemini(parsed.data.eventType);
  return NextResponse.json({ canonical });
}
