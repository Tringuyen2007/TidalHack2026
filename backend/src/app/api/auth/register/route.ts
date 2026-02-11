import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Org, User } from '@/lib/db/models';
import { rateLimit } from '@/lib/rate-limit';
import type { NextRequest } from 'next/server';

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  orgName: z.string().min(2)
});

export async function POST(request: NextRequest) {
  // Basic rate limiting: 5 requests per minute per IP
  if (!rateLimit(request, 'register')) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const json = await request.json();
    const data = schema.parse(json);

    await connectToDatabase();

    const existing = await User.findOne({ email: data.email.toLowerCase() });
    if (existing) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    let org = await Org.findOne({ name: data.orgName.trim() });
    if (!org) {
      org = await Org.create({ name: data.orgName.trim() });
    }

    const password_hash = await bcrypt.hash(data.password, 10);
    const user = await User.create({
      name: data.name,
      email: data.email.toLowerCase(),
      password_hash,
      org_id: org._id
    });

    return NextResponse.json({ id: user._id.toString() }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
