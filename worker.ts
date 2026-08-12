import { Worker } from 'bullmq';
import { ensureSchema, exec, rows } from './lib/db';
import { verifyEmail, type VerificationResult } from './lib/verifier';
import { providerPolicy } from './lib/provider-policy';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildDomainSnapshot, snapshotHash, summarizeChanges, type DomainMonitorSnapshot } from './lib/domain-monitoring';
import type { RowDataPacket } from 'mysql2';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const parsedRedis = new URL(redisUrl);
const connection = {
  host: parsedRedis.hostname,
  port: Number(parsedRedis.port || 6379),
  username: parsedRedis.username || undefined,
  password: parsedRedis.password || undefined,
  db: Number(parsedRedis.pathname.replace('/', '') || 0),
  maxRetriesPerRequest: null,
};
const delayMs = Math.max(0, Number(process.env.BULK_DELAY_MS || 150));
const domainBackoff = new Map<string, number>();
const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0,8)}`;
const retryMinutes=(process.env.GREYLIST_RETRY_MINUTES||'5,30,120').split(',').map(x=>Math.max(1,Number(x.trim()))).filter(Number.isFinite);
const maxRetryAttempts=Math.max(1,Math.min(6,Number(process.env.GREYLIST_MAX_RETRIES||retryMinutes.length||3)));

function parseSnapshot(v:unknown):DomainMonitorSnapshot|null{if(!v)return null;try{return typeof v==='string'?JSON.parse(v):v as DomainMonitorSnapshot}catch{return null}}
function verdictColumn(v:string){return v==='deliverable'?'deliverable':v==='risky'?'risky':v==='undeliverable'?'undeliverable':'unknown'}
function nextRetryDate(attempt:number){const mins=retryMinutes[Math.min(Math.max(0,attempt-1),Math.max(0,retryMinutes.length-1))]||5;return new Date(Date.now()+mins*60_000)}

async function scheduleTemporaryRetry(resultId:number,jobId:string,email:string){
  await exec(`INSERT INTO verification_retries(result_id,job_id,email,attempt,max_attempts,status,next_retry_at) VALUES(?,?,?,?,?,'scheduled',?)`,[resultId,jobId,email,1,maxRetryAttempts,nextRetryDate(1)]);
}

async function processRetries(){
  const due=await rows<(RowDataPacket&{id:number;result_id:number;job_id:string;email:string;attempt:number;max_attempts:number})>(
    `SELECT id,result_id,job_id,email,attempt,max_attempts FROM verification_retries WHERE status='scheduled' AND next_retry_at<=NOW(3) ORDER BY next_retry_at ASC LIMIT 5`
  );
  for(const retry of due){
    const claim=await exec(`UPDATE verification_retries SET status='processing' WHERE id=? AND status='scheduled'`,[retry.id]);
    if(!claim.affectedRows)continue;
    try{
      const oldRows=await rows<(RowDataPacket&{verdict:string})>(`SELECT verdict FROM verification_results WHERE id=? LIMIT 1`,[retry.result_id]);
      const oldVerdict=oldRows[0]?.verdict||'unknown';
      const result=await verifyEmail(retry.email,false);
      await exec(`UPDATE verification_results SET verdict=?,score=?,provider=?,catch_all=?,result=?,created_at=NOW(3) WHERE id=?`,[
        result.verdict,result.score,result.provider??null,result.catchAll==null?null:Number(result.catchAll),JSON.stringify(result),retry.result_id
      ]);
      await exec(`INSERT INTO email_verification_history(email,domain,verdict,score,provider,smtp_code,smtp_state,result) VALUES(?,?,?,?,?,?,?,?)`,[
        result.email,result.domain,result.verdict,result.score,result.provider??null,result.smtpDiagnostics?.rcptCode??null,result.smtpDiagnostics?.classification?.disposition??null,JSON.stringify(result)
      ]);
      if(oldVerdict!==result.verdict){
        const oldCol=verdictColumn(oldVerdict),newCol=verdictColumn(result.verdict);
        await exec(`UPDATE verification_jobs SET ${oldCol}=GREATEST(${oldCol}-1,0), ${newCol}=${newCol}+1 WHERE id=?`,[retry.job_id]);
      }
      if(result.temporaryFailure && retry.attempt < retry.max_attempts){
        const nextAttempt=retry.attempt+1;
        await exec(`UPDATE verification_retries SET status='scheduled',attempt=?,next_retry_at=?,last_error=? WHERE id=?`,[nextAttempt,nextRetryDate(nextAttempt),result.smtpMessage||'Temporary SMTP response',retry.id]);
      }else{
        await exec(`UPDATE verification_retries SET status=?,last_error=? WHERE id=?`,[result.temporaryFailure?'exhausted':'done',result.temporaryFailure?(result.smtpMessage||'Temporary SMTP response'):null,retry.id]);
      }
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(retry.attempt<retry.max_attempts){const nextAttempt=retry.attempt+1;await exec(`UPDATE verification_retries SET status='scheduled',attempt=?,next_retry_at=?,last_error=? WHERE id=?`,[nextAttempt,nextRetryDate(nextAttempt),message,retry.id]);}
      else await exec(`UPDATE verification_retries SET status='exhausted',last_error=? WHERE id=?`,[message,retry.id]);
    }
  }
}

async function run() {
  await ensureSchema();
  await exec(`INSERT INTO worker_nodes(worker_id,hostname,status,last_seen) VALUES(?,?,'online',NOW(3)) ON DUPLICATE KEY UPDATE hostname=VALUES(hostname),status='online',last_seen=NOW(3),started_at=NOW(3)`,[workerId,os.hostname()]);

  const worker = new Worker(
    'email-verification',
    async job => {
      const { jobId, emails, ignoreSMTP } = job.data as {jobId: string;emails: string[];ignoreSMTP: boolean};
      await exec(`UPDATE worker_nodes SET current_job_id=?,status='busy',last_seen=NOW(3) WHERE worker_id=?`,[jobId,workerId]);
      await exec(`UPDATE verification_jobs SET status='running', started_at=COALESCE(started_at, NOW(3)) WHERE id=?`,[jobId]);

      for (let i = 0; i < emails.length; i++) {
        let statusRows = await rows<{ status: string } & RowDataPacket>('SELECT status FROM verification_jobs WHERE id=? LIMIT 1',[jobId]);
        let status = statusRows[0]?.status;
        if (status === 'cancelled') {await exec(`UPDATE worker_nodes SET current_job_id=NULL,status='online',last_seen=NOW(3) WHERE worker_id=?`,[workerId]);return { cancelled: true };}
        while (status === 'paused') {
          await new Promise(resolve => setTimeout(resolve, 1500));
          statusRows = await rows<{ status: string } & RowDataPacket>('SELECT status FROM verification_jobs WHERE id=? LIMIT 1',[jobId]);
          status = statusRows[0]?.status;
          if (status === 'cancelled') {await exec(`UPDATE worker_nodes SET current_job_id=NULL,status='online',last_seen=NOW(3) WHERE worker_id=?`,[workerId]);return { cancelled: true };}
        }

        const result:VerificationResult = await verifyEmail(emails[i], ignoreSMTP);
        const inserted=await exec(`INSERT INTO verification_results(job_id,email,verdict,score,provider,catch_all,result) VALUES(?,?,?,?,?,?,?)`,[
          jobId,result.email,result.verdict,result.score,result.provider??null,result.catchAll==null?null:Number(result.catchAll),JSON.stringify(result)
        ]);
        await exec(`INSERT INTO email_verification_history(email,domain,verdict,score,provider,smtp_code,smtp_state,result) VALUES(?,?,?,?,?,?,?,?)`,[
          result.email,result.domain,result.verdict,result.score,result.provider??null,result.smtpDiagnostics?.rcptCode??null,result.smtpDiagnostics?.classification?.disposition??null,JSON.stringify(result)
        ]);
        if(result.temporaryFailure && !ignoreSMTP) await scheduleTemporaryRetry(Number(inserted.insertId),jobId,result.email);

        await exec(`UPDATE worker_nodes SET processed_total=processed_total+1,last_seen=NOW(3) WHERE worker_id=?`,[workerId]);
        await exec(`UPDATE verification_jobs SET processed=processed+1,deliverable=deliverable+?,risky=risky+?,undeliverable=undeliverable+?,unknown=unknown+? WHERE id=?`,[
          result.verdict==='deliverable'?1:0,result.verdict==='risky'?1:0,result.verdict==='undeliverable'?1:0,result.verdict==='unknown'?1:0,jobId
        ]);
        await job.updateProgress(Math.round(((i + 1) / emails.length) * 100));

        const policyDelay = providerPolicy(result.provider).baseDelayMs;
        const domain = result.domain;
        const previousBackoff = domainBackoff.get(domain) || 0;
        let adaptiveDelay = Math.max(delayMs, policyDelay, previousBackoff);
        if (result.temporaryFailure) {adaptiveDelay=Math.min(15000,Math.max(2000,adaptiveDelay*2));domainBackoff.set(domain,adaptiveDelay);}
        else if(previousBackoff>0){const reduced=Math.max(0,Math.floor(previousBackoff*0.65));if(reduced<delayMs)domainBackoff.delete(domain);else domainBackoff.set(domain,reduced);}
        if(adaptiveDelay)await new Promise(resolve=>setTimeout(resolve,adaptiveDelay));
      }

      await exec(`UPDATE verification_jobs SET status='completed', completed_at=NOW(3) WHERE id=? AND status='running'`,[jobId]);
      await exec(`UPDATE worker_nodes SET current_job_id=NULL,status='online',last_seen=NOW(3) WHERE worker_id=?`,[workerId]);
      return { completed: true };
    },
    {connection,concurrency:Math.max(1,Number(process.env.WORKER_CONCURRENCY||2))}
  );

  const heartbeat=setInterval(()=>{exec(`UPDATE worker_nodes SET last_seen=NOW(3),status=IF(current_job_id IS NULL,'online','busy') WHERE worker_id=?`,[workerId]).catch(console.error)},15000);
  const retryTimer=setInterval(()=>processRetries().catch(console.error),30000);processRetries().catch(console.error);

  let monitoringBusy=false;
  const monitorTick=async()=>{
    if(monitoringBusy)return; monitoringBusy=true;
    try{
      const due=await rows<(RowDataPacket&{id:number;domain:string;interval_minutes:number;last_hash:string|null})>(`SELECT id,domain,interval_minutes,last_hash FROM monitored_domains WHERE enabled=1 AND next_check_at<=NOW(3) ORDER BY next_check_at ASC LIMIT 3`);
      for(const d of due){
        try{
          const prevRows=await rows<(RowDataPacket&{snapshot:unknown})>(`SELECT snapshot FROM domain_monitor_snapshots WHERE domain_id=? ORDER BY id DESC LIMIT 1`,[d.id]);
          const previous=parseSnapshot(prevRows[0]?.snapshot);const snapshot=await buildDomainSnapshot(d.domain);const hash=snapshotHash(snapshot);const changed=!!d.last_hash&&d.last_hash!==hash;const summary=summarizeChanges(previous,snapshot);
          await exec(`INSERT INTO domain_monitor_snapshots(domain_id,domain,changed,change_summary,snapshot) VALUES(?,?,?,?,?)`,[d.id,d.domain,changed?1:0,summary,JSON.stringify(snapshot)]);
          await exec(`UPDATE monitored_domains SET last_check_at=NOW(3),last_change_at=IF(?,NOW(3),last_change_at),last_hash=?,next_check_at=? WHERE id=?`,[changed?1:0,hash,new Date(Date.now()+Number(d.interval_minutes)*60000),d.id]);
        }catch(error){console.error('Domain monitor failed',d.domain,error);await exec(`UPDATE monitored_domains SET last_check_at=NOW(3),next_check_at=? WHERE id=?`,[new Date(Date.now()+15*60000),d.id]);}
      }
    }finally{monitoringBusy=false}
  };
  const monitoringTimer=setInterval(()=>monitorTick().catch(console.error),60000);monitorTick().catch(console.error);

  const shutdown=async()=>{clearInterval(heartbeat);clearInterval(retryTimer);clearInterval(monitoringTimer);await exec(`UPDATE worker_nodes SET status='offline',current_job_id=NULL,last_seen=NOW(3) WHERE worker_id=?`,[workerId]).catch(()=>{});await worker.close();process.exit(0)};
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

  worker.on('failed',async(job,error)=>{const jobId=job?.data?.jobId;if(jobId)await exec(`UPDATE verification_jobs SET status='failed',error=?,completed_at=NOW(3) WHERE id=?`,[error.message,jobId]);await exec(`UPDATE worker_nodes SET current_job_id=NULL,status='online',last_seen=NOW(3) WHERE worker_id=?`,[workerId]).catch(()=>{});console.error('Verification job failed:',error);});
  console.log(`Email verification worker online: ${workerId} (MySQL + BullMQ + retry scheduler)`);
}

run().catch(error=>{console.error(error);process.exit(1)});
