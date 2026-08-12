import { NextResponse } from 'next/server';
import { ensureSchema, rows } from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export const runtime='nodejs';
export const dynamic='force-dynamic';

type HistoryRow = RowDataPacket & {
  id:number;email:string;domain:string;verdict:string;score:number;provider:string|null;
  smtp_code:number|null;smtp_state:string|null;created_at:Date;result:unknown;
};

function parseResult(v:unknown){
  if(typeof v==='string'){try{return JSON.parse(v)}catch{return null}}
  return v;
}

export async function GET(request:Request){
  await ensureSchema();
  const url=new URL(request.url);
  const email=(url.searchParams.get('email')||'').trim().toLowerCase();
  if(!email)return NextResponse.json({error:'email is required'},{status:400});
  const history=await rows<HistoryRow>(
    `SELECT id,email,domain,verdict,score,provider,smtp_code,smtp_state,created_at,result
     FROM email_verification_history WHERE email=? ORDER BY id DESC LIMIT 12`,[email]
  );
  const items=history.map(h=>({...h,result:parseResult(h.result)}));
  const latest=items[0]||null, previous=items[1]||null;
  const changes:string[]=[];
  if(latest&&previous){
    if(latest.verdict!==previous.verdict)changes.push(`Verdict changed ${previous.verdict} → ${latest.verdict}`);
    if(Number(latest.score)!==Number(previous.score))changes.push(`Score changed ${previous.score} → ${latest.score}`);
    if(latest.provider!==previous.provider)changes.push(`Provider changed ${previous.provider||'Unknown'} → ${latest.provider||'Unknown'}`);
    if(latest.smtp_code!==previous.smtp_code)changes.push(`SMTP RCPT changed ${previous.smtp_code??'—'} → ${latest.smtp_code??'—'}`);
  }
  return NextResponse.json({email,items,comparison:{latest,previous,changes}});
}
