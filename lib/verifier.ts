import { promises as dns } from 'node:dns';
import { randomBytes } from 'node:crypto';
import { PingEmail } from 'ping-email';
import { detectMailProvider } from './domain-intelligence';
import { providerPolicy } from './provider-policy';
import { diagnoseRecipientSmtp, type SmtpDiagnostics } from './smtp-diagnostics';

export type Verdict = 'deliverable' | 'risky' | 'undeliverable' | 'unknown';
export type EvidenceItem = { step: string; status: 'pass' | 'warn' | 'fail' | 'info'; detail: string; durationMs?: number };

export type VerificationResult = {
  email: string; valid: boolean; success: boolean; verdict: Verdict; score: number; message: string;
  checkedAt: string; mode: 'smtp' | 'domain'; durationMs: number; syntax: boolean; domain: string;
  domainExists: boolean; mxFound: boolean; mxRecords: string[]; provider: string; spf: boolean; dmarc: boolean;
  disposable: boolean; freeProvider: boolean; roleAccount: boolean; catchAll: boolean | null;
  catchAllStatus: 'yes' | 'no' | 'inconclusive' | 'not_tested';
  catchAllConfidence: number | null;
  catchAllTests: Array<{ email: string; accepted: boolean; message: string }>;
  typoSuggestion: string | null; smtpAccepted: boolean | null; smtpMessage: string; temporaryFailure: boolean;
  mailboxFull: boolean; riskFlags: string[]; evidence: EvidenceItem[]; providerNote: string;
  smtpDiagnostics: SmtpDiagnostics | null;
};

type DomainFacts = { domainExists: boolean; mxFound: boolean; mxRecords: string[]; provider: string; spf: boolean; dmarc: boolean };
const ROLE_NAMES = new Set(['admin','administrator','billing','contact','hello','help','info','mail','marketing','office','postmaster','privacy','sales','security','support','team','webmaster','abuse','accounts','careers','hr','jobs','noreply','no-reply','service']);
const FREE_PROVIDERS = new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com','yahoo.co.uk','ymail.com','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','zoho.com','gmx.com','gmx.net','mail.com','fastmail.com']);
const DISPOSABLE_DOMAINS = new Set(['10minutemail.com','10minutemail.net','20minutemail.com','33mail.com','dispostable.com','emailondeck.com','fakeinbox.com','getnada.com','guerrillamail.com','guerrillamail.net','guerrillamail.org','maildrop.cc','mailinator.com','mailnesia.com','mintemail.com','mohmal.com','mytemp.email','sharklasers.com','temp-mail.org','tempail.com','tempemail.com','tempmail.com','tempmail.net','throwawaymail.com','trashmail.com','trashmail.net','yopmail.com','yopmail.fr','yopmail.net','mailcatch.com','inboxkitten.com','dropmail.me','burnermail.io','mailsac.com','minuteinbox.com','tempr.email','emailfake.com']);
const TYPO_DOMAINS = ['gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','proton.me','protonmail.com','aol.com','live.com','zoho.com'];
const domainCache = new Map<string,{value:DomainFacts;expires:number}>();
const catchAllCache = new Map<string,{catchAll:boolean|null;status:VerificationResult['catchAllStatus'];confidence:number|null;tests:VerificationResult['catchAllTests'];expires:number}>();
const CACHE_TTL = 30 * 60 * 1000;

function boolEnv(value:string|undefined,fallback=false){ if(value==null)return fallback; return ['1','true','yes','on'].includes(value.toLowerCase()); }
function basicSyntax(email:string){ if(email.length<3||email.length>320)return false; const at=email.lastIndexOf('@'); if(at<=0||at===email.length-1)return false; const local=email.slice(0,at),domain=email.slice(at+1); return local.length<=64&&domain.length<=253&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function levenshtein(a:string,b:string){ const dp=Array.from({length:a.length+1},(_,i)=>Array(b.length+1).fill(0)); for(let i=0;i<=a.length;i++)dp[i][0]=i; for(let j=0;j<=b.length;j++)dp[0][j]=j; for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1)); return dp[a.length][b.length]; }
function typoSuggestion(email:string){ const [local,domain]=email.toLowerCase().split('@'); if(!local||!domain||TYPO_DOMAINS.includes(domain))return null; let best:string|null=null,distance=99; for(const c of TYPO_DOMAINS){const d=levenshtein(domain,c);if(d<distance){distance=d;best=c;}} return distance<=2&&best?`${local}@${best}`:null; }
async function getDomainFacts(domain:string):Promise<DomainFacts>{ const c=domainCache.get(domain); if(c&&c.expires>Date.now())return c.value; let mxRecords:string[]=[],domainExists=false,spf=false,dmarc=false; try{const mx=await dns.resolveMx(domain);mxRecords=mx.sort((a,b)=>a.priority-b.priority).map(x=>x.exchange.toLowerCase());domainExists=mxRecords.length>0;}catch{try{domainExists=(await dns.resolve(domain)).length>0;}catch{}} try{spf=(await dns.resolveTxt(domain)).some(p=>p.join('').toLowerCase().startsWith('v=spf1'));}catch{} try{dmarc=(await dns.resolveTxt(`_dmarc.${domain}`)).some(p=>p.join('').toLowerCase().startsWith('v=dmarc1'));}catch{} const value={domainExists,mxFound:mxRecords.length>0,mxRecords,provider:detectMailProvider(mxRecords),spf,dmarc}; domainCache.set(domain,{value,expires:Date.now()+CACHE_TTL}); return value; }
function isTemporary(message:string){const m=message.toLowerCase();return /\b(421|450|451|452)\b/.test(m)||m.includes('greylist')||m.includes('graylist')||m.includes('try again')||m.includes('temporar')||m.includes('rate limit')||m.includes('too many');}
function isMailboxFull(message:string){const m=message.toLowerCase();return m.includes('mailbox full')||m.includes('quota exceeded')||/\b552\b/.test(m);}
function makeVerifier(ignoreSMTPVerify:boolean){return new PingEmail({port:Number(process.env.PING_EMAIL_PORT||25),fqdn:process.env.PING_EMAIL_FQDN||'mail.example.org',sender:process.env.PING_EMAIL_SENDER||'verify@example.org',timeout:Number(process.env.PING_EMAIL_TIMEOUT||10000),attempts:Number(process.env.PING_EMAIL_ATTEMPTS||2),ignoreSMTPVerify,debug:false});}
async function ping(email:string,ignoreSMTPVerify:boolean){const started=Date.now();try{const r=await makeVerifier(ignoreSMTPVerify).ping(email);return{accepted:Boolean(r.valid),success:Boolean(r.success),message:r.message||'No SMTP message',durationMs:Date.now()-started};}catch(error){return{accepted:false,success:false,message:error instanceof Error?error.message:'Verification failed',durationMs:Date.now()-started};}}

async function detectCatchAll(domain:string,provider:string){
  const cached=catchAllCache.get(domain);
  if(cached&&cached.expires>Date.now()) return {catchAll:cached.catchAll,status:cached.status,confidence:cached.confidence,tests:cached.tests};
  const policy=providerPolicy(provider);
  const configured=Math.max(2,Math.min(4,Number(process.env.CATCH_ALL_TESTS||policy.catchAllTests)));
  const count=Math.max(configured,policy.catchAllTests);
  const tests:VerificationResult['catchAllTests']=[];
  let accepted=0,rejected=0,unknown=0;
  for(let i=0;i<count;i++){
    const random=`verify-${randomBytes(10).toString('hex')}@${domain}`;
    const r=await ping(random,false);
    const temporary=isTemporary(r.message);
    const acceptedNow=r.accepted&&!temporary;
    tests.push({email:random,accepted:acceptedNow,message:r.message});
    if(acceptedNow)accepted++; else if(temporary)unknown++; else rejected++;
    await new Promise(resolve=>setTimeout(resolve,policy.baseDelayMs));
  }

  let catchAll:boolean|null=null;
  let status:VerificationResult['catchAllStatus']='inconclusive';
  let confidence:number|null=null;

  // Opaque providers can intentionally accept RCPT probes for recipients that do not exist.
  // All-random-recipient acceptance therefore must NOT be treated as proof of catch-all.
  if(policy.obscuresRecipients){
    if(rejected===count){
      catchAll=false; status='no'; confidence=100;
    }else{
      catchAll=null; status='inconclusive';
      confidence=Math.max(50,Math.round((Math.max(accepted,rejected)/count)*100)-(unknown*10));
    }
  }else if(accepted===count){
    catchAll=true; status='yes'; confidence=100;
  }else if(rejected===count){
    catchAll=false; status='no'; confidence=100;
  }else{
    catchAll=null; status='inconclusive';
    confidence=Math.max(35,Math.round((Math.max(accepted,rejected)/count)*85)-(unknown*10));
  }

  catchAllCache.set(domain,{catchAll,status,confidence,tests,expires:Date.now()+CACHE_TTL});
  return{catchAll,status,confidence,tests};
}

export async function verifyEmail(email:string,ignoreSMTPOverride?:boolean):Promise<VerificationResult>{
  const started=Date.now(), normalized=email.trim().toLowerCase(), syntax=basicSyntax(normalized);
  const domain=syntax?normalized.slice(normalized.lastIndexOf('@')+1):'', local=syntax?normalized.slice(0,normalized.lastIndexOf('@')):'';
  const ignoreSMTPVerify=ignoreSMTPOverride??boolEnv(process.env.PING_EMAIL_IGNORE_SMTP,false), mode:VerificationResult['mode']=ignoreSMTPVerify?'domain':'smtp', checkedAt=new Date().toISOString();
  const evidence:EvidenceItem[]=[];
  if(!syntax){evidence.push({step:'Syntax',status:'fail',detail:'Email syntax is invalid'});return{email:normalized,valid:false,success:true,verdict:'undeliverable',score:0,message:'Invalid email syntax',checkedAt,mode,durationMs:Date.now()-started,syntax:false,domain,domainExists:false,mxFound:false,mxRecords:[],provider:'Unknown',spf:false,dmarc:false,disposable:false,freeProvider:false,roleAccount:false,catchAll:null,catchAllStatus:'not_tested',catchAllConfidence:null,catchAllTests:[],typoSuggestion:null,smtpAccepted:null,smtpMessage:'',temporaryFailure:false,mailboxFull:false,riskFlags:['Invalid syntax'],evidence,providerNote:'No provider analysis available.',smtpDiagnostics:null};}
  evidence.push({step:'Syntax',status:'pass',detail:'Address structure is valid'});
  const dnsStarted=Date.now(),facts=await getDomainFacts(domain); evidence.push({step:'DNS / MX',status:facts.mxFound?'pass':facts.domainExists?'warn':'fail',detail:facts.mxFound?`${facts.mxRecords.length} MX record(s) found via ${facts.provider}`:facts.domainExists?'Domain resolves but has no MX records':'Domain does not resolve',durationMs:Date.now()-dnsStarted});
  const policy=providerPolicy(facts.provider),disposable=DISPOSABLE_DOMAINS.has(domain),freeProvider=FREE_PROVIDERS.has(domain),roleAccount=ROLE_NAMES.has(local),suggestion=typoSuggestion(normalized),riskFlags:string[]=[];
  if(disposable)riskFlags.push('Disposable email provider'); if(roleAccount)riskFlags.push('Role-based mailbox'); if(suggestion)riskFlags.push('Possible domain typo'); if(policy.obscuresRecipients)riskFlags.push('Provider may obscure mailbox existence');
  evidence.push({step:'Provider policy',status:policy.obscuresRecipients?'warn':'info',detail:policy.note});
  if(!facts.domainExists||!facts.mxFound){return{email:normalized,valid:false,success:true,verdict:'undeliverable',score:facts.domainExists?20:10,message:!facts.domainExists?'Domain does not resolve':'No MX records found',checkedAt,mode,durationMs:Date.now()-started,syntax,domain,...facts,disposable,freeProvider,roleAccount,catchAll:null,catchAllStatus:'not_tested',catchAllConfidence:null,catchAllTests:[],typoSuggestion:suggestion,smtpAccepted:null,smtpMessage:'',temporaryFailure:false,mailboxFull:false,riskFlags:[...riskFlags,!facts.domainExists?'Domain unavailable':'No MX records'],evidence,providerNote:policy.note,smtpDiagnostics:null};}
  let smtpAccepted:boolean|null=null,smtpMessage='SMTP check disabled',temporaryFailure=false,mailboxFull=false,catchAll:boolean|null=null,catchAllStatus:VerificationResult['catchAllStatus']='not_tested',catchAllConfidence:number|null=null,catchAllTests:VerificationResult['catchAllTests']=[],success=true,smtpDiagnostics:SmtpDiagnostics|null=null;
  if(!ignoreSMTPVerify){const target=await ping(normalized,false);smtpAccepted=target.accepted;smtpMessage=target.message;success=target.success;temporaryFailure=isTemporary(target.message);mailboxFull=isMailboxFull(target.message);evidence.push({step:'SMTP recipient',status:temporaryFailure?'warn':smtpAccepted?'pass':'fail',detail:target.message,durationMs:target.durationMs});
    if(process.env.SMTP_DIAGNOSTICS_ENABLED!=='false'){try{smtpDiagnostics=await diagnoseRecipientSmtp(normalized);const c=smtpDiagnostics.classification;evidence.push({step:'SMTP diagnostics',status:c.disposition==='accepted'?'pass':c.retryable?'warn':'info',detail:`${c.label} via ${smtpDiagnostics.mx||'MX'} · RCPT ${smtpDiagnostics.rcptCode??'—'}`,durationMs:smtpDiagnostics.durationMs});evidence.push({step:'STARTTLS',status:smtpDiagnostics.tls.established?'pass':smtpDiagnostics.tls.offered?'warn':'info',detail:smtpDiagnostics.tls.established?`${smtpDiagnostics.tls.protocol||'TLS'} · ${smtpDiagnostics.tls.cipher||'cipher unknown'}`:smtpDiagnostics.tls.offered?'STARTTLS offered but TLS handshake was not established':'STARTTLS not advertised'});}catch(diagError){evidence.push({step:'SMTP diagnostics',status:'warn',detail:`Detailed transcript unavailable: ${diagError instanceof Error?diagError.message:String(diagError)}`});}}
    if(smtpAccepted&&!temporaryFailure&&boolEnv(process.env.CATCH_ALL_ENABLED,true)){const d=await detectCatchAll(domain,facts.provider);catchAll=d.catchAll;catchAllStatus=d.status;catchAllConfidence=d.confidence;catchAllTests=d.tests;const catchDetail=d.status==='yes'?`Random recipients accepted: catch-all detected (${d.confidence}% confidence)`:d.status==='no'?`Random recipients rejected: not catch-all (${d.confidence}% confidence)`:`Random-recipient SMTP behavior is inconclusive for ${facts.provider}; catch-all is not confirmed`;evidence.push({step:'Catch-all probes',status:d.status==='no'?'pass':'warn',detail:catchDetail});if(d.status==='yes')riskFlags.push('Catch-all / accept-all domain');if(d.status==='inconclusive')riskFlags.push('Catch-all status inconclusive — provider obscures recipient validation');}}
  if(temporaryFailure)riskFlags.push('Temporary SMTP failure / greylisting');if(mailboxFull)riskFlags.push('Mailbox full or over quota');
  let score=10+(facts.domainExists?10:0)+(facts.mxFound?15:0)+(facts.spf?5:0)+(facts.dmarc?5:0)+(!disposable?5:0)+(!roleAccount?5:0)+(!suggestion?5:0); if(ignoreSMTPVerify)score+=20;else if(smtpAccepted)score+=35;if(catchAllStatus==='no')score+=5;if(catchAllStatus==='yes')score-=20;if(catchAllStatus==='inconclusive'&&smtpAccepted)score=Math.min(score,95);if(temporaryFailure)score=Math.min(score,55);if(disposable)score-=20;if(suggestion)score-=15;if(mailboxFull)score=Math.min(score,60);score=Math.max(0,Math.min(100,score));
  let verdict:Verdict,message:string; if(ignoreSMTPVerify){verdict=disposable||suggestion?'risky':'unknown';message='Domain and MX are valid; mailbox was not probed';}else if(temporaryFailure){verdict='unknown';message='Temporary SMTP response; retry recommended';}else if(mailboxFull){verdict='risky';message='Mailbox appears to exist but is currently full';}else if(!smtpAccepted){verdict='undeliverable';message=smtpMessage||'Recipient was not accepted by the mail server';}else if(catchAllStatus==='yes'||disposable||suggestion||catchAllStatus==='inconclusive'){verdict='risky';message=catchAllStatus==='yes'?'Catch-all domain: mailbox existence cannot be confirmed':catchAllStatus==='inconclusive'?`${facts.provider} accepted the recipient; catch-all status is inconclusive because this provider can obscure RCPT validation`:disposable?'Disposable mailbox detected':'Possible domain typo detected';}else{verdict='deliverable';message='Mailbox accepted by recipient server';}
  evidence.push({step:'Final verdict',status:verdict==='deliverable'?'pass':verdict==='undeliverable'?'fail':'warn',detail:`${verdict.toUpperCase()} · score ${score}/100`});
  return{email:normalized,valid:verdict==='deliverable',success,verdict,score,message,checkedAt,mode,durationMs:Date.now()-started,syntax,domain,...facts,disposable,freeProvider,roleAccount,catchAll,catchAllStatus,catchAllConfidence,catchAllTests,typoSuggestion:suggestion,smtpAccepted,smtpMessage,temporaryFailure,mailboxFull,riskFlags,evidence,providerNote:policy.note,smtpDiagnostics};
}
