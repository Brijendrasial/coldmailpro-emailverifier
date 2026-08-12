import { NextResponse } from 'next/server';
import { generatePatternCandidates } from '@/lib/email-patterns';
import { fullSmtpCandidateCheck } from '@/lib/smtp-probe';
import { detectMailProvider } from '@/lib/domain-intelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FinderCandidate = {
  email: string;
  pattern: string;
  patternLabel: string;
  smtpAccepted: boolean;
  temporary: boolean;
  smtpCode: number | null;
  smtpMessage: string;
  mx: string;
  durationMs: number;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = String(body.name || '').trim();
    const domain = String(body.domain || '')
      .trim()
      .toLowerCase()
      .replace(/^@/, '')
      .replace(/^https?:\/\//, '')
      .split('/')[0];

    const generated = generatePatternCandidates(name, domain);
    if (!name || !domain.includes('.') || !generated.length) {
      return NextResponse.json({ error: 'Enter a full name and valid company domain.' }, { status: 400 });
    }

    const smtp = await fullSmtpCandidateCheck(domain, generated.map((c) => c.email));
    const byEmail = new Map(smtp.candidates.map((c) => [c.email, c]));
    const candidates: FinderCandidate[] = generated.map((candidate) => {
      const probe = byEmail.get(candidate.email);
      return {
        email: candidate.email,
        pattern: candidate.pattern,
        patternLabel: candidate.label,
        smtpAccepted: Boolean(probe?.accepted),
        temporary: Boolean(probe?.temporary),
        smtpCode: probe?.code ?? null,
        smtpMessage: probe?.message || 'No SMTP response',
        mx: probe?.mx || smtp.providerMx || '',
        durationMs: probe?.durationMs || 0,
      };
    });

    const accepted = candidates.filter((c) => c.smtpAccepted && !c.temporary);
    const rejected = candidates.filter((c) => !c.smtpAccepted && !c.temporary);
    const temporary = candidates.filter((c) => c.temporary);
    const unique = accepted.length === 1 ? accepted[0] : null;
    const provider = detectMailProvider(smtp.providerMx ? [smtp.providerMx] : []);

    let status: 'found' | 'inconclusive' | 'not_found' | 'temporary';
    let message: string;
    if (unique) {
      status = 'found';
      message = 'Exactly one generated address was accepted by the recipient SMTP server while the other candidates were rejected.';
    } else if (accepted.length > 1) {
      status = 'inconclusive';
      message = `${accepted.length} generated addresses received accepting RCPT responses. SMTP cannot determine which accepted mailbox actually exists on this provider.`;
    } else if (temporary.length > 0) {
      status = 'temporary';
      message = 'The recipient server returned temporary/greylisting responses. Retry later for a deterministic result.';
    } else {
      status = 'not_found';
      message = 'None of the generated addresses were accepted by the recipient SMTP server.';
    }

    return NextResponse.json({
      name,
      domain,
      provider,
      status,
      found: unique,
      candidates,
      summary: {
        total: candidates.length,
        accepted: accepted.length,
        rejected: rejected.length,
        temporary: temporary.length,
      },
      smtp: {
        mx: smtp.providerMx,
        attemptedMx: smtp.attemptedMx,
        banner: smtp.banner,
        ehlo: smtp.ehlo,
      },
      message,
    });
  } catch (error) {
    console.error('Email finder SMTP error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'SMTP finder failed.' },
      { status: 500 },
    );
  }
}
