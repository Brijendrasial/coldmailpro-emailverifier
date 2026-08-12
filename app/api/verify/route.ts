import { NextResponse } from 'next/server';
import { verifyEmail } from '@/lib/verifier';
import { ensureSchema, exec } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const buckets = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 20;
const WINDOW = 60_000;

function getIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'local';
}

function rateLimited(ip: string) {
  const now = Date.now();
  const current = buckets.get(ip);
  if (!current || current.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW });
    return false;
  }
  current.count += 1;
  return current.count > LIMIT;
}

export async function POST(request: Request) {
  const ip = getIp(request);
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in about a minute.' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const ignoreSMTP = typeof body.ignoreSMTP === 'boolean' ? body.ignoreSMTP : undefined;

    if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    if (email.length > 320) return NextResponse.json({ error: 'Email is too long.' }, { status: 400 });

    const result = await verifyEmail(email, ignoreSMTP);
    await ensureSchema();
    await exec(
      `INSERT INTO email_verification_history
       (email,domain,verdict,score,provider,smtp_code,smtp_state,result)
       VALUES(?,?,?,?,?,?,?,?)`,
      [
        result.email,
        result.domain,
        result.verdict,
        result.score,
        result.provider ?? null,
        result.smtpDiagnostics?.rcptCode ?? null,
        result.smtpDiagnostics?.classification?.disposition ?? null,
        JSON.stringify(result),
      ]
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Verify API error:', error);
    return NextResponse.json({ error: 'Invalid request or verification failed.' }, { status: 400 });
  }
}
