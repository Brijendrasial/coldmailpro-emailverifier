import { promises as dns } from 'node:dns';

export type DomainIntelligence = {
  domain: string;
  resolves: boolean;
  mxRecords: Array<{ exchange: string; priority: number; ips: string[] }>;
  provider: string;
  spf: { present: boolean; record: string | null; policy: string | null; lookupCountEstimate: number };
  dmarc: { present: boolean; record: string | null; policy: string | null; rua: string | null };
  mtaSts: { present: boolean; record: string | null };
  tlsRpt: { present: boolean; record: string | null };
  bimi: { present: boolean; record: string | null };
  dkimSelectors: string[];
  checkedAt: string;
};

export function detectMailProvider(mxRecords: string[]) {
  const mx = mxRecords.join(' ').toLowerCase();
  if (mx.includes('google.com') || mx.includes('googlemail.com')) return 'Google Workspace';
  if (mx.includes('mail.protection.outlook.com')) return 'Microsoft 365';
  if (mx.includes('zoho.')) return 'Zoho Mail';
  if (mx.includes('pphosted.com')) return 'Proofpoint';
  if (mx.includes('mimecast.')) return 'Mimecast';
  if (mx.includes('barracudanetworks.com')) return 'Barracuda';
  if (mx.includes('tmes.trendmicro.')) return 'Trend Micro';
  if (mx.includes('yahoodns.net')) return 'Yahoo Mail';
  if (mx.includes('icloud.com')) return 'Apple iCloud Mail';
  if (mx.includes('protonmail.')) return 'Proton Mail';
  if (mx.includes('secureserver.net')) return 'GoDaddy Email';
  if (mx.includes('emailsrvr.com')) return 'Rackspace Email';
  if (mx.includes('messagingengine.com')) return 'Fastmail';
  return mxRecords.length ? 'Custom / Other' : 'Unknown';
}

async function txtRecord(name: string, prefix?: string) {
  try {
    const records = (await dns.resolveTxt(name)).map(parts => parts.join(''));
    return prefix ? records.find(v => v.toLowerCase().startsWith(prefix.toLowerCase())) || null : records[0] || null;
  } catch { return null; }
}

function tag(record: string | null, name: string) {
  if (!record) return null;
  const match = record.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`, 'i'));
  return match?.[1]?.trim() || null;
}

export async function inspectDomain(rawDomain: string): Promise<DomainIntelligence> {
  const domain = rawDomain.trim().toLowerCase().replace(/^@/, '');
  let resolves = false;
  let mxRaw: Array<{ exchange: string; priority: number }> = [];
  try { resolves = (await dns.resolve(domain)).length > 0; } catch { /* noop */ }
  try {
    mxRaw = (await dns.resolveMx(domain)).sort((a,b) => a.priority - b.priority)
      .map(v => ({ exchange: v.exchange.toLowerCase(), priority: v.priority }));
    if (mxRaw.length) resolves = true;
  } catch { /* noop */ }

  const mxRecords = await Promise.all(mxRaw.map(async mx => {
    const ips: string[] = [];
    try { ips.push(...await dns.resolve4(mx.exchange)); } catch { /* noop */ }
    try { ips.push(...await dns.resolve6(mx.exchange)); } catch { /* noop */ }
    return { ...mx, ips };
  }));

  const spf = await txtRecord(domain, 'v=spf1');
  const dmarc = await txtRecord(`_dmarc.${domain}`, 'v=dmarc1');
  const mtaSts = await txtRecord(`_mta-sts.${domain}`, 'v=stsv1');
  const tlsRpt = await txtRecord(`_smtp._tls.${domain}`, 'v=tlsrptv1');
  const bimi = await txtRecord(`default._bimi.${domain}`, 'v=bimi1');

  const selectors = ['default','google','selector1','selector2','k1','smtp','dkim'];
  const dkimSelectors: string[] = [];
  for (const selector of selectors) {
    const rec = await txtRecord(`${selector}._domainkey.${domain}`);
    if (rec?.toLowerCase().includes('v=dkim1')) dkimSelectors.push(selector);
  }

  const spfLookups = spf ? (spf.match(/\b(include:|a\b|mx\b|exists:|redirect=)/gi) || []).length : 0;
  const spfPolicy = spf?.match(/([+~?-]all)\b/i)?.[1] || null;

  return {
    domain,
    resolves,
    mxRecords,
    provider: detectMailProvider(mxRaw.map(v => v.exchange)),
    spf: { present: Boolean(spf), record: spf, policy: spfPolicy, lookupCountEstimate: spfLookups },
    dmarc: { present: Boolean(dmarc), record: dmarc, policy: tag(dmarc,'p'), rua: tag(dmarc,'rua') },
    mtaSts: { present: Boolean(mtaSts), record: mtaSts },
    tlsRpt: { present: Boolean(tlsRpt), record: tlsRpt },
    bimi: { present: Boolean(bimi), record: bimi },
    dkimSelectors,
    checkedAt: new Date().toISOString(),
  };
}
