import { NextResponse } from 'next/server';
import { ensureSchema, rows } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureSchema();
  const jobs = await rows(`SELECT * FROM verification_jobs ORDER BY created_at DESC LIMIT 25`);
  return NextResponse.json({ jobs });
}
