import { createHash } from 'node:crypto';
import { inspectDomain } from './domain-intelligence';
import { inspectSmtpServer } from './smtp-server-health';

export type DomainMonitorSnapshot = {
  domain: string;
  provider: string;
  mx: Array<{ exchange:string; priority:number; ips:string[] }>;
  spf: unknown;
  dmarc: unknown;
  dkimSelectors: string[];
  mtaSts: unknown;
  tlsRpt: unknown;
  bimi: unknown;
  smtp: Awaited<ReturnType<typeof inspectSmtpServer>>;
  checkedAt: string;
};

export async function buildDomainSnapshot(domain:string):Promise<DomainMonitorSnapshot>{
  const intel=await inspectDomain(domain);
  const smtp=await inspectSmtpServer(domain);
  return{domain:intel.domain,provider:intel.provider,mx:intel.mxRecords,spf:intel.spf,dmarc:intel.dmarc,dkimSelectors:intel.dkimSelectors,mtaSts:intel.mtaSts,tlsRpt:intel.tlsRpt,bimi:intel.bimi,smtp,checkedAt:new Date().toISOString()};
}

export function snapshotHash(snapshot:DomainMonitorSnapshot){
  const stable={provider:snapshot.provider,mx:snapshot.mx,spf:snapshot.spf,dmarc:snapshot.dmarc,dkimSelectors:snapshot.dkimSelectors,mtaSts:snapshot.mtaSts,tlsRpt:snapshot.tlsRpt,bimi:snapshot.bimi,smtp:{available:snapshot.smtp.available,mx:snapshot.smtp.mx,startTls:snapshot.smtp.startTls,tlsEstablished:snapshot.smtp.tlsEstablished,tlsProtocol:snapshot.smtp.tlsProtocol,certificateValidTo:snapshot.smtp.certificateValidTo}};
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function summarizeChanges(previous:DomainMonitorSnapshot|null,current:DomainMonitorSnapshot){
  if(!previous)return 'Initial monitoring snapshot';
  const changes:string[]=[];
  const prevMx=JSON.stringify(previous.mx),curMx=JSON.stringify(current.mx);if(prevMx!==curMx)changes.push('MX infrastructure changed');
  if(JSON.stringify(previous.spf)!==JSON.stringify(current.spf))changes.push('SPF changed');
  if(JSON.stringify(previous.dmarc)!==JSON.stringify(current.dmarc))changes.push('DMARC changed');
  if(JSON.stringify(previous.dkimSelectors)!==JSON.stringify(current.dkimSelectors))changes.push('DKIM selectors changed');
  if(JSON.stringify(previous.mtaSts)!==JSON.stringify(current.mtaSts))changes.push('MTA-STS changed');
  if(JSON.stringify(previous.tlsRpt)!==JSON.stringify(current.tlsRpt))changes.push('TLS-RPT changed');
  if(JSON.stringify(previous.bimi)!==JSON.stringify(current.bimi))changes.push('BIMI changed');
  if(previous.smtp.available!==current.smtp.available)changes.push(`SMTP availability changed to ${current.smtp.available?'online':'offline'}`);
  if(previous.smtp.certificateValidTo!==current.smtp.certificateValidTo)changes.push('SMTP TLS certificate changed');
  return changes.join('; ')||'No material changes';
}
