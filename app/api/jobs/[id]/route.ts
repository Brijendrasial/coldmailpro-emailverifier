import { NextResponse } from 'next/server';
import { ensureSchema, rows } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureSchema();

  const jobs = await rows(`SELECT * FROM verification_jobs WHERE id=? LIMIT 1`, [id]);
  if (!jobs.length) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const resultRows = await rows<{ result: string | object } & import('mysql2').RowDataPacket>(
    `SELECT result FROM verification_results WHERE job_id=? ORDER BY id ASC`,
    [id]
  );

  const results = resultRows.map(row => {
    if (typeof row.result === 'string') {
      try { return JSON.parse(row.result); } catch { return row.result; }
    }
    return row.result;
  });

  return NextResponse.json({ job: jobs[0], results });
}
