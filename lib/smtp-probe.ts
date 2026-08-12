import net from 'node:net';
import { promises as dns } from 'node:dns';

export type SmtpCandidateProbe = {
  email: string;
  accepted: boolean;
  temporary: boolean;
  code: number | null;
  message: string;
  mx: string;
  durationMs: number;
};

export type SmtpFinderProbeResult = {
  providerMx: string | null;
  banner: string;
  ehlo: string;
  mailFrom: string;
  candidates: SmtpCandidateProbe[];
  attemptedMx: string[];
};

type Reply = { code: number | null; message: string };

function acceptedCode(code: number | null) {
  return code === 250 || code === 251 || code === 252;
}

function temporaryCode(code: number | null) {
  return code != null && code >= 400 && code < 500;
}

class SmtpSession {
  private socket: net.Socket;
  private buffer = '';
  private lines: string[] = [];
  private waiters: Array<() => void> = [];

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx + 1).replace(/\r?\n$/, '');
        this.buffer = this.buffer.slice(idx + 1);
        this.lines.push(line);
      }
      const waiters = this.waiters.splice(0);
      for (const wake of waiters) wake();
    });
  }

  private async waitForLine(timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (!this.lines.length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('SMTP response timeout');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = this.waiters.indexOf(wake);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new Error('SMTP response timeout'));
        }, remaining);
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.push(wake);
      });
    }
    return this.lines.shift() || '';
  }

  async readReply(timeoutMs: number): Promise<Reply> {
    const collected: string[] = [];
    let code: number | null = null;
    while (true) {
      const line = await this.waitForLine(timeoutMs);
      collected.push(line);
      const m = line.match(/^(\d{3})([ -])(.*)$/);
      if (!m) {
        if (collected.length > 20) break;
        continue;
      }
      code = Number(m[1]);
      if (m[2] === ' ') break;
      if (collected.length > 50) break;
    }
    return { code, message: collected.join('\n') };
  }

  async command(command: string, timeoutMs: number): Promise<Reply> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${command}\r\n`, (err) => (err ? reject(err) : resolve()));
    });
    return this.readReply(timeoutMs);
  }

  close() {
    this.socket.destroy();
  }
}

async function connect(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Connection timeout to ${host}:${port}`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP socket timeout')));
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function fullSmtpCandidateCheck(
  domain: string,
  emails: string[],
): Promise<SmtpFinderProbeResult> {
  const timeoutMs = Number(process.env.PING_EMAIL_TIMEOUT || 10000);
  const port = Number(process.env.PING_EMAIL_PORT || 25);
  const fqdn = process.env.PING_EMAIL_FQDN || 'mail.example.org';
  const sender = process.env.PING_EMAIL_SENDER || `verify@${fqdn.includes('.') ? fqdn : 'example.org'}`;

  const mxRecords = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority);
  if (!mxRecords.length) throw new Error('No MX records found');

  const attemptedMx: string[] = [];
  let lastError: unknown = null;

  for (const mx of mxRecords) {
    attemptedMx.push(mx.exchange);
    let session: SmtpSession | null = null;
    try {
      const socket = await connect(mx.exchange, port, timeoutMs);
      session = new SmtpSession(socket);

      const banner = await session.readReply(timeoutMs);
      if (banner.code == null || banner.code >= 400) throw new Error(`SMTP banner rejected: ${banner.message}`);

      let ehlo = await session.command(`EHLO ${fqdn}`, timeoutMs);
      if (ehlo.code == null || ehlo.code >= 400) {
        ehlo = await session.command(`HELO ${fqdn}`, timeoutMs);
      }
      if (ehlo.code == null || ehlo.code >= 400) throw new Error(`EHLO/HELO failed: ${ehlo.message}`);

      let mailFrom = await session.command(`MAIL FROM:<${sender}>`, timeoutMs);
      if (mailFrom.code == null || mailFrom.code >= 400) throw new Error(`MAIL FROM rejected: ${mailFrom.message}`);

      const candidates: SmtpCandidateProbe[] = [];
      for (const email of emails) {
        const started = Date.now();
        const rcpt = await session.command(`RCPT TO:<${email}>`, timeoutMs);
        candidates.push({
          email,
          accepted: acceptedCode(rcpt.code),
          temporary: temporaryCode(rcpt.code),
          code: rcpt.code,
          message: rcpt.message,
          mx: mx.exchange,
          durationMs: Date.now() - started,
        });

        // Reset the envelope before the next candidate, then establish MAIL FROM again.
        await session.command('RSET', timeoutMs).catch(() => ({ code: null, message: '' }));
        mailFrom = await session.command(`MAIL FROM:<${sender}>`, timeoutMs);
        if (mailFrom.code == null || mailFrom.code >= 400) {
          throw new Error(`MAIL FROM rejected while continuing probes: ${mailFrom.message}`);
        }

        const delay = Number(process.env.FINDER_SMTP_DELAY_MS || 300);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      }

      await session.command('QUIT', Math.min(timeoutMs, 3000)).catch(() => ({ code: null, message: '' }));
      session.close();

      return {
        providerMx: mx.exchange,
        banner: banner.message,
        ehlo: ehlo.message,
        mailFrom: mailFrom.message,
        candidates,
        attemptedMx,
      };
    } catch (error) {
      lastError = error;
      session?.close();
      continue;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to complete SMTP checks against any MX server');
}
