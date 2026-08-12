import { NextResponse } from 'next/server';
import { ensureSchema, exec, rows } from '@/lib/db';
import { diagnoseBulk, aiConfigured, aiModel } from '@/lib/ai-analyzer';
import type { RowDataPacket } from 'mysql2/promise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type AnyRow = RowDataPacket & Record<string, any>;

export async function POST(request: Request) {
  try {
    if (!aiConfigured()) return NextResponse.json({ error: 'AI is not configured. Add OPENAI_API_KEY to .env.local.' }, { status: 503 });
    const body = await request.json();
    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
    if (!jobId) return NextResponse.json({ error: 'jobId is required.' }, { status: 400 });
    await ensureSchema();
    const jobs = await rows<AnyRow>(`SELECT * FROM verification_jobs WHERE id=? LIMIT 1`, [jobId]);
    if (!jobs.length) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    const providerStats = await rows<AnyRow>(`SELECT COALESCE(provider,'Unknown') provider, verdict, COUNT(*) count FROM verification_results WHERE job_id=? GROUP BY provider,verdict ORDER BY count DESC LIMIT 30`, [jobId]);
    const samples = await rows<AnyRow>(`SELECT email,verdict,score,provider,result FROM verification_results WHERE job_id=? AND verdict IN ('unknown','risky','undeliverable') ORDER BY id DESC LIMIT 25`, [jobId]);
    const compactSamples = samples.map(x=>{let r:any=x.result; if(typeof r==='string'){try{r=JSON.parse(r)}catch{r={}}} return {email:x.email,verdict:x.verdict,score:x.score,provider:x.provider,smtpCode:r?.smtpDiagnostics?.rcptCode??null,smtpState:r?.smtpDiagnostics?.classification?.disposition??null,smtpMessage:String(r?.smtpMessage||'').slice(0,500),temporaryFailure:Boolean(r?.temporaryFailure),catchAllStatus:r?.catchAllStatus};});
    const diagnosis = await diagnoseBulk({job:jobs[0],providerStats,samples:compactSamples});
    await exec(`INSERT INTO ai_analysis_history (analysis_type,subject_key,model,input_ref,output_json) VALUES(?,?,?,?,?)`, ['bulk', jobId, aiModel(), jobId, JSON.stringify(diagnosis)]);
    return NextResponse.json({ model: aiModel(), diagnosis });
  } catch (error) {
    console.error('AI bulk diagnosis error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AI bulk diagnosis failed.' }, { status: 500 });
  }
}
