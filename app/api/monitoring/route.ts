import { NextResponse } from 'next/server';
import { ensureSchema, exec, rows } from '@/lib/db';
import { buildDomainSnapshot, snapshotHash, summarizeChanges, type DomainMonitorSnapshot } from '@/lib/domain-monitoring';
import type { RowDataPacket } from 'mysql2';

export const runtime='nodejs'; export const dynamic='force-dynamic';
function cleanDomain(v:string){return v.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'')}
function parseSnapshot(v:unknown):DomainMonitorSnapshot|null{if(!v)return null;try{return typeof v==='string'?JSON.parse(v):v as DomainMonitorSnapshot}catch{return null}}

export async function GET(){
  await ensureSchema();
  const domains=await rows<(RowDataPacket & {id:number;domain:string;enabled:number;interval_minutes:number;last_check_at:Date|null;last_change_at:Date|null;next_check_at:Date;last_hash:string|null})>(`SELECT * FROM monitored_domains ORDER BY created_at DESC LIMIT 200`);
  const out=[];
  for(const d of domains){const snaps=await rows<(RowDataPacket & {id:number;changed:number;change_summary:string|null;snapshot:unknown;created_at:Date})>(`SELECT id,changed,change_summary,snapshot,created_at FROM domain_monitor_snapshots WHERE domain_id=? ORDER BY id DESC LIMIT 5`,[d.id]);out.push({...d,snapshots:snaps.map(s=>({...s,snapshot:parseSnapshot(s.snapshot)}))});}
  return NextResponse.json({domains:out});
}

export async function POST(request:Request){
  await ensureSchema(); const body=await request.json(); const action=String(body.action||'add');
  if(action==='add'){
    const domain=cleanDomain(String(body.domain||'')); if(!domain||!domain.includes('.'))return NextResponse.json({error:'Enter a valid domain.'},{status:400});
    const interval=Math.max(15,Math.min(10080,Number(body.intervalMinutes||60)));
    await exec(`INSERT INTO monitored_domains(domain,interval_minutes,next_check_at) VALUES(?,?,NOW(3)) ON DUPLICATE KEY UPDATE enabled=1,interval_minutes=VALUES(interval_minutes),next_check_at=LEAST(next_check_at,NOW(3))`,[domain,interval]);
    return NextResponse.json({ok:true,domain});
  }
  const id=Number(body.id); if(!id)return NextResponse.json({error:'Monitoring id is required.'},{status:400});
  if(action==='delete'){await exec('DELETE FROM monitored_domains WHERE id=?',[id]);return NextResponse.json({ok:true});}
  if(action==='toggle'){await exec('UPDATE monitored_domains SET enabled=IF(enabled=1,0,1),next_check_at=LEAST(next_check_at,NOW(3)) WHERE id=?',[id]);return NextResponse.json({ok:true});}
  if(action==='check'){
    const list=await rows<(RowDataPacket & {id:number;domain:string;interval_minutes:number;last_hash:string|null})>('SELECT id,domain,interval_minutes,last_hash FROM monitored_domains WHERE id=? LIMIT 1',[id]);const d=list[0];if(!d)return NextResponse.json({error:'Monitor not found.'},{status:404});
    const prevRows=await rows<(RowDataPacket & {snapshot:unknown})>('SELECT snapshot FROM domain_monitor_snapshots WHERE domain_id=? ORDER BY id DESC LIMIT 1',[id]);const previous=parseSnapshot(prevRows[0]?.snapshot);const snapshot=await buildDomainSnapshot(d.domain);const hash=snapshotHash(snapshot);const changed=!!d.last_hash&&d.last_hash!==hash;const summary=summarizeChanges(previous,snapshot);
    await exec('INSERT INTO domain_monitor_snapshots(domain_id,domain,changed,change_summary,snapshot) VALUES(?,?,?,?,?)',[id,d.domain,changed?1:0,summary,JSON.stringify(snapshot)]);
    const nextCheck=new Date(Date.now()+Number(d.interval_minutes)*60000);
    await exec(`UPDATE monitored_domains SET last_check_at=NOW(3),last_change_at=IF(?,NOW(3),last_change_at),last_hash=?,next_check_at=? WHERE id=?`,[changed?1:0,hash,nextCheck,id]);
    return NextResponse.json({ok:true,changed,summary,snapshot});
  }
  return NextResponse.json({error:'Unknown action.'},{status:400});
}
