# coldmailpro emailverifier

SMTP-focused email intelligence platform built with Next.js, MySQL, Redis/BullMQ and ping-email.

## Included

- Single email verification
- SMTP recipient checks
- Catch-all / opaque-provider handling
- SMTP transcript and TLS diagnostics
- Email Finder using direct SMTP evidence only
- Domain Intelligence (MX, SPF, DMARC, DKIM, MTA-STS, TLS-RPT, BIMI)
- Bulk verification with MySQL persistence
- Redis/BullMQ background workers
- Worker fleet and throughput dashboard
- Automatic temporary/greylist retries
- Verification history and comparison
- Domain monitoring and mail-infrastructure graph

## Removed

This build intentionally does not include the AI Verification Copilot or Google Search Evidence/PSE integration.

## Deployment path

The application is intended to run from:

```text
/root/mj
```

## Install

```bash
cd /root/mj
npm install
rm -rf .next
npm run build
```

The app runs on port 3001.

## Services

Existing service names are retained for upgrade compatibility:

```bash
systemctl restart email-verifier
systemctl restart email-verifier-worker
```

## Database

For an existing v4/v5-compatible installation, retain the existing MySQL database. Migration files are included for reference.
