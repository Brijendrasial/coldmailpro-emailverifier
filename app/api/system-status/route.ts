import { NextResponse } from 'next/server';
import { ensureSchema, rows } from '@/lib/db';
import { verificationQueue } from '@/lib/queue';
import type { RowDataPacket } from 'mysql2';

export const runtime='nodejs'; export const dynamic='force-dynamic';

export async function GET(){
  await ensureSchema();
  const counts=await verificationQueue.getJobCounts('waiting','active','completed','failed','delayed','paused');
  const workers=await rows<(RowDataPacket & {worker_id:string;hostname:string;status:string;current_job_id:string|null;processed_total:number;last_seen:Date;started_at:Date})>(`SELECT * FROM worker_nodes ORDER BY last_seen DESC LIMIT 50`);
  const jobs=await rows<(RowDataPacket & {status:string;c:number})>(`SELECT status,COUNT(*) c FROM verification_jobs WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) GROUP BY status`);
  const throughput=await rows<(RowDataPacket & {bucket:string;checked:number;deliverable:number;risky:number;undeliverable:number;unknown_count:number})>(`
    SELECT DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:00') bucket,
           COUNT(*) checked,
           SUM(verdict='deliverable') deliverable,
           SUM(verdict='risky') risky,
           SUM(verdict='undeliverable') undeliverable,
           SUM(verdict='unknown') unknown_count
    FROM verification_results
    WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    GROUP BY bucket ORDER BY bucket ASC`);
  const recent=await rows<(RowDataPacket & {checked_last_5m:number;checked_last_1h:number;temporary_last_1h:number})>(`
    SELECT
      SUM(created_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) checked_last_5m,
      SUM(created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)) checked_last_1h,
      SUM(created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) AND verdict='unknown') temporary_last_1h
    FROM verification_results`);
  const retries=await rows<(RowDataPacket & {scheduled:number;processing:number;done:number;exhausted:number})>(`
    SELECT
      SUM(status='scheduled') scheduled,
      SUM(status='processing') processing,
      SUM(status='done') done,
      SUM(status='exhausted') exhausted
    FROM verification_retries`);
  const onlineWorkers=workers.filter(w=>(Date.now()-new Date(w.last_seen).getTime())<45000).length;
  const last5=Number(recent[0]?.checked_last_5m||0);
  return NextResponse.json({
    queue:counts,
    workers:workers.map(w=>({...w,online:(Date.now()-new Date(w.last_seen).getTime())<45000})),
    jobs24h:Object.fromEntries(jobs.map(x=>[x.status,Number(x.c)])),
    throughput:throughput.map(x=>({...x,checked:Number(x.checked),deliverable:Number(x.deliverable),risky:Number(x.risky),undeliverable:Number(x.undeliverable),unknown_count:Number(x.unknown_count)})),
    live:{onlineWorkers,checksPerMinute:Number((last5/5).toFixed(1)),checkedLastHour:Number(recent[0]?.checked_last_1h||0),unknownLastHour:Number(recent[0]?.temporary_last_1h||0)},
    retries:retries[0]||{scheduled:0,processing:0,done:0,exhausted:0},
    checkedAt:new Date().toISOString()
  });
}
