export type ProviderPolicy = {
  provider: string;
  baseDelayMs: number;
  catchAllTests: number;
  obscuresRecipients: boolean;
  note: string;
};

export function providerPolicy(provider: string): ProviderPolicy {
  const p = provider.toLowerCase();
  if (p.includes('microsoft')) return { provider, baseDelayMs: 900, catchAllTests: 3, obscuresRecipients: true, note: 'Microsoft 365 can obscure recipient validity and throttle repeated RCPT probes.' };
  if (p.includes('google')) return { provider, baseDelayMs: 700, catchAllTests: 2, obscuresRecipients: true, note: 'Google-hosted domains may rate-limit or deliberately avoid deterministic mailbox disclosure.' };
  if (p.includes('proofpoint') || p.includes('mimecast') || p.includes('barracuda') || p.includes('trend micro')) return { provider, baseDelayMs: 1000, catchAllTests: 3, obscuresRecipients: true, note: 'Security gateways may accept recipients before downstream validation; confidence is reduced.' };
  return { provider, baseDelayMs: 250, catchAllTests: 2, obscuresRecipients: false, note: 'Standard SMTP heuristics applied.' };
}
