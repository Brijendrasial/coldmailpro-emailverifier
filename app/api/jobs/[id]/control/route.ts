import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ensureSchema, exec, rows } from '@/lib/db';
import { verificationQueue } from '@/lib/queue';

export const runtime = 'nodejs';

type ControlAction = 'pause' | 'resume' | 'cancel' | 'retry-unknown';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const action = body.action as ControlAction;

  await ensureSchema();

  if (action === 'pause') {
    await exec(
      `UPDATE verification_jobs SET status='paused' WHERE id=? AND status IN ('queued','running')`,
      [id]
    );
  } else if (action === 'resume') {
    await exec(`UPDATE verification_jobs SET status='running' WHERE id=? AND status='paused'`, [id]);
  } else if (action === 'cancel') {
    await exec(`UPDATE verification_jobs SET status='cancelled', completed_at=NOW(3) WHERE id=?`, [id]);
  } else if (action === 'retry-unknown') {
    const unknownRows = await rows<{ email: string } & import('mysql2').RowDataPacket>(
      `SELECT email FROM verification_results WHERE job_id=? AND verdict='unknown'`,
      [id]
    );
    const originalJobs = await rows<{ ignore_smtp: number } & import('mysql2').RowDataPacket>(
      `SELECT ignore_smtp FROM verification_jobs WHERE id=? LIMIT 1`,
      [id]
    );

    const emails = unknownRows.map(row => row.email);
    const ignoreSMTP = Boolean(originalJobs[0]?.ignore_smtp ?? 0);

    if (!emails.length) {
      return NextResponse.json({ ok: true, jobId: null, message: 'No unknown results to retry.' });
    }

    const retryId = randomUUID();
    await exec(
      `INSERT INTO verification_jobs(id,total,ignore_smtp) VALUES(?,?,?)`,
      [retryId, emails.length, Number(ignoreSMTP)]
    );
    await verificationQueue.add(
      'verify-list',
      { jobId: retryId, emails, ignoreSMTP },
      { jobId: retryId, attempts: 2, removeOnComplete: 100, removeOnFail: 100 }
    );

    return NextResponse.json({ ok: true, jobId: retryId });
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
