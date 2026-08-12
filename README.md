# coldmailpro emailverifier

**coldmailpro emailverifier** is a free, self-hosted email verification and mail-intelligence platform built with Next.js, TypeScript, MySQL, Redis/BullMQ, and SMTP/TLS diagnostics.

It is designed for single-email checks, bulk list verification, SMTP recipient testing, catch-all/opaque-provider analysis, domain intelligence, background worker processing, verification history, retries, and mail-infrastructure monitoring.

## Live Demo

**Demo:** https://emailverifier.coldmailpro.io/

You can try the hosted version before deploying your own instance.

---

## Table of Contents

1. [Features](#features)
2. [How It Works](#how-it-works)
3. [Technology Stack](#technology-stack)
4. [Server Requirements](#server-requirements)
5. [Important SMTP Requirement: Outbound Port 25](#important-smtp-requirement-outbound-port-25)
6. [Quick Installation](#quick-installation)
7. [Install System Dependencies](#install-system-dependencies)
8. [Clone the Project](#clone-the-project)
9. [Install Node.js Dependencies](#install-nodejs-dependencies)
10. [Configure MySQL](#configure-mysql)
11. [Configure Redis](#configure-redis)
12. [Configure Environment Variables](#configure-environment-variables)
13. [Initialize the Database](#initialize-the-database)
14. [Build the Application](#build-the-application)
15. [Run in Development Mode](#run-in-development-mode)
16. [Run in Production with systemd](#run-in-production-with-systemd)
17. [Nginx Reverse Proxy](#nginx-reverse-proxy)
18. [HTTPS with Let's Encrypt](#https-with-lets-encrypt)
19. [Firewall Configuration](#firewall-configuration)
20. [How to Use the Application](#how-to-use-the-application)
21. [API Examples](#api-examples)
22. [Understanding Verification Results](#understanding-verification-results)
23. [Bulk Verification](#bulk-verification)
24. [Email Finder](#email-finder)
25. [Domain Intelligence](#domain-intelligence)
26. [Worker Dashboard](#worker-dashboard)
27. [Domain Monitoring](#domain-monitoring)
28. [Logs and Troubleshooting](#logs-and-troubleshooting)
29. [Updating the Project](#updating-the-project)
30. [Backing Up](#backing-up)
31. [Publishing to GitHub](#publishing-to-github)
32. [Security](#security)
33. [SMTP Verification Limitations](#smtp-verification-limitations)
34. [License](#license)

---

# Features

### Email Verification

- Syntax validation
- Domain validation
- MX lookup
- SMTP recipient verification
- Multiple MX fallback
- Catch-all / accept-all detection
- Opaque-provider handling
- Disposable email detection
- Role-based email detection
- Free-email vs business-domain detection
- Provider identification
- Mailbox-full detection
- Greylisting / temporary failure detection
- SMTP response-code interpretation
- Verification scoring
- Verification history

### SMTP & TLS Diagnostics

- SMTP server connection
- SMTP banner capture
- EHLO/HELO capability detection
- MAIL FROM check
- RCPT TO check
- SMTP transcript
- STARTTLS detection
- TLS negotiation
- TLS version
- TLS cipher
- Certificate subject
- Certificate issuer
- Certificate validity dates
- Certificate fingerprint

### Bulk Verification

- Bulk email submission
- MySQL-backed job persistence
- Redis/BullMQ background processing
- Worker concurrency
- Job status tracking
- Deliverable / Risky / Undeliverable / Unknown totals
- Automatic temporary-error retries
- CSV-oriented workflow
- Persistent results
- Verification history

### Email Finder

The Email Finder generates common corporate-address candidates from:

```text
Full Name + Company Domain
```

Example:

```text
Filip Bartos
marketingblendz.com
```

Possible candidates include:

```text
filip@marketingblendz.com
filip.bartos@marketingblendz.com
fbartos@marketingblendz.com
filipb@marketingblendz.com
```

Every generated candidate is tested with direct SMTP evidence.

The finder does **not** use learned patterns or AI guessing. If exactly one candidate is accepted while the others are rejected, it can return that address. If the mail provider accepts multiple candidates indistinguishably, the result is marked **Inconclusive**.

### Domain Intelligence

- MX records
- MX priorities
- Mail-provider identification
- MX IP resolution
- SPF
- DMARC
- common DKIM selector discovery
- MTA-STS
- TLS-RPT
- BIMI
- mail-infrastructure graph
- SMTP/TLS diagnostics

### Operations

- Worker fleet status
- Redis/BullMQ queue statistics
- Throughput monitoring
- MySQL verification history
- Temporary-error retry scheduler
- Domain monitoring
- Domain-change history

---

# How It Works

A normal email verification follows approximately this flow:

```text
Email address
    |
    v
Syntax validation
    |
    v
Domain lookup
    |
    v
MX lookup
    |
    v
Provider detection
    |
    v
SMTP connection
    |
    +--> EHLO / HELO
    |
    +--> MAIL FROM
    |
    +--> RCPT TO
    |
    v
Catch-all / provider analysis
    |
    v
TLS / domain intelligence
    |
    v
Final verdict + evidence
```

Bulk verification uses a background queue:

```text
Browser / API
      |
      v
Next.js
      |
      +--> MySQL job
      |
      +--> BullMQ queue
               |
               v
             Redis
               |
               v
          Worker process
               |
               v
        SMTP verification
               |
               v
             MySQL
```

This means large jobs do not depend on a browser connection staying open.

---

# Technology Stack

- **Next.js 15**
- **React 19**
- **TypeScript**
- **Node.js**
- **MySQL / MariaDB**
- **Redis**
- **BullMQ 5**
- **ping-email**
- Native Node.js DNS, SMTP and TLS functionality

The package is marked `"private": true` in `package.json`. This prevents accidental publication to the npm registry; it does **not** prevent you from publishing the source code in a public GitHub repository.

---

# Server Requirements

Recommended production environment:

- Linux VPS or dedicated server
- 2+ CPU cores
- 2 GB RAM minimum
- 4 GB+ RAM recommended for larger jobs
- Node.js 20 or newer
- npm
- MySQL 8+ or a compatible MariaDB version
- Redis
- Git
- Nginx or another reverse proxy for production
- outbound TCP port 25 access
- a valid FQDN for SMTP EHLO/HELO

The included service files assume:

```text
/root/mj
```

as the application directory.

You may use another directory, but then update `WorkingDirectory` and `EnvironmentFile` in both systemd service files.

---

# Important SMTP Requirement: Outbound Port 25

The application performs direct SMTP recipient checks against destination MX servers.

Your server therefore normally needs outbound access to:

```text
TCP port 25
```

Many cloud/VPS providers restrict outbound SMTP.

Test connectivity:

```bash
nc -vz gmail-smtp-in.l.google.com 25
```

or:

```bash
telnet gmail-smtp-in.l.google.com 25
```

A successful connection should normally show an SMTP banner beginning with something similar to:

```text
220
```

If the connection times out or is blocked, SMTP verification will not work correctly.

Do **not** expose a mail relay or configure this server as an open relay. The application only needs outbound SMTP connectivity for verification.

---

# Quick Installation

If your server already has Node.js, MySQL, Redis and Git:

```bash
git clone https://github.com/YOUR_USERNAME/coldmailpro-emailverifier.git /root/mj
cd /root/mj

npm install

cp .env.example .env.local
nano .env.local

mysql -u root -p < database.sql

rm -rf .next
npm run build
```

Then install the systemd services:

```bash
cp email-verifier.service /etc/systemd/system/
cp email-verifier-worker.service /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now email-verifier
systemctl enable --now email-verifier-worker
```

The application runs on:

```text
http://127.0.0.1:3001
```

Use Nginx for public HTTPS access.

---

# Install System Dependencies

## AlmaLinux / Rocky Linux / RHEL-like systems

Install the basic services:

```bash
dnf install -y git mysql-server redis nginx
```

Enable them:

```bash
systemctl enable --now mysqld
systemctl enable --now redis
systemctl enable --now nginx
```

Install a supported Node.js release using your preferred Node.js installation method.

Verify:

```bash
node -v
npm -v
mysql --version
redis-server --version
nginx -v
```

Node.js 20+ is recommended.

## Ubuntu / Debian

Install the basic services:

```bash
apt update
apt install -y git mysql-server redis-server nginx
```

Enable them:

```bash
systemctl enable --now mysql
systemctl enable --now redis-server
systemctl enable --now nginx
```

Install Node.js 20+ using your preferred Node.js installation method.

Verify:

```bash
node -v
npm -v
mysql --version
redis-server --version
nginx -v
```

---

# Clone the Project

Example:

```bash
git clone https://github.com/YOUR_USERNAME/coldmailpro-emailverifier.git /root/mj
cd /root/mj
```

Verify:

```bash
pwd
ls -la
```

You should see files such as:

```text
package.json
app/
lib/
worker.ts
database.sql
.env.example
email-verifier.service
email-verifier-worker.service
```

---

# Install Node.js Dependencies

From the project directory:

```bash
cd /root/mj
npm install
```

Verify the important packages:

```bash
npm list next
npm list bullmq
npm list mysql2
npm list ping-email
```

The project currently uses BullMQ 5.x.

If you change BullMQ major versions, test the production build before deploying because queue connection behavior and optional dependencies may change.

---

# Configure MySQL

Secure MySQL according to your operating system's normal procedure.

Open MySQL:

```bash
mysql -u root -p
```

Create the database and application user.

Replace the password below with a strong random password:

```sql
CREATE DATABASE IF NOT EXISTS email_verifier
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS
  'email_verifier'@'127.0.0.1'
  IDENTIFIED BY 'CHANGE_THIS_TO_A_STRONG_PASSWORD';

GRANT ALL PRIVILEGES
  ON email_verifier.*
  TO 'email_verifier'@'127.0.0.1';

CREATE USER IF NOT EXISTS
  'email_verifier'@'localhost'
  IDENTIFIED BY 'CHANGE_THIS_TO_A_STRONG_PASSWORD';

GRANT ALL PRIVILEGES
  ON email_verifier.*
  TO 'email_verifier'@'localhost';

FLUSH PRIVILEGES;
```

Exit:

```sql
EXIT;
```

Test the application account:

```bash
mysql -h 127.0.0.1 -u email_verifier -p email_verifier
```

If this fails, fix the MySQL account before continuing.

---

# Configure Redis

The default configuration expects Redis at:

```text
127.0.0.1:6379
```

Test Redis:

```bash
redis-cli ping
```

Expected:

```text
PONG
```

If your Redis service is remote or password-protected, update:

```env
REDIS_URL=
```

accordingly.

Examples:

```env
REDIS_URL=redis://127.0.0.1:6379
```

or:

```env
REDIS_URL=redis://:PASSWORD@127.0.0.1:6379
```

Do not expose Redis directly to the public internet.

---

# Configure Environment Variables

Create the local configuration:

```bash
cd /root/mj
cp .env.example .env.local
nano .env.local
```

Example:

```env
# Application
PORT=3001

# SMTP identity
PING_EMAIL_PORT=25
PING_EMAIL_FQDN=mail.example.com
PING_EMAIL_SENDER=verify@example.com
PING_EMAIL_TIMEOUT=10000
PING_EMAIL_ATTEMPTS=2
PING_EMAIL_IGNORE_SMTP=false

# Catch-all checks
CATCH_ALL_ENABLED=true
CATCH_ALL_TESTS=2

# Bulk jobs
BULK_MAX_EMAILS=10000
BULK_DELAY_MS=150
WORKER_CONCURRENCY=2

# MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=email_verifier
DB_USER=email_verifier
DB_PASSWORD=CHANGE_THIS_TO_YOUR_DATABASE_PASSWORD
DB_POOL_SIZE=10

# Redis / BullMQ
REDIS_URL=redis://127.0.0.1:6379

# Email Finder
FINDER_SMTP_DELAY_MS=300

# SMTP diagnostics
SMTP_DIAGNOSTICS_ENABLED=true
SMTP_STARTTLS=true

# Temporary SMTP retry scheduler
GREYLIST_RETRY_MINUTES=5,30,120
GREYLIST_MAX_RETRIES=3
```

## Environment Variable Reference

### `PORT`

Next.js application port.

Default:

```env
PORT=3001
```

### `PING_EMAIL_PORT`

SMTP destination port.

Normally:

```env
PING_EMAIL_PORT=25
```

### `PING_EMAIL_FQDN`

The hostname used by your verifier when identifying itself during SMTP.

Use a real hostname that resolves appropriately for your server when possible:

```env
PING_EMAIL_FQDN=mail.example.com
```

Avoid using:

```text
localhost
```

for production SMTP verification.

### `PING_EMAIL_SENDER`

Envelope sender used for SMTP checks:

```env
PING_EMAIL_SENDER=verify@example.com
```

Use an address/domain you control.

### `PING_EMAIL_TIMEOUT`

SMTP timeout in milliseconds.

```env
PING_EMAIL_TIMEOUT=10000
```

### `PING_EMAIL_ATTEMPTS`

Number of attempts for verification operations:

```env
PING_EMAIL_ATTEMPTS=2
```

### `PING_EMAIL_IGNORE_SMTP`

Set to `true` if you intentionally want to skip direct SMTP verification:

```env
PING_EMAIL_IGNORE_SMTP=false
```

For full verification, leave it `false`.

### `CATCH_ALL_ENABLED`

Enable catch-all probing:

```env
CATCH_ALL_ENABLED=true
```

### `CATCH_ALL_TESTS`

Number of randomized recipient probes:

```env
CATCH_ALL_TESTS=2
```

More probes may improve evidence but also increase SMTP traffic.

### `BULK_MAX_EMAILS`

Maximum addresses accepted in one bulk job:

```env
BULK_MAX_EMAILS=10000
```

### `BULK_DELAY_MS`

Delay between worker verifications:

```env
BULK_DELAY_MS=150
```

Increase it if destination providers are throttling your server.

### `WORKER_CONCURRENCY`

Number of verification tasks processed concurrently by a worker:

```env
WORKER_CONCURRENCY=2
```

Start conservatively. Excessive SMTP concurrency can cause throttling.

### `DB_*`

MySQL connection configuration:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=email_verifier
DB_USER=email_verifier
DB_PASSWORD=YOUR_PASSWORD
DB_POOL_SIZE=10
```

### `REDIS_URL`

BullMQ/Redis connection:

```env
REDIS_URL=redis://127.0.0.1:6379
```

### `FINDER_SMTP_DELAY_MS`

Delay between Email Finder candidate probes:

```env
FINDER_SMTP_DELAY_MS=300
```

### `SMTP_DIAGNOSTICS_ENABLED`

Enable SMTP transcript and diagnostic collection:

```env
SMTP_DIAGNOSTICS_ENABLED=true
```

### `SMTP_STARTTLS`

Attempt STARTTLS when the destination MX supports it:

```env
SMTP_STARTTLS=true
```

### `GREYLIST_RETRY_MINUTES`

Retry schedule for temporary SMTP responses:

```env
GREYLIST_RETRY_MINUTES=5,30,120
```

### `GREYLIST_MAX_RETRIES`

Maximum automatic temporary retries:

```env
GREYLIST_MAX_RETRIES=3
```

---

# Initialize the Database

For a fresh installation:

```bash
cd /root/mj
mysql -u root -p < database.sql
```

`database.sql` creates the application tables, including:

```text
verification_jobs
verification_results
worker_nodes
monitored_domains
domain_monitor_snapshots
email_verification_history
verification_retries
```

You can verify them with:

```bash
mysql -u root -p -e "USE email_verifier; SHOW TABLES;"
```

## Upgrading from an Older Version

Do not blindly run every migration repeatedly without understanding your current version.

The repository may include migration files such as:

```text
migration-v4.sql
migration-v5.sql
```

For a new installation, `database.sql` already contains the current schema.

For an existing installation, back up the database first and apply only migrations relevant to the version you are upgrading from.

---

# Build the Application

Run:

```bash
cd /root/mj
rm -rf .next
npm run build
```

A successful build should complete the Next.js compilation and type checking.

Do not deploy a build that still contains TypeScript or webpack errors.

---

# Run in Development Mode

For local development:

```bash
cd /root/mj
npm run dev
```

The application will be available at:

```text
http://SERVER-IP:3001
```

Development mode should not be used as the normal production process.

---

# Run in Production with systemd

The project contains two service files:

```text
email-verifier.service
email-verifier-worker.service
```

The first runs Next.js.

The second runs the BullMQ background worker.

Install:

```bash
cd /root/mj

cp email-verifier.service /etc/systemd/system/
cp email-verifier-worker.service /etc/systemd/system/

systemctl daemon-reload

systemctl enable --now email-verifier
systemctl enable --now email-verifier-worker
```

Check:

```bash
systemctl status email-verifier
systemctl status email-verifier-worker
```

Restart after an application update:

```bash
systemctl restart email-verifier
systemctl restart email-verifier-worker
```

## Service Assumptions

The included service files use:

```ini
User=root
WorkingDirectory=/root/mj
EnvironmentFile=/root/mj/.env.local
```

If you install the app elsewhere, edit both service files.

For example:

```ini
User=emailverifier
WorkingDirectory=/opt/coldmailpro-emailverifier
EnvironmentFile=/opt/coldmailpro-emailverifier/.env.local
```

Then run:

```bash
systemctl daemon-reload
```

---

# Nginx Reverse Proxy

The Next.js service runs on port `3001`.

For production, expose Nginx on ports 80/443 and proxy to:

```text
127.0.0.1:3001
```

Create:

```bash
nano /etc/nginx/conf.d/emailverifier.example.com.conf
```

Example configuration:

```nginx
server {
    listen 80;

    server_name emailverifier.example.com;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3001;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

Test:

```bash
nginx -t
```

Reload:

```bash
systemctl reload nginx
```

## IPv6-disabled servers

If your server does not support IPv6, do **not** add:

```nginx
listen [::]:80;
```

Otherwise Nginx may fail with:

```text
socket() [::]:80 failed (97: Address family not supported by protocol)
```

The IPv4-only configuration above avoids that issue.

## Test the reverse proxy

First test Next.js directly:

```bash
curl -I http://127.0.0.1:3001
```

Then test Nginx:

```bash
curl -I http://emailverifier.example.com
```

---

# HTTPS with Let's Encrypt

After DNS points to your server and HTTP works, obtain an SSL certificate using Certbot or your preferred ACME client.

A common Nginx setup is:

```bash
certbot --nginx -d emailverifier.example.com
```

After HTTPS is configured:

```bash
curl -I https://emailverifier.example.com
```

If you use cPanel, Plesk, CloudPanel, a hosting control panel, or a managed reverse proxy, use that platform's supported SSL/vhost workflow instead of manually overwriting managed Nginx configuration.

---

# Firewall Configuration

The public web application normally needs inbound:

```text
80/tcp
443/tcp
```

The Next.js port:

```text
3001
```

does not need to be publicly exposed if Nginx proxies to localhost.

MySQL:

```text
3306
```

and Redis:

```text
6379
```

should normally remain private/local.

SMTP verification requires **outbound** TCP port 25.

For firewalld-based systems, a typical public-web setup is:

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

Do not open MySQL or Redis publicly unless you specifically need remote access and have secured them appropriately.

---

# How to Use the Application

Open your deployed URL.

Example:

**https://emailverifier.coldmailpro.io/**

The dashboard provides several areas.

---

## Verify

Use this for one email address.

1. Enter an email address.
2. Keep SMTP verification enabled for a full check.
3. Start verification.
4. Review the verdict, score and evidence.

The application may display:

```text
Deliverable
Risky
Undeliverable
Unknown
```

It can also show:

```text
Syntax
MX
Provider
SMTP
Catch-all status
Disposable
Role account
SPF
DMARC
STARTTLS
TLS version
SMTP transcript
```

---

# API Examples

These endpoints are part of the current project implementation. If you expose the application publicly, add authentication/rate limiting appropriate to your deployment before treating them as a public commercial API.

## Verify one email

```bash
curl -X POST https://emailverifier.example.com/api/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user@example.com",
    "ignoreSMTP": false
  }'
```

## Domain intelligence

```bash
curl -X POST https://emailverifier.example.com/api/domain-intelligence \
  -H 'Content-Type: application/json' \
  -d '{
    "domain": "example.com"
  }'
```

## Email Finder

```bash
curl -X POST https://emailverifier.example.com/api/email-finder \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "John Smith",
    "domain": "example.com"
  }'
```

## Create a bulk verification job

```bash
curl -X POST https://emailverifier.example.com/api/bulk-verify \
  -H 'Content-Type: application/json' \
  -d '{
    "emails": [
      "user1@example.com",
      "user2@example.com"
    ],
    "ignoreSMTP": false
  }'
```

A successful request returns a job ID.

Use the job endpoints/UI to follow progress.

---

# Understanding Verification Results

## Deliverable

The available evidence strongly supports delivery.

## Risky

The address/domain has positive signals but contains ambiguity or risk.

Examples can include:

```text
catch-all domain
opaque recipient validation
role account
other provider-specific uncertainty
```

## Undeliverable

The evidence indicates a permanent failure, such as a rejected recipient.

## Unknown

The system cannot make a reliable decision.

Common causes:

```text
greylisting
temporary SMTP errors
timeouts
rate limiting
provider anti-enumeration behavior
```

Do not automatically treat `Unknown` as `Invalid`.

---

# Catch-All and Opaque Providers

A simplistic verifier may assume:

```text
target address accepted
+
random address accepted
=
catch-all
```

That can be misleading.

Large providers and security gateways may obscure recipient existence.

The application therefore distinguishes ambiguous behavior instead of pretending that every accepted RCPT response proves mailbox existence.

A server can accept a recipient during SMTP and reject/bounce later.

---

# Bulk Verification

Bulk checks are queued through BullMQ and processed by the worker.

Flow:

```text
Upload / submit addresses
        |
        v
Create MySQL job
        |
        v
Queue in Redis
        |
        v
Worker processes addresses
        |
        v
Results stored in MySQL
```

Make sure both services are running:

```bash
systemctl status email-verifier
systemctl status email-verifier-worker
```

If jobs remain queued forever, check:

```bash
redis-cli ping
journalctl -u email-verifier-worker -f
```

---

# Email Finder

Email Finder takes:

```text
Full Name
Company Domain
```

and generates possible corporate email addresses.

Each candidate is checked directly by SMTP.

### Example

Input:

```text
Name: John Smith
Domain: example.com
```

Possible candidates:

```text
john@example.com
john.smith@example.com
jsmith@example.com
johns@example.com
```

If exactly one candidate receives a positive SMTP response while the rest are rejected, it can be returned as the SMTP-found candidate.

If several candidates receive indistinguishable accepting responses, the finder reports:

```text
Inconclusive
```

This is intentional.

The project does not use learned domain patterns or AI guessing to pretend that one candidate is correct.

---

# Domain Intelligence

Enter a domain such as:

```text
example.com
```

The application can inspect:

```text
MX
MX priority
provider
MX IPs
SPF
DMARC
common DKIM selectors
MTA-STS
TLS-RPT
BIMI
SMTP
STARTTLS
TLS certificate
```

This is useful for troubleshooting mail infrastructure as well as email verification.

---

# Worker Dashboard

The worker dashboard helps confirm that asynchronous processing is healthy.

It can display information such as:

```text
online workers
queue waiting
queue active
queue delayed
failed jobs
completed jobs
processed totals
worker heartbeat
```

If a worker shows offline:

```bash
systemctl status email-verifier-worker
journalctl -u email-verifier-worker -n 200 --no-pager
```

---

# Domain Monitoring

Domains can be added for periodic monitoring.

The worker checks due domains and stores snapshots in MySQL.

Changes may include:

```text
MX changes
SPF changes
DMARC changes
SMTP availability changes
TLS changes
mail-provider changes
```

Monitoring intervals are configured from the GUI.

The worker process must remain running for monitoring to work.

---

# Logs and Troubleshooting

## Next.js application logs

```bash
journalctl -u email-verifier -f
```

Recent logs:

```bash
journalctl -u email-verifier -n 200 --no-pager
```

## Worker logs

```bash
journalctl -u email-verifier-worker -f
```

Recent:

```bash
journalctl -u email-verifier-worker -n 200 --no-pager
```

## Check application port

```bash
ss -lntp | grep 3001
```

## Test Next.js locally

```bash
curl -I http://127.0.0.1:3001
```

## Check Redis

```bash
redis-cli ping
```

Expected:

```text
PONG
```

## Check MySQL

```bash
mysql -h 127.0.0.1 -u email_verifier -p email_verifier
```

## Check services

```bash
systemctl status mysqld
systemctl status redis
systemctl status nginx
systemctl status email-verifier
systemctl status email-verifier-worker
```

On Ubuntu/Debian, service names may instead be:

```text
mysql
redis-server
```

## `using password: NO`

If the worker reports:

```text
Access denied ... (using password: NO)
```

confirm:

```bash
grep '^DB_' /root/mj/.env.local
```

and make sure the worker service contains:

```ini
EnvironmentFile=/root/mj/.env.local
```

The project's worker script also loads `.env.local`.

## Next.js detects `/root/package-lock.json`

If you see:

```text
Next.js inferred your workspace root...
Detected additional lockfiles:
/root/package-lock.json
/root/mj/package-lock.json
```

this is usually a warning rather than a build failure.

If `/root/package-lock.json` is an accidental unrelated file, move it out of the way:

```bash
mv /root/package-lock.json /root/package-lock.json.backup
```

Do this only if that lockfile is not needed by another project.

## SMTP timeouts

Check outbound port 25:

```bash
nc -vz gmail-smtp-in.l.google.com 25
```

Also check firewall/provider restrictions.

## Jobs stuck in queue

Check Redis and worker:

```bash
redis-cli ping
systemctl status email-verifier-worker
journalctl -u email-verifier-worker -f
```

## Nginx IPv6 error

If Nginx says:

```text
socket() [::]:80 failed (97: Address family not supported by protocol)
```

remove IPv6 listeners such as:

```nginx
listen [::]:80;
listen [::]:443 ssl;
```

when IPv6 is disabled on the host.

---

# Updating the Project

Before updating:

```bash
cp -a /root/mj /root/mj-backup-$(date +%Y%m%d-%H%M%S)
```

Back up the database:

```bash
mysqldump -u root -p email_verifier > /root/email_verifier-backup.sql
```

Pull the latest code:

```bash
cd /root/mj
git pull
```

Install updated dependencies:

```bash
npm install
```

Review any new migration files.

Build:

```bash
rm -rf .next
npm run build
```

Only restart services after the build succeeds:

```bash
systemctl restart email-verifier
systemctl restart email-verifier-worker
```

Check:

```bash
systemctl status email-verifier
systemctl status email-verifier-worker
```

---

# Backing Up

## Application

```bash
tar -czf /root/coldmailpro-emailverifier-backup.tar.gz /root/mj
```

## MySQL

```bash
mysqldump -u root -p email_verifier > /root/email_verifier.sql
```

Redis contains queue state, but MySQL holds persistent job/result/history information.

---

# Publishing to GitHub

Never publish `.env.local`.

The repository `.gitignore` should contain at least:

```gitignore
node_modules
.next
.env
.env.local
npm-debug.log*
.DS_Store
```

Initialize Git:

```bash
cd /root/mj

git init
git branch -M main
git add .
git status
git commit -m "Initial release of coldmailpro emailverifier"
```

Create a public repository on GitHub, for example:

```text
coldmailpro-emailverifier
```

Then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/coldmailpro-emailverifier.git
git push -u origin main
```

For future updates:

```bash
git add .
git commit -m "Describe the update"
git push
```

Before every push:

```bash
git status
```

Check carefully that no credential file has been staged.

---

# Security

This project talks directly to external mail servers and should be operated responsibly.

Recommended production protections:

- Keep `.env.local` private.
- Never commit database passwords.
- Do not expose Redis publicly.
- Do not expose MySQL publicly unless required and secured.
- Put Nginx in front of Next.js.
- Keep the OS and Node.js dependencies patched.
- Apply application/API rate limits.
- Use conservative SMTP concurrency.
- Monitor SMTP failures and temporary blocks.
- Use a hostname/domain you control for SMTP identity.
- Avoid turning the system into an open public mailbox-enumeration service without abuse controls.
- Back up MySQL before upgrades.
- Review `npm audit` findings before using `npm audit fix --force`; forced upgrades may introduce breaking dependency changes.

---

# SMTP Verification Limitations

SMTP verification is evidence-based, not magic.

A `250` RCPT response does not always prove that a mailbox is currently active.

Providers may:

- accept mail and bounce later
- use catch-all routing
- obscure recipient enumeration
- temporarily greylist
- rate-limit repeated probes
- return policy-based responses
- behave differently depending on source IP reputation

This is particularly relevant for large hosted providers and security gateways.

The software therefore exposes underlying evidence rather than claiming every address can always be classified with absolute certainty.

A legitimate email may still appear:

```text
Risky
Unknown
Inconclusive
```

when the destination provider prevents deterministic SMTP verification.

---

# Responsible Use

Use the software only for legitimate email hygiene, infrastructure diagnostics, consented datasets, account validation, CRM cleanup, or other lawful purposes.

Respect:

- destination mail-server policies
- applicable privacy and anti-spam laws
- provider rate limits
- user consent requirements
- suppression / do-not-contact obligations

---

# Removed Integrations

This release intentionally does **not** include:

```text
AI Verification Copilot
Google Search Evidence
Google PSE integration
OpenAI integration
```

The core project remains SMTP/DNS/TLS focused.

---

# Project Structure

A simplified overview:

```text
app/
  api/
    verify/
    bulk-verify/
    email-finder/
    domain-intelligence/
    jobs/
    monitoring/
    system-status/

lib/
  db.ts
  queue.ts
  verifier.ts
  smtp diagnostics / provider logic / domain intelligence

worker.ts
database.sql
migration-*.sql

email-verifier.service
email-verifier-worker.service

.env.example
package.json
README.md
```

---

# Default Commands Reference

Install:

```bash
npm install
```

Development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Production web server:

```bash
npm start
```

Background worker:

```bash
npm run worker
```

Restart production:

```bash
systemctl restart email-verifier
systemctl restart email-verifier-worker
```

Watch logs:

```bash
journalctl -u email-verifier -f
journalctl -u email-verifier-worker -f
```

---

# Live Demo

Try **coldmailpro emailverifier** here:

**https://emailverifier.coldmailpro.io/**

---

# Contributing

Contributions are welcome if you publish this project as an open-source repository.

A typical workflow:

```bash
git checkout -b feature/my-improvement
# make changes
npm run build
git add .
git commit -m "Add my improvement"
git push origin feature/my-improvement
```

Then open a pull request.

Please test changes before submitting them, especially changes to SMTP, BullMQ, MySQL schema, and provider-specific logic.

---

# License

Choose a license before publishing the repository publicly.

Common options include:

- MIT
- Apache-2.0
- GPL-3.0

If you want people to freely use, modify and redistribute the project with minimal restrictions, MIT is a common choice.

---

# Credits

**coldmailpro emailverifier**

Live demo:

**https://emailverifier.coldmailpro.io/**

Built for practical SMTP verification, email-list hygiene and mail-infrastructure diagnostics.
