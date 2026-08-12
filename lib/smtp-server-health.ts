import net from 'node:net';
import tls from 'node:tls';
import { promises as dns } from 'node:dns';

export type SmtpServerHealth = {
  available: boolean;
  mx: string | null;
  banner: string;
  capabilities: string[];
  startTls: boolean;
  tlsEstablished: boolean;
  tlsProtocol: string | null;
  tlsCipher: string | null;
  certificateValidTo: string | null;
  certificateSubject: string | null;
  error: string | null;
  durationMs: number;
};

function certName(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  return Object.entries(v as Record<string, unknown>).map(([k,val])=>`${k}=${String(val)}`).join(', ') || null;
}

export async function inspectSmtpServer(domain: string): Promise<SmtpServerHealth> {
  const started = Date.now();
  const timeout = Math.max(2000, Number(process.env.PING_EMAIL_TIMEOUT || 10000));
  const port = Number(process.env.PING_EMAIL_PORT || 25);
  const fqdn = process.env.PING_EMAIL_FQDN || 'mail.example.org';
  try {
    const mx = (await dns.resolveMx(domain)).sort((a,b)=>a.priority-b.priority)[0];
    if (!mx) throw new Error('No MX record');
    const socket = await new Promise<net.Socket>((resolve,reject)=>{
      const s=net.createConnection({host:mx.exchange,port});
      const timer=setTimeout(()=>{s.destroy();reject(new Error('SMTP connect timeout'))},timeout);
      s.once('connect',()=>{clearTimeout(timer);resolve(s)}); s.once('error',err=>{clearTimeout(timer);reject(err)});
    });
    socket.setEncoding('utf8');
    let buffer='';
    const readReply=()=>new Promise<string>((resolve,reject)=>{
      let lines:string[]=[];const timer=setTimeout(()=>{cleanup();reject(new Error('SMTP response timeout'))},timeout);
      const onData=(chunk:string|Buffer)=>{buffer+=chunk.toString();let idx:number;while((idx=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,idx+1).replace(/\r?\n$/,'');buffer=buffer.slice(idx+1);lines.push(line);const m=line.match(/^(\d{3})([ -])/);if(m&&m[2]===' '){cleanup();resolve(lines.join('\n'));return}}};
      const cleanup=()=>{clearTimeout(timer);socket.off('data',onData)};socket.on('data',onData);
    });
    const banner=await readReply(); socket.write(`EHLO ${fqdn}\r\n`); const ehlo=await readReply();
    const capabilities=ehlo.split(/\r?\n/).map(x=>x.replace(/^250[- ]?/,'').trim()).filter(Boolean); const startTls=capabilities.some(x=>x.toUpperCase().startsWith('STARTTLS'));
    let tlsEstablished=false,tlsProtocol:string|null=null,tlsCipher:string|null=null,certificateValidTo:string|null=null,certificateSubject:string|null=null;
    if(startTls && process.env.SMTP_STARTTLS !== 'false'){
      socket.write('STARTTLS\r\n');const reply=await readReply();if(/^220/.test(reply)){
        socket.removeAllListeners('data');
        const secure=await new Promise<tls.TLSSocket>((resolve,reject)=>{const s=tls.connect({socket,servername:mx.exchange,rejectUnauthorized:false},()=>resolve(s));const timer=setTimeout(()=>{s.destroy();reject(new Error('TLS handshake timeout'))},timeout);s.once('secureConnect',()=>clearTimeout(timer));s.once('error',err=>{clearTimeout(timer);reject(err)})});
        tlsEstablished=true;tlsProtocol=secure.getProtocol();tlsCipher=secure.getCipher()?.name||null;const cert=secure.getPeerCertificate();certificateValidTo=cert.valid_to||null;certificateSubject=certName(cert.subject);secure.write('QUIT\r\n');secure.end();
      }
    } else { socket.write('QUIT\r\n');socket.end(); }
    return{available:true,mx:mx.exchange,banner,capabilities,startTls,tlsEstablished,tlsProtocol,tlsCipher,certificateValidTo,certificateSubject,error:null,durationMs:Date.now()-started};
  } catch(error) {
    return{available:false,mx:null,banner:'',capabilities:[],startTls:false,tlsEstablished:false,tlsProtocol:null,tlsCipher:null,certificateValidTo:null,certificateSubject:null,error:error instanceof Error?error.message:String(error),durationMs:Date.now()-started};
  }
}
