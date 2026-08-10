# CloudMail Latest Self-Hosting Deployment Guide (Backend + Web + iOS Integration)

> This guide is intended for open-source self-hosters. It follows the current CloudMail project architecture: `mail-worker` + `mail-vue` are deployed together as a full-stack Cloudflare Workers application; D1/KV are required resources, while R2 is optional; CF Mail iOS connects to a self-hosted server through the CloudMail API; remote push notifications are handled by the independent `cfmail-push-gateway`.
>
> **Push service note:** The official CF Mail app currently uses the public hosted Push Gateway at `https://push.readori.com`. This URL is a public service endpoint and is not a Secret. What must remain private are the Apple APNs `.p8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, Cloudflare API Token, Gateway database/internal credentials, and similar sensitive values. Self-hosters may also choose not to use the official Gateway at all, use their own Gateway, or disable remote push.

---

## 1. Current Project Structure

Core directories:

```text
cloud-mail/
├── mail-worker/                 # Cloudflare Worker backend + API + Email Handler + Worker Assets
├── mail-vue/                    # Vue Web frontend
├── cfmail-push-gateway/         # Independent APNs Push Gateway
└── .github/workflows/           # GitHub Actions
```

### 1.1 `mail-worker`

Responsibilities:

- `/api/*` backend APIs
- Business logic for users, accounts, mail, settings, permissions, etc.
- Cloudflare Email Routing `email` handler
- D1 data access
- KV sessions / caching / rate limiting
- R2 / S3 / KV attachment storage
- Web static asset hosting
- Initialization and database migrations
- CloudMail → Push Gateway push webhook
- Health checks

### 1.2 `mail-vue`

The Vue frontend is not deployed separately to Cloudflare Pages.

The current project runs:

```bash
cd mail-vue
pnpm run build
```

The build output is written to the Worker's static asset directory and then published together with `mail-worker` through Workers Assets.

The final deployment therefore looks like:

```text
Browser
   │
   ├── /             → Vue / Worker Assets
   └── /api/*        → mail-worker API
```

The frontend and backend share the same origin, so there is no need to configure a separate cross-origin API domain for the Web app.

### 1.3 `cfmail-push-gateway`

This is an independent Worker and is not a mandatory component of a normal self-hosted CloudMail server.

It is responsible for:

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

**A normal CloudMail Worker does not store the Apple APNs `.p8` key and should not store APNs device tokens.**

---

# 2. Prerequisites

Recommended:

- Cloudflare Account
- A domain hosted on Cloudflare
- A GitHub repository Fork / Clone
- Node.js 22
- pnpm 9.15.x
- Wrangler
- Optional: Apple Developer Account (only required if you build iOS yourself and self-host the Push Gateway)

Install:

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

# 3. Cloudflare Resources

## 3.1 D1 — Required

CloudMail uses D1 to store its primary relational data:

- Users
- Mail accounts
- Messages
- System settings
- Permissions
- Invite codes
- Push Subscriptions
- Other business data

Create:

```bash
cd mail-worker
pnpm wrangler login
pnpm wrangler d1 create cloud-mail
```

Record:

```text
database_id
```

The Worker binding must remain:

```toml
binding = "db"
```

Do not arbitrarily rename it to `DB`, `database`, or another value.

---

## 3.2 Workers KV — Required

KV is used for:

- Sessions
- Settings cache
- Rate-limit state
- Temporary/public tokens
- Some runtime caches
- Storage fallback when R2 is not configured

Create:

```bash
pnpm wrangler kv namespace create cloud-mail
```

Record the namespace ID.

The binding must remain:

```toml
binding = "kv"
```

---

## 3.3 R2 — Optional but Recommended

If you expect many attachments, creating an R2 bucket is recommended:

```bash
pnpm wrangler r2 bucket create cloud-mail-assets
```

Recommended binding:

```toml
[[r2_buckets]]
binding = "r2"
bucket_name = "cloud-mail-assets"
```

If R2 is not configured, the current project can fall back to other storage paths; an external S3 service can also be configured in the admin backend.

**For production environments that store many attachments for long periods, R2 or S3 is recommended instead of relying on KV long-term.**

---

# 4. Cloudflare Email Routing

Deploying the Worker alone does not mean the server can already receive email.

In Cloudflare Dashboard, enable Email Routing for the mail domain:

```text
Email → Email Routing
```

Then create a route that delivers incoming mail to the CloudMail Worker.

The project already contains an `email` handler, but Cloudflare still requires an Email Routing rule.

Recommended flow:

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

If you use multiple inbound domains, make sure `DOMAIN` matches the Email Routing configuration.

---

# 5. Required Secrets

Do not write sensitive values directly into:

```text
wrangler.toml
GitHub Actions YAML
README
Public repository
```

Use:

```bash
wrangler secret put
```

or GitHub Repository Secrets.

## 5.1 `JWT_SECRET`

Used for CloudMail login/session/JWT.

It must be at least 32 characters. A random 64-byte value is recommended:

```bash
openssl rand -hex 64
```

Set it with:

```bash
pnpm wrangler secret put jwt_secret
```

GitHub Actions Secret name:

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

Set it with:

```bash
pnpm wrangler secret put init_secret
```

GitHub:

```text
INIT_SECRET
```

---

## 5.3 `CONFIG_ENCRYPTION_KEY`

The current hardened version uses this key to protect dynamically configurable sensitive integration secrets.

Requirements:

- At least 32 characters
- Must not be the same as `JWT_SECRET`
- Must not be the same as `INIT_SECRET`
- Do not place it in `[vars]`

Set it with:

```bash
pnpm wrangler secret put config_encryption_key
```

GitHub:

```text
CONFIG_ENCRYPTION_KEY
```

### Key Rotation

During a rotation window, you may temporarily configure:

```text
CONFIG_ENCRYPTION_KEY_PREVIOUS
```

After database initialization/migration is complete and you have confirmed that legacy data has been re-encrypted, remove the previous key.

---

# 6. Common Variables / Repository Variables

The following values are not APNs private keys and can be configured as needed:

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

`DOMAIN` is a JSON array, not a plain string:

```text
["example.com"]
```

Multiple domains:

```text
["example.com","example.net"]
```

---

# 7. Optional Secrets

Enable as needed:

```text
LINUXDO_CLIENT_SECRET
RESEND_WEBHOOK_SECRET
CONFIG_ENCRYPTION_KEY_PREVIOUS
```

These should still be managed through Worker Secrets / GitHub Secrets.

---

# 8. Local Installation and QA

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

Before deployment, it is recommended to run at least the security and contract tests currently included in the project:

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

If a script does not exist in your Fork, use the scripts actually defined in that revision's `package.json`.

## 8.2 Web

```bash
cd ../mail-vue
pnpm install --frozen-lockfile
pnpm run security:test
pnpm run contract:test
pnpm run build
```

After the Web build completes, it should generate the `dist` content required by Worker Assets.

---

# 9. Deploying CloudMail with GitHub Actions

In the cleaned-up repository, it is recommended to keep only one main Cloudflare deployment entry point, for example:

```text
.github/workflows/cloudflare-deploy.yml
```

The underlying workflow can continue calling a reusable workflow:

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

Add the Secrets / Variables described above.

Then:

```text
Actions
→ Cloudflare Deploy
→ Run workflow
```

For the first deployment, use a mode that includes database initialization/migration, for example:

```text
deploy-and-migrate
```

For normal code updates afterward:

```text
deploy
```

> If the workflow names in your Fork are slightly different, follow the actual files under `.github/workflows/`; do not keep multiple backend/frontend deployment workflows that perform exactly the same deployment.

---

# 10. Manual Deployment with Wrangler CLI

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

Make sure the Wrangler configuration contains:

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

Upload Secrets:

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

# 11. Initialization / Database Migration

After deployment, do not use:

```text
GET /api/init/<secret>
```

In production, use the Header-protected endpoint:

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

Expected success response:

```text
success
```

The initialization endpoint should be safe to run repeatedly and is used for:

- Initial schema creation
- Database version upgrades
- Security migrations
- Push subscription schema updates
- Config secret encryption migration

After production migration is complete, you may use `INIT_LOCKED` according to your maintenance policy to restrict access to the initialization endpoint.

---

# 12. Health Check

CloudMail:

```bash
curl -fsS https://mail.example.com/api/health
```

A healthy response should look similar to:

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
HTTP 200 does not mean ready=true
```

Verify at least:

```text
ready = true
d1 = true
kv = true
jwtSecret = true
initSecret = true
```

---

# 13. Web Production Validation

Open:

```text
https://mail.example.com
```

Check:

1. The home page loads normally.
2. `/login` loads normally.
3. Login succeeds.
4. The browser F12 Console has no blocking CSP errors.
5. `/api/*` same-origin requests work normally.
6. Dark / Light themes work normally.
7. Iconify icons load normally.
8. Cloudflare Turnstile works normally when enabled.
9. Attachment upload/download works normally.
10. Sending/receiving mail works normally.

If strict CSP is enabled, make sure required third-party origins are explicitly allowlisted. Do not simply add the following just to eliminate console errors:

```text
script-src 'unsafe-inline'
connect-src https:
```

---

# 14. Connecting iOS to a Self-Hosted CloudMail Server

A CloudMail Account in CF Mail iOS must connect to the user's own CloudMail Server.

When adding a server in iOS, enter:

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
- Publicly valid certificate
- Do not use a self-signed certificate
- `/api/health` is healthy
- Web login works normally
- D1 / KV have been initialized
- A user account has been created

---

# 15. iOS Login Flow

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

The iOS client uses the CloudMail API, not the Web page DOM.

Web and iOS share the same backend business data, but client authentication behavior may differ. Do not try to make iOS "compatible" by modifying Web localStorage tokens.

---

# 16. Push Gateway Privacy Architecture

This is an important boundary in the current version.

## 16.1 What Should Not Happen

A self-hosted CloudMail Worker should not receive:

```text
Apple .p8
APNS_KEY_ID
APNS_TEAM_ID
raw APNs device token
```

These values belong only to the independent Push Gateway.

## 16.2 Current Secure Flow

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

### Step 2: iOS → User's Self-Hosted CloudMail

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

This API still requires normal CloudMail user authentication.

### Step 3: CloudMail → Gateway

When a new message arrives:

```http
POST https://push.readori.com/v1/push
Authorization: Bearer <pushSecret>
```

CloudMail sends a minimal event:

```json
{
  "subscriptionId": "ps_...",
  "event": "new_mail",
  "emailId": 123
}
```

### Step 4: Gateway → APNs

The Gateway holds the APNs provider credentials and sends the notification to Apple.

As a result:

```text
User's self-hosted CloudMail
    does not know the APNs token
    does not know the Apple .p8
    does not know the Team ID
    does not know the Key ID
```

The Gateway does not need access to the user's CloudMail login password.

---

# 16.3 Official Gateway vs Self-Hosted Gateway

The official CF Mail app can currently use:

```text
https://push.readori.com
```

This is the public endpoint of the official hosted Gateway.

Self-hosters have three options:

```text
A. Use the official Gateway
CFMAIL_PUSH_GATEWAY_URL=https://push.readori.com

B. Use your own Gateway
CFMAIL_PUSH_GATEWAY_URL=https://push.example.com

C. Disable remote push
CFMAIL_PUSH_GATEWAY_URL=
```

Core CloudMail mail functionality and Web/iOS APIs should not depend on the Gateway in order to work; the Gateway is only responsible for the remote notification path.

# 17. Is the Push Gateway Required?

No.

If a user only needs:

- Web Mail
- iOS manual refresh/sync
- Sending and receiving mail
- CloudMail API

the Push Gateway does not need to be enabled.

In that case:

```text
CFMAIL_PUSH_GATEWAY_URL=
```

Remote APNs push will be unavailable, but core mail functionality should continue to work.

---

# 18. Public Policy for the Official Push Gateway

The current project recommends explicitly publishing:

```text
https://push.readori.com
```

as:

```text
Official CF Mail Push Gateway
Official hosted CF Mail Push Gateway
```

This is a **public service endpoint**, not a Secret.

Ordinary self-hosters using the official CF Mail app can use this Gateway directly without possessing Apple APNs credentials.

However, the following must never be published:

```text
APNS_PRIVATE_KEY
APNS_KEY_ID
APNS_TEAM_ID
Cloudflare API Token
Gateway D1 internal data
Any internal administration credentials
```

Recommended public configuration:

```text
# Use the official CF Mail Push Gateway
CFMAIL_PUSH_GATEWAY_URL=https://push.readori.com
```

For users who want a fully self-hosted setup:

```text
CFMAIL_PUSH_GATEWAY_URL=https://push.example.com
```

For users who do not need remote push:

```text
CFMAIL_PUSH_GATEWAY_URL=
```

Or use the explicit disabled/empty configuration supported by the current deployment script/runtime.

## Why Can the Gateway URL Be Public?

Because publishing an HTTPS API endpoint is different from publishing a Secret.

Publishing:

```text
https://push.readori.com
```

only tells clients/CloudMail where Push Gateway requests should be sent.

Security comes from:

- scoped `subscriptionId`
- scoped `pushSecret`
- API input validation
- WAF / Rate Limit
- D1 subscription limits
- Queue / DLQ
- Log redaction
- Preventing the CloudMail Worker from holding APNs provider credentials


# 18. Important: Official App Store iOS vs Self-Hosted Gateway

Apple Push Notification is not authorized simply because someone knows the URL.

APNs provider credentials are tied to:

```text
Apple Developer Team
APNs Key
Bundle ID / Topic
```

---

# 19. Push Gateway Health Check

```bash
curl -fsS https://push.example.com/healthz
```

The current Gateway health check should at least report that the service is healthy and can indicate whether the Retry Queue binding is available.

Important runtime events to monitor:

```text
push delivered
push queued
retry delivered
retry rescheduled
subscription deactivated
APNs permanent failure
```

Also check whether:

```text
cfmail-apns-dead-letter
```

continues accumulating messages.

---

# 20. Push Gateway Reliability

The current architecture uses:

- APNs Provider JWT caching
- Warm isolate memory cache
- D1 provider-token cache
- Early Provider JWT refresh
- One forced refresh for `ExpiredProviderToken`
- Immediate first APNs request
- Queue only after failure
- Delayed retry
- Dead Letter Queue
- Automatic invalid device-token deactivation

Therefore, do not implement a second direct APNs path inside the CloudMail Worker.

---

# 21. iOS Push Production Validation

Real APNs must be tested on a physical device.

Recommended sequence:

1. Deploy the Gateway.
2. Check `/healthz`.
3. Deploy CloudMail.
4. Run `POST /api/init`.
5. Install the latest TestFlight / Release build on iOS.
6. Log in to the CloudMail Account.
7. Grant notification permission.
8. iOS receives an APNs token.
9. iOS successfully creates a Gateway subscription.
10. iOS successfully registers the scoped subscription with CloudMail.
11. Send a new test email.
12. CloudMail stores the message.
13. CloudMail calls the Gateway.
14. The Gateway calls APNs.
15. Lock the device and verify the system notification.
16. In the foreground, verify the CF Mail in-app banner.
17. Verify that notification preview behavior matches the selected setting.

If the system setting:

```text
Settings → Notifications → CF Mail → Show Previews
```

is not set to `Always`, iOS may intentionally hide notification body content. This is not a CloudMail backend error.

---

# 22. Recommended Production Deployment Order

Complete production sequence:

```text
1. Fork / Clone
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
16. Add the self-hosted CloudMail Server in iOS
17. Test iOS login / synchronization
18. If Push is needed, configure the independent Gateway
19. Test APNs on a physical device
20. Check logs / Queue / DLQ
```

For a database upgrade:

```text
Deploy the new Worker
→ POST /api/init
→ Verify health
→ Verify Web
```

---

# 23. Minimum Post-Deployment Validation Checklist

## Worker

```text
[ ] /api/health ready=true
[ ] D1=true
[ ] KV=true
[ ] JWT Secret is valid
[ ] INIT Secret is valid
[ ] CONFIG_ENCRYPTION_KEY is configured
```

## Web

```text
[ ] Home page
[ ] Login
[ ] CSP
[ ] Turnstile
[ ] Iconify
[ ] Light/Dark
[ ] Message list
[ ] Message detail
[ ] Compose
[ ] Attachments
[ ] Admin panel
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
[ ] HTTPS Server
[ ] CloudMail login
[ ] Inbox
[ ] Sent
[ ] Draft
[ ] Compose
[ ] Attachment
[ ] Background refresh
```

## Push (if enabled)

```text
[ ] Gateway /healthz
[ ] Subscription create
[ ] Subscription refresh
[ ] CloudMail device/register
[ ] new_mail webhook
[ ] APNs delivered
[ ] Queue retry
[ ] DLQ=0 (steady state)
[ ] Logout unregister
```

---

# 24. Security Red Lines

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

Do not put these values:

- In the README;
- In screenshots;
- In GitHub Actions logs;
- In frontend `VITE_*` environment variables;
- In the iOS bundle;
- In public issues.

---

# 25. Conclusion

The recommended current CloudMail self-hosting model is:

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

The most important boundary is:

> **The self-hosted CloudMail server belongs to the user; APNs Provider Credentials do not belong in a normal CloudMail Worker.**
