# CloudMail Server — Self-Hosting Guide

This guide documents the current repository architecture and the supported production deployment path for open-source self-hosters.

## 1. Architecture

CloudMail is split into three operational boundaries:

```text
Browser / CloudMail Web
          │
          ▼
CloudMail Worker + Vue Assets
  │        │        │
  │        │        └── R2 / S3 (optional attachments)
  │        └─────────── KV (required)
  └──────────────────── D1 (required)
          │
          ├── Cloudflare Email Routing
          │
          └── scoped push webhook
                    │
                    ▼
             CF Mail Push Gateway
                    │
                    ▼
                 Apple APNs
```

`mail-vue` is built into `mail-worker/dist` and is served by Worker Assets. It is not a separate Cloudflare Pages deployment.

The Push Gateway is an independent trust boundary. A normal CloudMail Worker never receives the Apple APNs `.p8`, APNs Key ID, Team ID, or raw APNs device token. It stores only the scoped `subscriptionId + pushSecret` created for a CloudMail account.

## 2. Prerequisites

- Cloudflare account
- A domain managed by Cloudflare
- Node.js `22.23.2`
- pnpm `9.15.9`
- Wrangler from the Worker lockfile
- D1 and Workers KV
- Optional R2 or external S3 for attachment storage
- Cloudflare Email Routing if the server receives mail

Use the repository lockfiles and frozen installs in production:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate

cd mail-worker
pnpm install --frozen-lockfile

cd ../mail-vue
pnpm install --frozen-lockfile
```

## 3. Required Cloudflare resources

### D1

```bash
cd mail-worker
pnpm wrangler login
pnpm wrangler d1 create cloud-mail
```

The binding name is fixed by the application contract:

```toml
[[d1_databases]]
binding = "db"
database_name = "cloud-mail"
database_id = "YOUR_D1_DATABASE_ID"
migrations_dir = "migrations"
```

### Workers KV

```bash
pnpm wrangler kv namespace create cloud-mail
```

Binding:

```toml
[[kv_namespaces]]
binding = "kv"
id = "YOUR_KV_NAMESPACE_ID"
```

### R2 — optional

```bash
pnpm wrangler r2 bucket create cloud-mail-assets
```

```toml
[[r2_buckets]]
binding = "r2"
bucket_name = "cloud-mail-assets"
```

For long-lived or high-volume attachments, use R2 or S3 rather than treating KV as primary object storage.

## 4. Email Routing

Deploying the Worker does not automatically route inbound mail. Enable Cloudflare Email Routing for each receiving domain and route mail to the CloudMail Worker `email` handler.

Keep the configured `domain` / `DOMAIN` list aligned with the domains enabled in Email Routing.

## 5. Required secrets

Production requires three independent secrets of at least 32 characters:

```text
JWT_SECRET
INIT_SECRET
CONFIG_ENCRYPTION_KEY
```

They must be different values. Generate strong random values, for example:

```bash
openssl rand -hex 64
```

With Wrangler, set the corresponding Worker bindings:

```bash
pnpm wrangler secret put jwt_secret
pnpm wrangler secret put init_secret
pnpm wrangler secret put config_encryption_key
```

Never store these secrets in `wrangler.toml`, Vue `VITE_*` variables, the iOS bundle, README screenshots, or GitHub Actions logs.

Optional secrets include:

```text
LINUXDO_CLIENT_SECRET
RESEND_WEBHOOK_SECRET
CONFIG_ENCRYPTION_KEY_PREVIOUS
```

`CONFIG_ENCRYPTION_KEY_PREVIOUS` is only for a key-rotation window. Remove it after encrypted settings have been migrated and verified.

## 6. Common deployment variables

Typical repository/Worker variables:

```text
NAME=cloud-mail
DOMAIN=["example.com"]
ADMIN=admin@example.com
CUSTOM_DOMAIN=mail.example.com
D1_DATABASE_ID=...
KV_NAMESPACE_ID=...
R2_BUCKET_NAME=cloud-mail-assets
PASSWORD_PBKDF2_ITERATIONS=150000
PASSWORD_REHASH_ON_LOGIN=true
EMAIL_TRASH_RETENTION_DAYS=30
INIT_LOCKED=false
CFMAIL_PUSH_GATEWAY_URL=
```

`DOMAIN` is a JSON array. Multiple domains are supported:

```text
["example.com","example.net"]
```

`EMAIL_TRASH_RETENTION_DAYS=0` disables automatic physical cleanup of messages that have entered Trash; the production default is 30 days.

## 7. Local quality gates

### Worker

```bash
cd mail-worker
pnpm install --frozen-lockfile
pnpm test
pnpm audit:test
```

The audit gate covers runtime/security contracts, versioned D1 migration fixtures, initialization security, encrypted configuration secrets, Web session/CSRF/CSP contracts, email list/rich-email contracts, push webhook contracts, API versioning/OpenAPI, i18n, retention, and AI privacy behavior.

### Web

```bash
cd mail-vue
pnpm install --frozen-lockfile
pnpm audit:test
```

This covers unit/security contracts, API pagination, production hygiene, design tokens, accessibility, the `/mail/*` / `/admin/*` workspace split, production build, and preview smoke.

### Push Gateway

```bash
cd cfmail-push-gateway
pnpm install --frozen-lockfile
pnpm test
```

This includes APNs retry/cache behavior, rich notification contracts, App Attest verification, structured operations/retention contracts, and migration checks.

## 8. GitHub Actions deployment

The user-facing Cloudflare deployment entry point is:

```text
.github/workflows/cloudflare-deploy.yml
```

It calls the internal reusable workflow:

```text
.github/workflows/_deploy-cloudflare.yml
```

Because Vue is served through Worker Assets, backend and frontend are one atomic full-stack Worker deployment. Use `deploy-and-migrate` for the first deployment or schema upgrade; use `deploy` for ordinary updates. Separate backend/frontend wrappers are intentionally not kept because they would deploy the same Worker twice.

The deployment workflow:

1. validates secrets and variables;
2. performs frozen dependency installs;
3. runs Worker/Web audit gates;
4. builds and preview-smokes Vue;
5. emits SBOM/provenance/checksums;
6. resolves D1/KV resources;
7. renders a temporary Wrangler config without embedding secrets;
8. performs a Wrangler dry run;
9. deploys Worker + Assets atomically;
10. captures a pre-migration D1 recovery point;
11. invokes protected initialization when requested;
12. applies versioned D1 migrations;
13. requires a post-deploy readiness check.

## 9. Manual build and deploy

```bash
git clone https://github.com/readori/cloud-mail.git
cd cloud-mail

corepack enable
corepack prepare pnpm@9.15.9 --activate

cd mail-worker
pnpm install --frozen-lockfile

cd ../mail-vue
pnpm install --frozen-lockfile
pnpm run build

cd ../mail-worker
pnpm audit:test
pnpm wrangler deploy
```

For production, prefer the repository workflow because it also enforces recovery, migration, supply-chain, and readiness gates.

## 10. Initialization and migrations

The legacy URL-secret initializer is retired:

```text
GET /api/init/<secret> → 410 Gone
```

Use only:

```http
POST /api/init
X-Init-Secret: <INIT_SECRET>
```

Example:

```bash
BASE_URL="https://mail.example.com"

curl -fsS "$BASE_URL/api/health"

curl -fsS -X POST \
  -H "X-Init-Secret: $INIT_SECRET" \
  -H "Accept: text/plain" \
  "$BASE_URL/api/init"
```

After the legacy-compatible initialization step, repository migrations under `mail-worker/migrations/` apply durable industrial schema changes. The CI migration matrix must remain green for supported historical fixtures.

### Pre-migration recovery gate

Production CI captures both:

- a D1 Time Travel recovery point; and
- a private runner-local SQL export whose SHA-256 is recorded.

The SQL export can contain user/mail data and is deliberately not uploaded as a GitHub artifact. See `docs/OPERATIONS_RUNBOOK.md` for the restore procedure.

Use `INIT_LOCKED=true` outside explicit maintenance windows if your operational policy does not permit remote initialization at arbitrary times.

## 11. Health endpoints

Public coarse health:

```bash
curl -fsS https://mail.example.com/api/health
```

Expected shape:

```json
{
  "status": "ok",
  "service": "cloudmail",
  "ready": true
}
```

Detailed dependency readiness is intentionally not public. Authenticated administrators can use:

```text
GET /api/health/detail
```

Do not expose D1/KV/secret-presence details through the public health endpoint.

## 12. API compatibility and versioning

The current compatibility surface remains available under `/api/*`.

Versioned clients can use the `/api/v1/*` alias. Successful API responses expose:

```text
X-CloudMail-API-Version: 1
```

Machine-readable API documentation is available at:

```text
/api/openapi.json
/api/v1/openapi.json
```

Existing Cloud-Mail 3.0.0 compatibility remains a release contract; do not remove a legacy-compatible route merely because the v1 alias exists.

## 13. Web workspaces and CSP

Canonical Web routes are separated by responsibility:

```text
/mail/*   — daily mail workspace
/admin/*  — administration workspace
```

Legacy route aliases are retained for compatible navigation.

Production CSP is strict. Do not “fix” CSP errors by broadly adding `script-src 'unsafe-inline'` or `connect-src https:`. Keep allowlists explicit and preserve the audited theme bootstrap hash / approved third-party endpoints used by the current build.

## 14. Connecting CF Mail iOS

In CF Mail iOS, a self-hosted CloudMail account should use the server base URL:

```text
https://mail.example.com
```

Do not append `/api`; the client constructs API paths itself.

Production server requirements:

- HTTPS with a publicly valid certificate;
- successful public `/api/health` readiness;
- initialized D1/KV;
- working CloudMail user authentication;
- Email Routing configured when inbound mail is expected.

## 15. Push choices

Self-hosters have three supported operational choices.

### A. Official hosted CF Mail Push Gateway

```text
https://push.readori.com
```

The enhanced Worker defaults to this public service endpoint when no explicit override is supplied. The URL is not a secret.

### B. Self-hosted Gateway

Set:

```text
CFMAIL_PUSH_GATEWAY_URL=https://push.example.com
```

A self-hosted Gateway requires its own Apple Developer/APNs provider credentials and a Bundle ID that matches the iOS build.

### C. Disable remote push

Set the Worker configuration to the explicit disabled value supported by the current runtime:

```text
cfmail_push_gateway_url=disabled
```

Core mail/Web/API behavior continues without remote APNs delivery.

## 16. Push trust boundary

Registration flow:

```text
iOS --device token + App Attest--> Push Gateway
        │
        └── returns subscriptionId + pushSecret
                         │
                         ▼
                self-hosted CloudMail
                         │ new_mail + scoped secret
                         ▼
                    Push Gateway
                         │
                         ▼
                      Apple APNs
```

A CloudMail Worker must never be given:

```text
APNS_PRIVATE_KEY
APNS_KEY_ID
APNS_TEAM_ID
raw APNs device token
```

The official Gateway now supports App Attest challenge/attestation/assertion. New deployments should start in monitor mode, validate real-device telemetry, and then move to enforcement according to `docs/PUSH_GATEWAY_PRODUCTION_HARDENING.md`.

## 17. Self-hosting the Push Gateway

```bash
cd cfmail-push-gateway
pnpm install --frozen-lockfile
pnpm test

npx wrangler d1 create cfmail-push-gateway
npx wrangler queues create cfmail-apns-retry
npx wrangler queues create cfmail-apns-dead-letter
npm run db:migrate:remote

npx wrangler secret put APNS_KEY_ID
npx wrangler secret put APNS_TEAM_ID
npx wrangler secret put APNS_PRIVATE_KEY

npm run deploy
```

Configure:

```toml
[vars]
APNS_BUNDLE_ID = "com.example.cfmail"
APP_ATTEST_POLICY = "monitor"
APP_ATTEST_ALLOW_UNSUPPORTED = "1"
PUSH_SUBSCRIPTION_RETENTION_DAYS = "90"
```

After real-device App Attest validation, production can move `APP_ATTEST_POLICY` to `enforce`. Decide whether unsupported-device fallback remains allowed based on your support policy and observed telemetry.

## 18. Data retention

The repository defines configurable retention/cleanup behavior for Trash, cached/local client data, diagnostics, push subscriptions, App Attest challenges/keys, delivery deduplication, and operational logs. See:

```text
docs/DATA_RETENTION_POLICY.md
```

Retention must be treated as product/privacy configuration, not an undocumented cron side effect.

## 19. Production validation checklist

### Worker

```text
[ ] /api/health → ready=true
[ ] /api/health/detail works only for an authenticated administrator
[ ] D1/KV initialized
[ ] versioned migration gate passed
[ ] encrypted config-secret migration test passed
[ ] no GET /api/init/<secret> initialization path
```

### Web

```text
[ ] /mail/* workspace
[ ] /admin/* workspace for authorized admins
[ ] login/logout/session rotation
[ ] CSRF/origin protection
[ ] CSP has no blocking errors
[ ] malicious email HTML corpus cannot execute JavaScript or read the session
[ ] Light/Dark and supported theme presets
[ ] attachments / compose / mail detail
```

### Mail

```text
[ ] Email Routing
[ ] inbound mail
[ ] outbound mail
[ ] multiple configured domains if applicable
[ ] attachments
[ ] forwarding/rules used by the deployment
```

### iOS

```text
[ ] add server with HTTPS base URL
[ ] CloudMail login
[ ] inbox/detail/compose
[ ] attachment open/download
[ ] background refresh
[ ] capability negotiation
[ ] Cloud-Mail 3.0.0 fallback behavior
```

### Push — if enabled

```text
[ ] Gateway /healthz
[ ] App Attest monitor/enforce policy behaves as intended
[ ] subscription create/refresh/delete
[ ] CloudMail device registration
[ ] new_mail webhook
[ ] APNs physical-device delivery
[ ] retry queue
[ ] DLQ steady state near zero
[ ] logout unregister
```

## 20. Security red lines

Never commit or expose:

```text
APNS_PRIVATE_KEY
JWT_SECRET
INIT_SECRET
CONFIG_ENCRYPTION_KEY
CONFIG_ENCRYPTION_KEY_PREVIOUS
LINUXDO_CLIENT_SECRET
RESEND_WEBHOOK_SECRET
Cloudflare API Token
Apple AuthKey_*.p8
raw APNs device tokens
pushSecret values
```

The public `https://push.readori.com` endpoint is intentionally public; the credentials and user-scoped secrets behind it are not.

## 21. Upgrade / rollback runbook

For every production schema upgrade:

```text
Run audit tests
→ capture D1 recovery point
→ deploy Worker + Assets
→ POST /api/init in maintenance window when required
→ apply versioned migrations
→ verify /api/health
→ verify Web
→ verify iOS compatibility
→ verify push if enabled
```

On failure, stop the rollout and follow `docs/OPERATIONS_RUNBOOK.md`. Do not continue running later migrations over a failed/unknown schema state.
