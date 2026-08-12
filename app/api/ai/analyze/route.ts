import { NextResponse } from 'next/server';
import { ensureSchema, exec, rows } from '@/lib/db';
import { analyzeVerification, aiConfigured, aiModel } from '@/lib/ai-analyzer';
import type { RowDataPacket } from 'mysql2/promise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HistoryRow = RowDataPacket & { id:number; email:string; verdict:string; score:number; provider:string|null; smtp_code:number|null; smtp_state:string|null; result:any; created_at:string };

export async function POST(request: Request) {
  try {
    if (!aiConfigured()) return NextResponse.json({ error: 'AI is not configured. Add OPENAI_API_KEY to .env.local.' }, { status: 503 });
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 320) return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 });
    await ensureSchema();
    const history = await rows<HistoryRow>(`SELECT id,email,verdict,score,provider,smtp_code,smtp_state,result,created_at FROM email_verification_history WHERE email=? ORDER BY id DESC LIMIT 8`, [email]);
    if (!history.length) return NextResponse.json({ error: 'Verify this address first so AI has SMTP evidence to analyze.' }, { status: 404 });
    const latestResult = typeof history[0].result === 'string' ? JSON.parse(history[0].result) : history[0].result;
    const analysis = await analyzeVerification(latestResult, history);
    await exec(`INSERT INTO ai_analysis_history (analysis_type,subject_key,model,input_ref,output_json) VALUES(?,?,?,?,?)`, ['email', email, aiModel(), String(history[0].id), JSON.stringify(analysis)]);
    return NextResponse.json({ model: aiModel(), analysis });
  } catch (error) {
    console.error('AI analyze error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AI analysis failed.' }, { status: 500 });
  }
}
