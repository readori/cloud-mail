# CloudMail Self-Hosting Deployment Guide — Current Backend, Web and iOS Integration

> This guide is written for open-source self-hosters and follows the current CloudMail architecture: `mail-worker` + `mail-vue` are deployed as one Cloudflare Workers full-stack application; D1 and KV are required, R2 is optional; CF Mail iOS connects to the user's CloudMail API; remote notifications are handled by the separate `cfmail-push-gateway`.
>
> **Push-service note:** the official CF Mail app currently uses the public hosted Push Gateway at `https://push.readori.com`. The URL itself is a public service endpoint, not a secret. What must remain private are the Apple APNs `.p8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, Cloudflare API tokens, Gateway database/internal credentials, and other private infrastructure secrets. Self-hosters may use the official Gateway, operate their own Gateway, or disable remote push.

---

## 1. Current project structure

```text
cloud-mail/
├── mail-worker/                 # Cloudflare Worker backend, APIs, Email handler and Worker Assets
├── mail-vue/                    # Vue web frontend
├── cfmail-push-gateway/         # Independent APNs Push Gateway
├── mail-ios/                    # CF Mail iOS client
└── .github/workflows/           # GitHub Actions
```

### 1.1 `mail-worker`

Responsibilities include:

- `/api/*` backend APIs
- users, accounts, messages, settings and permissions
- Cloudflare Email Routing `email` handler
- D1 access
- KV sessions, caching and rate limiting
- R2 / S3 / KV attachment storage
- Worker-hosted web assets
- initialization and database migrations
- CloudMail-to-Gateway push webhooks
- health checks

### 1.2 `mail-vue`

The Vue frontend is **not** intended to be deployed separately to Cloudflare Pages.

The current build flow runs:

```bash
cd mail-vue
pnpm run build
```

The generated assets are then served by `mail-worker` through Workers Assets.

The production origin therefore looks like:

```text
Browser
   │
   ├── /             → Vue / Worker Assets
   └── /api/*        → mail-worker APIs
```

Keeping both on the same origin also avoids an unnecessary separate CORS deployment.

### 1.3 `cfmail-push-gateway`

This is an independent Worker and is optional for a normal CloudMail self-host.

Its responsibility boundary is:

```text
CF Mail iOS
    │ APNs device token
    ▼
Push Gateway
    │ subscriptionId + pushSecret
    ▼
CloudMail Server
    │ new_mail webhook
    ▼
Push Gateway
    │
    ▼
Apple APNs
```

A normal self-hosted CloudMail Worker should **not** store an Apple `.p8` key or raw APNs device token.

---

# 2. Prerequisites

Recommended:

- Cloudflare account
- a domain managed by Cloudflare
- a fork or clone of the repository
- Node.js 22
- pnpm 9.15.x
- Wrangler
- optional Apple Developer account only if you are rebuilding iOS and operating your own Push Gateway

Install pnpm:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
```

Verify:

```bash
node --version
pnpm --version
```

---

# 3. Cloudflare resources

## 3.1 D1 — required

CloudMail uses D1 for its primary relational data, including:

- users
- mail accounts
- messages
- system settings
- permissions
- invite codes
- push subscriptions
- other application records

Create it:

```bash
cd mail-worker
pnpm wrangler login
pnpm wrangler d1 create cloud-mail
```

Save the returned:

```text
database_id
```

The Worker binding must remain:

```toml
binding = "db"
```

Do not arbitrarily rename it to `DB`, `database`, etc.

---

## 3.2 Workers KV — required

KV is used for:

- sessions
- settings cache
- rate-limit state
- temporary/public tokens
- runtime caches
- storage fallback when R2 is not configured

Create it:

```bash
pnpm wrangler kv namespace create cloud-mail
```

Save the namespace ID.

The binding must remain:

```toml
binding = "kv"
```

---

## 3.3 R2 — optional but recommended

For larger attachment workloads:

```bash
pnpm wrangler r2 bucket create cloud-mail-assets
```

Recommended binding:

```toml
[[r2_buckets]]
binding = "r2"
bucket_name = "cloud-mail-assets"
```

Without R2, the current project can fall back to other storage paths, and an external S3 service can also be configured through the admin UI.

For production systems with many or long-lived attachments, prefer R2 or S3 over long-term KV fallback.

---

# 4. Cloudflare Email Routing

Deploying the Worker alone does not make the domain receive email.

In Cloudflare Dashboard enable:

```text
Email → Email Routing
```

Create routes that deliver inbound mail to the CloudMail Worker.

The project already exports an `email` handler, but Cloudflare still needs a routing rule.

Typical flow:

```text
MX / Email Routing
        │
        ▼
Cloudflare Email
        │
        ▼
CloudMail Worker email handler
        │
        ▼
D1 / R2 / KV
```

For multiple inbound domains, keep the `DOMAIN` configuration aligned with Email Routing.

---

# 5. Required secrets

Never commit secrets to:

```text
wrangler.toml
GitHub Actions YAML
README files
public repositories
```

Use:

```bash
wrangler secret put
```

or GitHub Repository Secrets.

## 5.1 `JWT_SECRET`

Used for CloudMail authentication/session/JWT security.

Use at least 32 characters; a 64-byte random value is recommended:

```bash
openssl rand -hex 64
```

Worker secret:

```bash
pnpm wrangler secret put jwt_secret
```

GitHub Secret:

```text
JWT_SECRET
```

---

## 5.2 `INIT_SECRET`

Protects:

```text
POST /api/init
```

It must be different from `JWT_SECRET`.

Generate:

```bash
openssl rand -hex 64
```

Set:

```bash
pnpm wrangler secret put init_secret
```

GitHub Secret:

```text
INIT_SECRET
```

---

## 5.3 `CONFIG_ENCRYPTION_KEY`

The current hardened backend uses this key to protect dynamically stored integration secrets.

Requirements:

- at least 32 characters
- different from `JWT_SECRET`
- different from `INIT_SECRET`
- never store it in `[vars]`

Set:

```bash
pnpm wrangler secret put config_encryption_key
```

GitHub Secret:

```text
CONFIG_ENCRYPTION_KEY
```

### Key rotation

During a rotation window, temporarily configure:

```text
CONFIG_ENCRYPTION_KEY_PREVIOUS
```

After initialization/migration has re-encrypted legacy values and you have verified the deployment, remove the previous key.

---

# 6. Common Variables / Repository Variables

Depending on enabled features:

```text
NAME
DOMAIN
ADMIN
CUSTOM_DOMAIN
D1_DATABASE_ID
KV_NAMESPACE_ID
R2_BUCKET_NAME
PROJECT_LINK
AI_MODEL
ANALYSIS_CACHE
CF_EMAIL
LINUXDO_CLIENT_ID
LINUXDO_CALLBACK_URL
LINUXDO_SWITCH
CFMAIL_PUSH_GATEWAY_URL
```

Example:

```text
NAME=cloud-mail
DOMAIN=["example.com"]
ADMIN=admin@example.com
CUSTOM_DOMAIN=mail.example.com
R2_BUCKET_NAME=cloud-mail-assets
```

`DOMAIN` is a JSON array:

```text
["example.com"]
```

Multiple domains:

```text
["example.com","example.net"]
```

---

# 7. Optional secrets

Depending on features:

```text
LINUXDO_CLIENT_SECRET
RESEND_WEBHOOK_SECRET
CONFIG_ENCRYPTION_KEY_PREVIOUS
```

Keep them in Worker Secrets / GitHub Secrets.

---

# 8. Local installation and QA

Clone:

```bash
git clone https://github.com/readori/cloud-mail.git
cd cloud-mail
```

## 8.1 Backend

```bash
cd mail-worker
pnpm install --frozen-lockfile
```

Before production deployment, run the security and contract tests available in the current package:

```bash
pnpm run runtime:test
pnpm run security:test
pnpm run security:migration-test
pnpm run init:security-test
pnpm run config-secret:test
pnpm run web-session:test
pnpm run secret-storage:test
pnpm run rich-email:test
pnpm run email:list:test
pnpm run push:contract-test
```

If a script does not exist in your fork/revision, use the scripts actually defined by that revision's `package.json`.

## 8.2 Web

```bash
cd ../mail-vue
pnpm install --frozen-lockfile
pnpm run security:test
pnpm run contract:test
pnpm run build
```

The build should produce the `dist` assets consumed by the Worker.

---

# 9. GitHub Actions deployment

In the cleaned current repository, prefer one Cloudflare deployment entry point such as:

```text
.github/workflows/cloudflare-deploy.yml
```

It may call the reusable deployment workflow:

```text
.github/workflows/_deploy-cloudflare.yml
```

In GitHub:

```text
Repository
→ Settings
→ Secrets and variables
→ Actions
```

Add the required Secrets and Variables.

Then:

```text
Actions
→ Cloudflare Deploy
→ Run workflow
```

For the first deployment, use the mode that also initializes/migrates the database, for example:

```text
deploy-and-migrate
```

For ordinary later deployments:

```text
deploy
```

> Workflow names may differ in forks. Follow the actual files under `.github/workflows/`, and avoid keeping multiple duplicate backend/frontend deployment wrappers that perform the same deployment.

---

# 10. Manual Wrangler deployment

If you do not use GitHub Actions:

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
```

Ensure the Wrangler configuration contains:

```toml
[[d1_databases]]
binding = "db"
database_name = "cloud-mail"
database_id = "YOUR_D1_DATABASE_ID"

[[kv_namespaces]]
binding = "kv"
id = "YOUR_KV_NAMESPACE_ID"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
run_worker_first = true
```

Optional R2:

```toml
[[r2_buckets]]
binding = "r2"
bucket_name = "cloud-mail-assets"
```

Upload secrets:

```bash
pnpm wrangler secret put jwt_secret
pnpm wrangler secret put init_secret
pnpm wrangler secret put config_encryption_key
```

Deploy:

```bash
pnpm wrangler deploy
```

---

# 11. Initialization and database migrations

Do not use a production URL containing the initialization secret, such as:

```text
GET /api/init/<secret>
```

Use the protected header-based endpoint:

```text
POST /api/init
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

Expected response:

```text
success
```

The initialization flow is intended to cover:

- first-time schema creation
- database upgrades
- security migrations
- push-subscription schema upgrades
- encrypted-config migration

After production migrations, you can use the project's `INIT_LOCKED` maintenance policy to restrict initialization.

---

# 12. Health check

CloudMail:

```bash
curl -fsS https://mail.example.com/api/health
```

A healthy result should resemble:

```json
{
  "status": "ok",
  "ready": true,
  "checks": {
    "d1": true,
    "kv": true,
    "jwtSecret": true,
    "initSecret": true
  }
}
```

Important:

```text
HTTP 200 does not automatically mean ready=true.
```

Verify at minimum:

```text
ready = true
d1 = true
kv = true
jwtSecret = true
initSecret = true
```

---

# 13. Web production validation

Open:

```text
https://mail.example.com
```

Verify:

1. Home page loads.
2. `/login` loads.
3. Login succeeds.
4. Browser console has no blocking CSP errors.
5. `/api/*` works on the same origin.
6. Light/Dark themes work.
7. Iconify icons load.
8. Cloudflare Turnstile works when enabled.
9. Attachment upload/download works.
10. Sending and receiving mail works.

With a strict CSP, whitelist only required origins. Do not solve errors by broadly enabling:

```text
script-src 'unsafe-inline'
connect-src https:
```

---

# 14. iOS connection to a self-hosted CloudMail server

CF Mail iOS connects directly to the user's own CloudMail Server.

When adding a server, enter:

```text
Server URL:
https://mail.example.com
```

Do not enter:

```text
https://mail.example.com/api
```

The client appends `/api/*` itself.

Recommended server requirements:

- HTTPS
- publicly valid certificate
- no self-signed production certificate
- working `/api/health`
- successful Web login
- initialized D1 / KV
- existing user account

---

# 15. iOS authentication flow

Typical flow:

```text
CF Mail iOS
   │
   ├── Server URL
   │
   ▼
https://mail.example.com
   │
   ▼
/api/login
   │
   ▼
JWT / authenticated CloudMail session
```

iOS consumes CloudMail APIs, not the Web page DOM.

Web and iOS share backend business data, but they can have different client authentication behavior. Do not make iOS compatibility depend on a Web `localStorage` token.

---

# 16. Push Gateway privacy architecture

This is an important security boundary in the current design.

## 16.1 What must not go to a normal CloudMail server

A self-hosted CloudMail Worker should not receive:

```text
Apple .p8
APNS_KEY_ID
APNS_TEAM_ID
raw APNs device token
```

Those belong only to the independent Push Gateway.

## 16.2 Current flow

### Step 1: iOS → Gateway

```http
POST https://push.readori.com/v1/subscriptions
```

Example:

```json
{
  "deviceToken": "<APNs token>",
  "installationId": "<installation UUID>",
  "accountId": "<local CloudMail profile UUID>",
  "environment": "production"
}
```

Gateway response:

```json
{
  "subscriptionId": "ps_...",
  "pushSecret": "pgs_..."
}
```

iOS stores the scoped credential in Keychain.

### Step 2: iOS → self-hosted CloudMail

```http
POST https://mail.example.com/api/device/register
```

Payload:

```json
{
  "subscriptionId": "ps_...",
  "pushSecret": "pgs_...",
  "accountId": "<local profile UUID>"
}
```

This endpoint still requires normal CloudMail user authentication.

### Step 3: CloudMail → Gateway

When new mail arrives:

```http
POST https://push.readori.com/v1/push
Authorization: Bearer <pushSecret>
```

Minimal event:

```json
{
  "subscriptionId": "ps_...",
  "event": "new_mail",
  "emailId": 123
}
```

### Step 4: Gateway → APNs

The Gateway owns the APNs provider credentials and sends the notification to Apple.

Therefore the user's CloudMail server does not need to know:

```text
APNs token
Apple .p8
Apple Team ID
Apple Key ID
```

The Gateway does not need the user's CloudMail login password.

---

# 16.3 Official Gateway vs self-hosted Gateway

The official CF Mail app can currently use:

```text
https://push.readori.com
```

This is the public endpoint of the hosted official Gateway.

Self-hosters have three choices:

```text
A. Use the official Gateway
CFMAIL_PUSH_GATEWAY_URL=https://push.readori.com

B. Use your own Gateway
CFMAIL_PUSH_GATEWAY_URL=https://push.example.com

C. Disable remote push
CFMAIL_PUSH_GATEWAY_URL=
```

Core CloudMail mail/Web/iOS API functionality should not require a Push Gateway; the Gateway exists for the remote-notification path.

# 17. Is Push Gateway mandatory?

No.

If the user only needs:

- Web mail
- iOS manual refresh/sync
- mail send/receive
- CloudMail APIs

the Push Gateway can remain disabled.

For example:

```text
CFMAIL_PUSH_GATEWAY_URL=
```

Remote APNs push will not work, but core CloudMail functionality should remain available.

---

# 18. Public policy for the official Push Gateway

The project should explicitly document:

```text
https://push.readori.com
```

as the:

```text
Official CF Mail Push Gateway
```

This is a **public service endpoint**, not a secret.

Ordinary self-hosters using the official CF Mail app can use this Gateway without possessing Apple's APNs provider credentials.

The following values must still never be published:

```text
APNS_PRIVATE_KEY
APNS_KEY_ID
APNS_TEAM_ID
Cloudflare API Token
Gateway D1 internal data
internal administration credentials
```

Recommended public configuration:

```text
# Use the official CF Mail Push Gateway
CFMAIL_PUSH_GATEWAY_URL=https://push.readori.com
```

For a fully self-hosted setup:

```text
CFMAIL_PUSH_GATEWAY_URL=https://push.example.com
```

To run CloudMail without remote push:

```text
CFMAIL_PUSH_GATEWAY_URL=
```

or use the explicit disabled/empty value supported by the deployment/runtime revision you are using.

## Why is publishing the Gateway URL acceptable?

Publishing a public HTTPS API endpoint is not the same as publishing a secret.

Publishing:

```text
https://push.readori.com
```

only tells clients and CloudMail where to send Gateway requests.

It does not disclose:

- Apple `.p8`
- Apple Team ID
- APNs Key ID
- Cloudflare account tokens
- a user's CloudMail password
- internal Gateway database credentials

Security should instead rely on:

- scoped `subscriptionId`
- scoped `pushSecret`
- API input validation
- WAF / rate limiting
- subscription limits
- Queue / DLQ controls
- redacted logging
- keeping APNs provider credentials out of the normal CloudMail Worker

## Recommended production controls for the official Gateway

Because it is a public hosted service, production should use at least:

- Cloudflare WAF
- rate limiting
- bot/abuse protection
- per-installation/subscription limits
- installation/source deduplication
- Queue / DLQ alerting
- APNs error-rate monitoring
- device-token redaction
- no full `pushSecret` logging
- a separate privacy notice
- a clear availability/support statement

This lets the service publish its public URL while still protecting the infrastructure that is actually sensitive.

# 19. Self-hosting the Push Gateway

This is mainly for users who:

- build their own iOS app;
- own an Apple Developer account;
- use their own Bundle ID;
- want full control over APNs.

Install:

```bash
cd cfmail-push-gateway
npm install
npm test
```

Create D1:

```bash
npx wrangler d1 create cfmail-push-gateway
```

Create Queues:

```bash
npx wrangler queues create cfmail-apns-retry
npx wrangler queues create cfmail-apns-dead-letter
```

Apply migrations:

```bash
npm run db:migrate:remote
```

Set secrets:

```bash
npx wrangler secret put APNS_KEY_ID
npx wrangler secret put APNS_TEAM_ID
npx wrangler secret put APNS_PRIVATE_KEY
```

Set the user's own Bundle ID:

```toml
[vars]
APNS_BUNDLE_ID = "com.example.cfmail"
```

Deploy:

```bash
npm run deploy
```

Route your own public domain, for example:

```text
https://push.example.com
```

Then configure CloudMail:

```text
CFMAIL_PUSH_GATEWAY_URL=https://push.example.com
```

---

# 20. Important: official App Store iOS vs self-hosted Gateway

Apple Push Notification is not authorized merely by knowing a Gateway URL.

APNs provider authentication is tied to:

```text
Apple Developer Team
APNs Key
Bundle ID / topic
```

### Official App Store CF Mail

Ordinary self-hosters must never receive the official app's:

```text
APNS_PRIVATE_KEY
APNS_KEY_ID
APNS_TEAM_ID
```

Do not place those values in the public repository or deployment guide.

### User-built iOS

A user can:

1. switch to their own Bundle ID;
2. sign with their own Apple Developer Team;
3. create their own APNs Key;
4. deploy their own `cfmail-push-gateway`;
5. configure the iOS Gateway base URL;
6. rebuild and sign the app.

---

# 21. Push Gateway health check

```bash
curl -fsS https://push.example.com/healthz
```

The current Gateway health endpoint should indicate that the service is alive and can report whether the retry queue binding is present.

Monitor logs for:

```text
push delivered
push queued
retry delivered
retry rescheduled
subscription deactivated
APNs permanent failure
```

Also inspect:

```text
cfmail-apns-dead-letter
```

for messages that exhausted the retry budget.

---

# 22. Push reliability architecture

The current Gateway design includes:

- APNs Provider JWT caching
- warm-isolate memory cache
- D1 provider-token cache
- early provider JWT refresh
- one forced refresh for `ExpiredProviderToken`
- immediate first APNs attempt
- Queue only after transient failure
- delayed retries
- Dead Letter Queue
- automatic invalid-device-token deactivation

Do not reintroduce a second direct APNs implementation inside `mail-worker`.

---

# 23. iOS push production validation

Real APNs must be tested on a physical device.

Recommended sequence:

1. Deploy Gateway.
2. Verify `/healthz`.
3. Deploy CloudMail.
4. Run `POST /api/init`.
5. Install the latest TestFlight / Release build.
6. Sign in to a CloudMail account.
7. Grant notification permission.
8. iOS receives an APNs token.
9. iOS creates a Gateway subscription.
10. iOS registers the scoped subscription with CloudMail.
11. Send a new test email.
12. CloudMail stores the message.
13. CloudMail calls the Gateway.
14. Gateway calls APNs.
15. Test a locked-device notification.
16. Test the foreground in-app banner.
17. Verify the selected notification-preview mode.

If:

```text
Settings → Notifications → CF Mail → Show Previews
```

is not `Always`, iOS may intentionally hide rich content. That is not necessarily a CloudMail backend failure.

---

# 24. Recommended production deployment order

```text
1. Fork / clone
2. Create Cloudflare D1
3. Create KV
4. Optionally create R2
5. Configure Email Routing
6. Configure GitHub Secrets / Variables
7. Build mail-vue
8. Run Worker QA
9. Deploy mail-worker + Worker Assets
10. GET /api/health
11. POST /api/init
12. GET /api/health again
13. Test Web login
14. Test inbound mail
15. Test outbound mail
16. Add the self-hosted CloudMail server in iOS
17. Test iOS login and sync
18. If remote push is needed, configure the independent Gateway
19. Test APNs on a physical device
20. Check logs / Queue / DLQ
```

For an upgrade:

```text
deploy new Worker
→ POST /api/init
→ verify health
→ verify Web
→ verify iOS
```

---

# 25. Minimum post-deployment checklist

## Worker

```text
[ ] /api/health ready=true
[ ] D1=true
[ ] KV=true
[ ] JWT Secret present
[ ] INIT Secret present
[ ] CONFIG_ENCRYPTION_KEY configured
```

## Web

```text
[ ] Home
[ ] Login
[ ] CSP
[ ] Turnstile
[ ] Iconify
[ ] Light/Dark
[ ] Mail list
[ ] Mail detail
[ ] Compose
[ ] Attachments
[ ] Admin
```

## Mail

```text
[ ] Email Routing
[ ] Inbound
[ ] Outbound
[ ] Multiple domains
[ ] Attachments
[ ] Forwarding
```

## iOS

```text
[ ] HTTPS server
[ ] CloudMail login
[ ] Inbox
[ ] Sent
[ ] Drafts
[ ] Compose
[ ] Attachments
[ ] Background refresh
```

## Push, if enabled

```text
[ ] Gateway /healthz
[ ] Subscription create
[ ] Subscription refresh
[ ] CloudMail device/register
[ ] new_mail webhook
[ ] APNs delivered
[ ] Queue retry
[ ] DLQ=0 in steady state
[ ] Logout unregister
```

---

# 26. Security red lines

Never commit:

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
```

Do not place these values in:

- README files;
- screenshots;
- GitHub Actions logs;
- frontend `VITE_*` variables;
- the iOS bundle;
- public issues.

---

# 27. Final architecture

```text
                    ┌────────────────────┐
                    │   CF Mail iOS      │
                    └─────────┬──────────┘
                              │ HTTPS API
                              ▼
┌───────────────┐     ┌────────────────────┐
│ Browser / Web │────▶│ CloudMail Worker   │
└───────────────┘     │ + Vue Assets       │
                      ├────────────────────┤
                      │ D1                 │
                      │ KV                 │
                      │ R2 / S3 optional   │
                      │ Email Routing      │
                      └─────────┬──────────┘
                                │ scoped push webhook
                                ▼
                      ┌────────────────────┐
                      │ Push Gateway       │
                      │ optional           │
                      └─────────┬──────────┘
                                │ APNs
                                ▼
                      ┌────────────────────┐
                      │ Apple APNs         │
                      └────────────────────┘
```

The key boundary is:

> **The self-hosted CloudMail server belongs to the user; APNs provider credentials do not belong in a normal CloudMail Worker.**
>
> Open-source self-hosting documentation may publish the official Push Gateway public service URL, but it must never publish Apple APNs provider credentials, Cloudflare tokens, Gateway internal credentials, or any other real secrets.
