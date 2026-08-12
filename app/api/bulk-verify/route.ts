import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ensureSchema, exec } from '@/lib/db';
import { verificationQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_EMAILS = Math.max(1, Math.min(100000, Number(process.env.BULK_MAX_EMAILS || 10000)));

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const emails: unknown[] = Array.isArray(body.emails) ? body.emails : [];
    const ignoreSMTP = typeof body.ignoreSMTP === 'boolean' ? body.ignoreSMTP : false;
    const clean = [...new Set(
      emails
        .filter((x): x is string => typeof x === 'string')
        .map(x => x.trim().toLowerCase())
        .filter(Boolean)
    )].slice(0, MAX_EMAILS);

    if (!clean.length) {
      return NextResponse.json({ error: 'Add at least one email.' }, { status: 400 });
    }

    await ensureSchema();
    const jobId = randomUUID();

    await exec(
      `INSERT INTO verification_jobs(id,total,ignore_smtp) VALUES(?,?,?)`,
      [jobId, clean.length, Number(ignoreSMTP)]
    );

    await verificationQueue.add(
      'verify-list',
      { jobId, emails: clean, ignoreSMTP },
      { jobId, attempts: 2, removeOnComplete: 100, removeOnFail: 100 }
    );

    return NextResponse.json({ jobId, total: clean.length, status: 'queued' });
  } catch (error) {
    console.error('Bulk verification enqueue error:', error);
    return NextResponse.json(
      { error: 'Could not create verification job. Check MySQL and Redis.' },
      { status: 500 }
    );
  }
}
