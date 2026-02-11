import type { NextRequest } from 'next/server';

// Simple in-memory rate limiter (per IP, per route)
const rateLimitMap = new Map<string, { count: number; last: number }>();
const WINDOW = 60 * 1000; // 1 minute
const MAX = 5; // 5 requests per minute

export function rateLimit(req: NextRequest, key: string): boolean {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  const mapKey = `${key}:${ip}`;
  const now = Date.now();
  const entry = rateLimitMap.get(mapKey);
  if (entry && now - entry.last < WINDOW) {
    if (entry.count >= MAX) return false;
    entry.count++;
    entry.last = now;
    rateLimitMap.set(mapKey, entry);
    return true;
  }
  rateLimitMap.set(mapKey, { count: 1, last: now });
  return true;
}
