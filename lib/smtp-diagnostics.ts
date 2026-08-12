import net from 'node:net';
import tls from 'node:tls';
import { promises as dns } from 'node:dns';
import { classifySmtp, type SmtpClassification } from './smtp-classifier';

export type TranscriptLine = { direction: 'server' | 'client' | 'info'; text: string; atMs: number };
export type TlsInfo = {
  offered: boolean;
  attempted: boolean;
  established: boolean;
  authorized: boolean | null;
  authorizationError: string | null;
  protocol: string | null;
  cipher: string | null;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint256: string | null;
};
export type SmtpDiagnostics = {
  mx: string | null;
  attemptedMx: string[];
  banner: string;
  ehlo: string;
  capabilities: string[];
  rcptCode: number | null;
  rcptMessage: string;
  classification: SmtpClassification;
  transcript: TranscriptLine[];
  tls: TlsInfo;
  durationMs: number;
};

type Reply = { code: number | null; message: string; lines: string[] };

function emptyTls(): TlsInfo { return { offered:false,attempted:false,established:false,authorized:null,authorizationError:null,protocol:null,cipher:null,subject:null,issuer:null,validFrom:null,validTo:null,fingerprint256:null }; }
function certName(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const entries = Object.entries(v as Record<string, unknown>).map(([k,val]) => `${k}=${String(val)}`);
  return entries.length ? entries.join(', ') : null;
}

class Session {
  private socket: net.Socket | tls.TLSSocket;
  private buffer=''; private lines:string[]=[]; private waiters:Array<() => void>=[];
  constructor(socket:net.Socket|tls.TLSSocket, private transcript:TranscriptLine[], private started:number){this.socket=socket;this.attach(socket)}
  private attach(socket:net.Socket|tls.TLSSocket){socket.setEncoding('utf8');socket.on('data',(chunk)=>{this.buffer+=chunk;let idx:number;while((idx=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,idx+1).replace(/\r?\n$/,'');this.buffer=this.buffer.slice(idx+1);this.lines.push(line);this.transcript.push({direction:'server',text:line,atMs:Date.now()-this.started});}const w=this.waiters.splice(0);for(const f of w)f();});}
  private async line(timeout:number){const deadline=Date.now()+timeout;while(!this.lines.length){const remain=deadline-Date.now();if(remain<=0)throw new Error('SMTP response timeout');await new Promise<void>((resolve,reject)=>{const wake=()=>{clearTimeout(timer);resolve()};const timer=setTimeout(()=>{const i=this.waiters.indexOf(wake);if(i>=0)this.waiters.splice(i,1);reject(new Error('SMTP response timeout'))},remain);this.waiters.push(wake)});}return this.lines.shift()||''}
  async reply(timeout:number):Promise<Reply>{const lines:string[]=[];let code:number|null=null;while(true){const line=await this.line(timeout);lines.push(line);const m=line.match(/^(\d{3})([ -])(.*)$/);if(!m){if(lines.length>30)break;continue}code=Number(m[1]);if(m[2]===' ')break;if(lines.length>80)break}return{code,message:lines.join('\n'),lines}}
  async command(command:string,timeout:number){this.transcript.push({direction:'client',text:command,atMs:Date.now()-this.started});await new Promise<void>((resolve,reject)=>this.socket.write(`${command}\r\n`,err=>err?reject(err):resolve()));return this.reply(timeout)}
  async upgradeTls(host:string,timeout:number):Promise<tls.TLSSocket>{const raw=this.socket as net.Socket;raw.removeAllListeners('data');const secure=await new Promise<tls.TLSSocket>((resolve,reject)=>{const s=tls.connect({socket:raw,servername:host,rejectUnauthorized:false},()=>resolve(s));const timer=setTimeout(()=>{s.destroy();reject(new Error('STARTTLS handshake timeout'))},timeout);s.once('secureConnect',()=>clearTimeout(timer));s.once('error',err=>{clearTimeout(timer);reject(err)})});this.socket=secure;this.buffer='';this.lines=[];this.attach(secure);return secure}
  close(){this.socket.destroy()}
}

async function connect(host:string,port:number,timeout:number){return new Promise<net.Socket>((resolve,reject)=>{const s=net.createConnection({host,port});const timer=setTimeout(()=>{s.destroy();reject(new Error(`Connection timeout to ${host}:${port}`))},timeout);s.once('connect',()=>{clearTimeout(timer);s.setTimeout(timeout,()=>s.destroy(new Error('SMTP socket timeout')));resolve(s)});s.once('error',err=>{clearTimeout(timer);reject(err)})})}
function caps(lines:string[]){return lines.map(x=>x.replace(/^250[- ]?/,'').trim()).filter(Boolean)}

export async function diagnoseRecipientSmtp(email:string):Promise<SmtpDiagnostics>{
  const started=Date.now(); const domain=email.slice(email.lastIndexOf('@')+1).toLowerCase();
  const timeout=Math.max(2000,Number(process.env.PING_EMAIL_TIMEOUT||10000)); const port=Number(process.env.PING_EMAIL_PORT||25);
  const fqdn=process.env.PING_EMAIL_FQDN||'mail.example.org'; const sender=process.env.PING_EMAIL_SENDER||`verify@${fqdn.includes('.')?fqdn:'example.org'}`;
  const mx=(await dns.resolveMx(domain)).sort((a,b)=>a.priority-b.priority); if(!mx.length)throw new Error('No MX records found');
  const attemptedMx:string[]=[]; let lastError:unknown=null;
  for(const record of mx){attemptedMx.push(record.exchange);const transcript:TranscriptLine[]=[];let session:Session|null=null;let tlsInfo=emptyTls();try{
    transcript.push({direction:'info',text:`Connecting to ${record.exchange}:${port}`,atMs:Date.now()-started});
    const socket=await connect(record.exchange,port,timeout);session=new Session(socket,transcript,started);
    const banner=await session.reply(timeout); if(!banner.code||banner.code>=400)throw new Error(`SMTP banner rejected: ${banner.message}`);
    let ehlo=await session.command(`EHLO ${fqdn}`,timeout); if(!ehlo.code||ehlo.code>=400)ehlo=await session.command(`HELO ${fqdn}`,timeout);
    let capabilities=caps(ehlo.lines); tlsInfo.offered=capabilities.some(c=>c.toUpperCase().startsWith('STARTTLS'));
    if(tlsInfo.offered && process.env.SMTP_STARTTLS !== 'false'){
      tlsInfo.attempted=true; const starttls=await session.command('STARTTLS',timeout);
      if(starttls.code===220){const secure=await session.upgradeTls(record.exchange,timeout);const cert=secure.getPeerCertificate();tlsInfo={...tlsInfo,established:true,authorized:secure.authorized,authorizationError: secure.authorizationError ? String(secure.authorizationError) : null,protocol:secure.getProtocol(),cipher:secure.getCipher()?.name||null,subject:certName(cert.subject),issuer:certName(cert.issuer),validFrom:cert.valid_from||null,validTo:cert.valid_to||null,fingerprint256:cert.fingerprint256||null};
        transcript.push({direction:'info',text:`STARTTLS established: ${tlsInfo.protocol||'TLS'} · ${tlsInfo.cipher||'cipher unknown'}`,atMs:Date.now()-started});
        ehlo=await session.command(`EHLO ${fqdn}`,timeout);capabilities=caps(ehlo.lines);
      }
    }
    const mail=await session.command(`MAIL FROM:<${sender}>`,timeout);if(!mail.code||mail.code>=400)throw new Error(`MAIL FROM rejected: ${mail.message}`);
    const rcpt=await session.command(`RCPT TO:<${email}>`,timeout);const classification=classifySmtp(rcpt.code,rcpt.message);
    await session.command('RSET',Math.min(timeout,3000)).catch(()=>({code:null,message:'',lines:[]}));await session.command('QUIT',Math.min(timeout,3000)).catch(()=>({code:null,message:'',lines:[]}));session.close();
    return{mx:record.exchange,attemptedMx,banner:banner.message,ehlo:ehlo.message,capabilities,rcptCode:rcpt.code,rcptMessage:rcpt.message,classification,transcript,tls:tlsInfo,durationMs:Date.now()-started};
  }catch(error){lastError=error;transcript.push({direction:'info',text:`MX failed: ${error instanceof Error?error.message:String(error)}`,atMs:Date.now()-started});session?.close();}}
  throw lastError instanceof Error?lastError:new Error('Unable to diagnose any MX server');
}
