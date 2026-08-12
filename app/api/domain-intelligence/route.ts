import { NextResponse } from 'next/server';
import { inspectDomain } from '@/lib/domain-intelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const domain = String(body.domain || '').trim().toLowerCase().replace(/^https?:\/\//,'').split('/')[0];
  if (!domain || !domain.includes('.')) return NextResponse.json({ error: 'Enter a valid domain.' }, { status: 400 });
  return NextResponse.json(await inspectDomain(domain));
}
