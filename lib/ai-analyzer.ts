import { exactWebCorroboration, type ExactWebEvidence } from './web-corroboration';
export type AIEmailAssessment = {
  mailboxLikelihood: number;
  catchAllLikelihood: number;
  confidence: 'low' | 'medium' | 'high';
  recommendedVerdict: 'deliverable' | 'risky' | 'undeliverable' | 'unknown';
  recommendedAction: 'accept' | 'retry' | 'review' | 'reject';
  summary: string;
  reasons: string[];
  limitations: string[];
  webSearchUsed: boolean;
  webStatus: 'exact_match' | 'related_match' | 'not_found' | 'not_needed' | 'unavailable';
  exactEmailPubliclyObserved: boolean;
  webSummary: string;
  webQueries: string[];
  webSources: Array<{ url: string; title: string | null }>;
  exactSearchProvider: string;
  exactMatchCount: number;
  exactMatches: Array<{url:string;title:string|null;source:string;exactInSnippet:boolean;exactOnPage:boolean}>;
  exactPagesChecked: number;
};

export type AIChatAnswer = {
  answer: string;
  confidence: 'low' | 'medium' | 'high';
  importantSignals: string[];
  limitations: string[];
};

export type AIBulkDiagnosis = {
  health: 'good' | 'degraded' | 'poor' | 'unknown';
  summary: string;
  anomalies: string[];
  recommendedActions: string[];
  providerObservations: string[];
};

type JsonSchema = Record<string, unknown>;

function enabled() {
  return process.env.AI_ANALYSIS_ENABLED !== 'false' && Boolean(process.env.OPENAI_API_KEY);
}

function model() {
  return process.env.OPENAI_MODEL || 'gpt-5';
}

function webEnabled() {
  return process.env.AI_WEB_SEARCH_ENABLED !== 'false';
}

function shouldUseWeb(result: any) {
  if (!webEnabled()) return false;
  const status = String(result?.catchAllStatus || '');
  const provider = String(result?.provider || '').toLowerCase();
  const opaque = ['google workspace','microsoft 365','proofpoint','mimecast','barracuda','trend micro'];
  return status === 'yes' || status === 'inconclusive' || opaque.some(x => provider.includes(x));
}


function extractOutputText(data: any): string {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content?.text === 'string') {
        return content.text;
      }
    }
  }
  throw new Error('OpenAI returned no text output.');
}

function extractWebSources(data: any): Array<{url:string;title:string|null}> {
  const out = new Map<string, {url:string;title:string|null}>();
  const add = (url: unknown, title?: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (!out.has(url)) out.set(url, { url, title: typeof title === 'string' && title.trim() ? title.trim() : null });
  };
  for (const item of data?.output || []) {
    if (item?.type === 'web_search_call') {
      for (const src of item?.action?.sources || []) add(src?.url, src?.title);
    }
    if (item?.type === 'message') {
      for (const content of item?.content || []) {
        for (const ann of content?.annotations || []) {
          if (ann?.type === 'url_citation') add(ann?.url, ann?.title);
          if (ann?.url_citation) add(ann.url_citation?.url, ann.url_citation?.title);
        }
      }
    }
  }
  return [...out.values()].slice(0, 12);
}

async function structured<T>(name: string, schema: JsonSchema, system: string, payload: unknown, useWeb = false): Promise<{value:T;sources:Array<{url:string;title:string|null}>}> {
  if (!enabled()) throw new Error('AI analysis is not configured. Set OPENAI_API_KEY and AI_ANALYSIS_ENABLED=true.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || 45000));
  try {
    const body: any = {
      model: model(),
      store: false,
      reasoning: { effort: process.env.AI_REASONING_EFFORT || 'low' },
      max_output_tokens: Number(process.env.AI_MAX_OUTPUT_TOKENS || 1600),
      input: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name,
          strict: true,
          schema,
        },
      },
    };
    if (useWeb) {
      body.tools = [{ type: 'web_search', search_context_size: process.env.AI_WEB_SEARCH_CONTEXT || 'medium' }];
      body.tool_choice = 'required';
      body.max_tool_calls = Math.max(1, Math.min(6, Number(process.env.AI_WEB_SEARCH_MAX_CALLS || 3)));
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed (${response.status}).`);
    return { value: JSON.parse(extractOutputText(data)) as T, sources: extractWebSources(data) };
  } finally {
    clearTimeout(timeout);
  }
}

function compactResult(result: any) {
  const transcript = Array.isArray(result?.smtpDiagnostics?.transcript)
    ? result.smtpDiagnostics.transcript.slice(-40).map((x: any) => ({ direction: x.direction, text: String(x.text || '').slice(0, 500), atMs: x.atMs }))
    : [];
  return {
    email: result?.email,
    verdict: result?.verdict,
    score: result?.score,
    provider: result?.provider,
    providerNote: result?.providerNote,
    syntax: result?.syntax,
    domainExists: result?.domainExists,
    mxFound: result?.mxFound,
    mxRecords: result?.mxRecords,
    smtpAccepted: result?.smtpAccepted,
    smtpMessage: result?.smtpMessage,
    temporaryFailure: result?.temporaryFailure,
    mailboxFull: result?.mailboxFull,
    catchAllStatus: result?.catchAllStatus,
    catchAllConfidence: result?.catchAllConfidence,
    catchAllTests: result?.catchAllTests,
    disposable: result?.disposable,
    roleAccount: result?.roleAccount,
    freeProvider: result?.freeProvider,
    spf: result?.spf,
    dmarc: result?.dmarc,
    riskFlags: result?.riskFlags,
    evidence: result?.evidence,
    smtpDiagnostics: result?.smtpDiagnostics ? {
      mx: result.smtpDiagnostics.mx,
      attemptedMx: result.smtpDiagnostics.attemptedMx,
      banner: String(result.smtpDiagnostics.banner || '').slice(0, 1000),
      ehlo: String(result.smtpDiagnostics.ehlo || '').slice(0, 1500),
      capabilities: result.smtpDiagnostics.capabilities,
      rcptCode: result.smtpDiagnostics.rcptCode,
      rcptMessage: String(result.smtpDiagnostics.rcptMessage || '').slice(0, 1000),
      classification: result.smtpDiagnostics.classification,
      tls: result.smtpDiagnostics.tls,
      durationMs: result.smtpDiagnostics.durationMs,
      transcript,
    } : null,
  };
}

const assessmentSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mailboxLikelihood','catchAllLikelihood','confidence','recommendedVerdict','recommendedAction','summary','reasons','limitations','webStatus','exactEmailPubliclyObserved','webSummary','webQueries'],
  properties: {
    mailboxLikelihood: { type: 'integer', minimum: 0, maximum: 100 },
    catchAllLikelihood: { type: 'integer', minimum: 0, maximum: 100 },
    confidence: { type: 'string', enum: ['low','medium','high'] },
    recommendedVerdict: { type: 'string', enum: ['deliverable','risky','undeliverable','unknown'] },
    recommendedAction: { type: 'string', enum: ['accept','retry','review','reject'] },
    summary: { type: 'string' },
    reasons: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    limitations: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    webStatus: { type: 'string', enum: ['exact_match','related_match','not_found','not_needed','unavailable'] },
    exactEmailPubliclyObserved: { type: 'boolean' },
    webSummary: { type: 'string' },
    webQueries: { type: 'array', items: { type: 'string' }, maxItems: 8 },
  },
};

const chatSchema: JsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['answer','confidence','importantSignals','limitations'],
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'string', enum: ['low','medium','high'] },
    importantSignals: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    limitations: { type: 'array', items: { type: 'string' }, maxItems: 5 },
  },
};

const bulkSchema: JsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['health','summary','anomalies','recommendedActions','providerObservations'],
  properties: {
    health: { type: 'string', enum: ['good','degraded','poor','unknown'] },
    summary: { type: 'string' },
    anomalies: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    recommendedActions: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    providerObservations: { type: 'array', items: { type: 'string' }, maxItems: 10 },
  },
};

export async function analyzeVerification(result: any, history: any[]): Promise<AIEmailAssessment> {
  const eligibleForWeb = shouldUseWeb(result);
  const email = String(result?.email || '').trim().toLowerCase();
  const exact: ExactWebEvidence = eligibleForWeb ? await exactWebCorroboration(email) : {searched:false,exactFound:false,provider:'not needed',queries:[],matches:[],checkedPages:0,notes:[]};
  const useWeb = eligibleForWeb && !exact.exactFound;
  const response = await structured<Omit<AIEmailAssessment,'webSearchUsed'|'webSources'>>(
    'email_verification_assessment', assessmentSchema,
    eligibleForWeb
      ? `You are an email-deliverability evidence analyst. Deterministic exact-web evidence is supplied in deterministicExactWebEvidence. If exactFound=true, treat that literal page evidence as authoritative for PUBLICATION of the address and never contradict it. Web search may also be available when deterministic exact evidence did not find a match. The SMTP/DNS/TLS evidence remains primary. Because this mailbox is catch-all, inconclusive, or hosted by an opaque provider, a deterministic exact-match web check has already been supplied in deterministicExactWebEvidence. Treat literal exact matches there as stronger than model search. If it found an exact match, do NOT contradict it. Otherwise SEARCH THE PUBLIC WEB to corroborate the exact email address. Search the exact address in quotes first, then search the local-part plus domain and relevant public company/contact/profile pages. An exact public occurrence is corroborating evidence that the address has been published, but it is NOT proof that the mailbox currently accepts mail. No search result is NOT evidence that the mailbox does not exist. Never invent sources or claim private/non-public data. Set exactEmailPubliclyObserved=true only when the exact email string is found in public web evidence. Clearly separate SMTP certainty from public-web corroboration.`
      : `You are an email-deliverability evidence analyst. Analyze only the supplied SMTP/DNS/TLS evidence. Never claim a mailbox is confirmed unless the evidence uniquely proves it. A 250 RCPT response from an opaque provider can be anti-enumeration behavior and must not be treated as proof by itself. Clearly distinguish SMTP acceptance, catch-all behavior, and mailbox existence. Scores are evidence estimates, not ground truth. Do not invent external facts or addresses. Set webStatus=not_needed, exactEmailPubliclyObserved=false, webSummary to a short explanation, and webQueries to an empty array.`,
    { current: compactResult(result), exactEmailToCorroborate: email, deterministicExactWebEvidence: exact, recentHistory: history.slice(0, 5).map((x: any) => ({ verdict:x.verdict, score:x.score, provider:x.provider, smtp_code:x.smtp_code, smtp_state:x.smtp_state, created_at:x.created_at })) },
    useWeb
  );
  let value:any = response.value;
  const smtpAccepted = result?.smtpAccepted === true;
  if (exact.exactFound) {
    value = {
      ...value,
      exactEmailPubliclyObserved: true,
      webStatus: 'exact_match',
      webSummary: `The literal email address was found on ${exact.matches.length} public page(s) by the deterministic exact-match engine (${exact.provider}). This strongly corroborates that the address has been publicly used, but public publication alone cannot prove it is active today.`,
      webQueries: [...new Set([...(value.webQueries||[]), ...exact.queries])].slice(0,8),
      mailboxLikelihood: smtpAccepted ? Math.max(Number(value.mailboxLikelihood||0), 97) : Math.max(Number(value.mailboxLikelihood||0), 88),
      catchAllLikelihood: Math.min(Number(value.catchAllLikelihood||100), result?.catchAllStatus === 'yes' ? 70 : 45),
      confidence: 'high',
      recommendedVerdict: smtpAccepted ? 'deliverable' : value.recommendedVerdict,
      recommendedAction: smtpAccepted ? 'accept' : value.recommendedAction,
    };
  }
  const deterministicSources = exact.matches.map(m=>({url:m.url,title:m.title}));
  const merged = new Map<string,{url:string;title:string|null}>();
  for (const src of [...deterministicSources,...response.sources]) if(src.url&&!merged.has(src.url)) merged.set(src.url,src);
  return { ...value, webSearchUsed: eligibleForWeb, webSources: [...merged.values()].slice(0,16), exactSearchProvider: exact.provider, exactMatchCount: exact.matches.length, exactMatches: exact.matches, exactPagesChecked: exact.checkedPages };
}

export async function chatAboutVerification(question: string, result: any, history: any[]): Promise<AIChatAnswer> {
  const response = await structured<AIChatAnswer>(
    'email_verification_copilot', chatSchema,
    `You are the AI copilot inside an email verification application. Answer the user's question using ONLY the supplied verification evidence and history. Explain SMTP/provider ambiguity accurately. Never invent proof that a mailbox exists. If evidence is insufficient, say so explicitly. Keep the answer concise and operational.`,
    { question: question.slice(0, 1500), current: compactResult(result), recentHistory: history.slice(0, 8).map((x:any)=>({verdict:x.verdict,score:x.score,provider:x.provider,smtp_code:x.smtp_code,smtp_state:x.smtp_state,created_at:x.created_at})) }
  );
  return response.value;
}

export async function diagnoseBulk(payload: unknown): Promise<AIBulkDiagnosis> {
  const response = await structured<AIBulkDiagnosis>(
    'bulk_verification_diagnosis', bulkSchema,
    `You diagnose an email-verification bulk job using only supplied aggregate and sampled SMTP evidence. Identify rate limiting, greylisting, provider concentration, worker/IP degradation, or systematic classification issues when supported by evidence. Do not recommend bypassing provider protections. Prefer retry/backoff, reduced concurrency, MX fallback, or manual review.`,
    payload
  );
  return response.value;
}

export function aiConfigured() { return enabled(); }
export function aiModel() { return model(); }
export function aiWebSearchEnabled() { return webEnabled(); }
