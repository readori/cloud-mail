# CloudMail Self-Hosting Deployment Guide

This guide covers the public CloudMail stack only: `mail-vue`, `mail-worker`, and `.github/workflows/cloudflare-deploy.yml`.

CloudMail builds the Vue Web application into `mail-worker/dist` and deploys the Web assets together with the Worker. A separate Cloudflare Pages project is not required.

## 1. Architecture

```text
Browser
  │
  ▼
CloudMail Worker + Vue Assets
  │
  ├── D1 database                required
  ├── Workers KV                 required
  ├── R2 / external S3           optional attachment storage
  ├── Cloudflare Email Routing   inbound mail
  ├── Resend / send_email        outbound mail options
  └── Hosted notification URL    optional
```

Public source layout:

```text
cloud-mail/
├── mail-worker/
├── mail-vue/
└── .github/workflows/
    └── cloudflare-deploy.yml
```

## 2. Prerequisites

- A Cloudflare account
- A domain managed by Cloudflare
- Node.js 22
- pnpm 9.15.9
- D1 and Workers KV
- Cloudflare Email Routing if you want to receive mail
- Optional R2 or external S3 for attachment/object storage
- Optional Resend configuration or Cloudflare `send_email` binding for external outbound mail

For local development:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate

cd mail-worker
pnpm install --frozen-lockfile

cd ../mail-vue
pnpm install --frozen-lockfile
```

## 3. Recommended deployment: GitHub Actions

The public repository uses one standalone workflow:

```text
.github/workflows/cloudflare-deploy.yml
```

The workflow is standalone and does not require a separate source-repository token or cross-repository checkout.

The workflow checks out the repository in which the workflow is running. It works the same way whether your GitHub repository is public or private.

### Workflow modes

- `verify` — run tests and build only.
- `deploy` — run tests/build and deploy Worker + Web assets.
- `deploy-and-migrate` — deploy, call the protected initialization endpoint, then apply versioned D1 migrations.

Pushes and pull requests run validation only. Production deployment is started manually from **GitHub → Actions → CloudMail CI & Cloudflare Deploy → Run workflow**.

Use `deploy` for normal releases. Use `deploy-and-migrate` for the first production deployment or a release that includes database/init changes.

## 4. Required GitHub Actions secrets

Configure under **Repository → Settings → Secrets and variables → Actions → Secrets**.

| Secret | Required | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes | Cloudflare API token with permissions for Workers and resources used by deployment. |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Cloudflare account ID. |
| `JWT_SECRET` | Yes | JWT signing secret, minimum 32 characters. |
| `INIT_SECRET` | Yes | Protected initialization secret, minimum 32 characters. |
| `CONFIG_ENCRYPTION_KEY` | Yes | Root key for encrypted dynamic configuration, minimum 32 characters. |
| `CONFIG_ENCRYPTION_KEY_PREVIOUS` | No | Previous configuration-encryption key during key rotation only. |
| `RESEND_WEBHOOK_SECRET` | No | Resend webhook signing secret when enabled. |
| `LINUXDO_CLIENT_SECRET` | No | OAuth client secret when that integration is enabled. |

`JWT_SECRET`, `INIT_SECRET`, and `CONFIG_ENCRYPTION_KEY` must be independent values.

Generate strong random values, for example:

```bash
openssl rand -hex 64
```

Never commit production secrets to the repository or place them in public GitHub variables.

## 5. GitHub Actions variables

Configure under **Repository → Settings → Secrets and variables → Actions → Variables**.

| Variable | Required | Example / purpose |
| --- | --- | --- |
| `DOMAIN` | Yes | JSON array of receiving domains, e.g. `["example.com"]`. |
| `ADMIN` | Yes | Administrator email address. |
| `NAME` | No | Worker/D1/KV resource name. Default: `cloud-mail`. |
| `CUSTOM_DOMAIN` | No | Worker custom hostname, e.g. `mail.example.com`. |
| `D1_DATABASE_ID` | No | Existing D1 ID. If omitted, CI resolves or creates a database named `NAME`. |
| `KV_NAMESPACE_ID` | No | Existing KV ID. If omitted, CI resolves or creates a namespace named `NAME`. |
| `R2_BUCKET_NAME` | No | Existing R2 bucket to bind. |
| `PROJECT_LINK` | No | Project/support URL shown by the application. |
| `AI_MODEL` | No | Workers AI model. |
| `ANALYSIS_CACHE` | No | `true` or `false`; default `false`. |
| `PASSWORD_PBKDF2_ITERATIONS` | No | Password PBKDF2 iteration count; default `150000`. |
| `PASSWORD_REHASH_ON_LOGIN` | No | Default `true`. |
| `EMAIL_TRASH_RETENTION_DAYS` | No | Trash retention; default `30`. |
| `INIT_LOCKED` | No | `true` blocks remote initialization outside maintenance windows. |
| `CLOUDFLARE_EMAIL` | No | `true` enables the Cloudflare `send_email` binding. |
| `CFMAIL_PUSH_GATEWAY_URL` | No | Optional hosted notification endpoint; use `disabled` to disable. |
| `LINUXDO_CLIENT_ID` | No | OAuth client ID when enabled. |
| `LINUXDO_CALLBACK_URL` | No | OAuth callback URL when enabled. |
| `LINUXDO_SWITCH` | No | OAuth feature switch. |

`DOMAIN` must be a JSON array, even for one domain:

```text
["example.com"]
```

For multiple receiving domains:

```text
["example.com","example.net"]
```

## 6. D1, KV and R2

The workflow can automatically resolve or create the D1 database and KV namespace when their IDs are not supplied.

If you prefer to create them manually:

```bash
cd mail-worker
pnpm wrangler login
pnpm wrangler d1 create cloud-mail
pnpm wrangler kv namespace create cloud-mail
```

R2 is optional. Create the bucket before setting `R2_BUCKET_NAME`:

```bash
pnpm wrangler r2 bucket create cloud-mail-assets
```

Do not set a non-existent R2 bucket name in CI.

## 7. Email Routing

Deploying the Worker does **not** automatically configure inbound mail routing.

For each receiving domain:

1. Enable **Cloudflare Email Routing**.
2. Complete the required DNS/MX setup.
3. Create a Catch-all or specific address rule.
4. Set the action to **Send to a Worker**.
5. Select your deployed CloudMail Worker.
6. Keep the `DOMAIN` variable aligned with the domains configured in Email Routing.

Inbound mail is then processed by the Worker `email(message, env, ctx)` handler.

## 8. Outbound mail

Internal delivery between CloudMail-managed addresses can be handled by the application.

For external delivery, configure one of the supported outbound methods:

- Resend, including the required sender-domain configuration; or
- Cloudflare `send_email` binding when supported by your account and enabled with `CLOUDFLARE_EMAIL=true`.

Do not expect external delivery to work until at least one outbound provider is correctly configured.

## 9. Initialization and migrations

The supported initialization endpoint is:

```http
POST /api/init
X-Init-Secret: <INIT_SECRET>
```

The legacy URL-secret initializer is not the supported production path.

For CI, use `deploy-and-migrate` when initialization or schema migration is required. The workflow calls the protected init endpoint and applies versioned D1 migrations after deployment.

For a manual check:

```bash
BASE_URL="https://mail.example.com"

curl -fsS "$BASE_URL/api/health"

curl -fsS -X POST \
  -H "X-Init-Secret: $INIT_SECRET" \
  -H "Accept: text/plain" \
  "$BASE_URL/api/init"
```

Set `INIT_LOCKED=true` when your operational policy should prevent initialization outside an explicit maintenance window.

## 10. Health check

After deployment:

```bash
curl -fsS https://mail.example.com/api/health
```

Expected public shape:

```json
{
  "status": "ok",
  "service": "cloudmail",
  "ready": true
}
```

Do not switch production traffic until `ready` is `true`.

## 11. Local public quality gates

Worker:

```bash
cd mail-worker
pnpm install --frozen-lockfile
pnpm test
pnpm security:test
pnpm security:migration-test
pnpm db:migration-test
pnpm init:security-test
pnpm config-secret:test
pnpm web-session:test
pnpm secret-storage:test
pnpm rich-email:test
pnpm email:list:test
pnpm push:contract-test
pnpm openapi:test
pnpm i18n:test
pnpm retention:test
```

Web:

```bash
cd mail-vue
pnpm install --frozen-lockfile
pnpm unit:test
pnpm security:test
pnpm contract:test
pnpm hygiene:test
pnpm a11y:test
pnpm workspace:test
pnpm run build
pnpm run e2e:smoke
```

These are the self-contained public Web/Worker checks used by the public CI workflow.

## 12. Optional hosted notification service

CloudMail can submit supported notification events to the hosted service endpoint:

```text
https://push.readori.com
```

To explicitly disable this integration:

```text
CFMAIL_PUSH_GATEWAY_URL=disabled
```

Core Web, API, inbound mail, outbound mail, storage, and administration functionality remain available when hosted notifications are disabled.

The hosted service implementation and its infrastructure are outside the public self-hosting source scope.

## 13. Production security checklist

Before exposing a deployment to users:

- [ ] `JWT_SECRET`, `INIT_SECRET`, and `CONFIG_ENCRYPTION_KEY` are strong and different.
- [ ] Secrets exist only in GitHub Secrets / Wrangler Secrets, not source control.
- [ ] `/api/health` returns `ready=true`.
- [ ] D1 and KV are initialized.
- [ ] Versioned migrations are current.
- [ ] Cloudflare Email Routing is configured for every receiving domain.
- [ ] External sending is configured and tested if required.
- [ ] Attachment storage is tested.
- [ ] Login, logout, session rotation, administrator permissions, compose, CC/BCC, drafts and mail detail are tested.
- [ ] Production CSP has no blocking errors.
- [ ] The optional notification integration is either configured intentionally or explicitly disabled.

## 14. Common troubleshooting

### CI says a required secret or variable is missing

Check **Settings → Secrets and variables → Actions**. `DOMAIN` and `ADMIN` are variables; Cloudflare credentials and application keys are secrets.

### D1/KV cannot be resolved

Confirm the Cloudflare API token has sufficient permissions. You may also create D1/KV manually and provide `D1_DATABASE_ID` / `KV_NAMESPACE_ID`.

### Deployment succeeds but no mail arrives

Worker deployment does not create Email Routing rules. Recheck Email Routing, MX/DNS records, and the rule that sends mail to this Worker.

### Internal mail works but external recipients fail

Configure Resend or enable/configure Cloudflare outbound email. External delivery is intentionally rejected when no outbound provider is available.

### `/api/health` returns `ready=false`

Verify D1, KV, required secrets, and initialization/migrations. Run `deploy-and-migrate` for first deployment or schema-changing upgrades.

### R2 deployment fails

Create the bucket before setting `R2_BUCKET_NAME`, or remove that variable and use the deployment's other supported storage configuration.

## 15. Upgrade procedure

For ordinary code/UI updates:

```text
Run workflow → deploy
```

For first deployment or schema/init changes:

```text
Run workflow → deploy-and-migrate
```

Always verify `/api/health`, Web login, mail receive/send and storage after a production upgrade.
