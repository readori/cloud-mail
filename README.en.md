# Cloud Mail

A lightweight, responsive, self-hosted email platform built on Cloudflare. Cloud Mail combines a Vue 3 web client with a Cloudflare Worker backend and can run with Cloudflare D1, KV, R2, Workers AI, Turnstile, and Resend.

[简体中文](./README.zh-CN.md) · English

> [!IMPORTANT]
> This project is based on [maillab/cloud-mail](https://github.com/maillab/cloud-mail). This public repository focuses on the deployable Web and Worker stack: `mail-vue`, `mail-worker`, and the GitHub Actions workflow used to test, build, and deploy them.
>
> Major changes include backend security hardening, expanded mail APIs, CC/BCC support, notification hooks, protected initialization, versioned migration safeguards, and production deployment checks.

## Overview

With a domain and a Cloudflare account, you can create and operate multiple mailbox addresses on a serverless stack without maintaining a traditional mail application server.

Useful links:

- [Live demo](https://skymail.ink)
- [Upstream documentation](https://doc.skymail.ink)
- [CloudMail Cloudflare deployment guide](https://cfmail.readori.com/cloudmail-cloudflare-deploy-guide)

## Features

- **Low-cost serverless deployment** — run the backend and Web assets on Cloudflare Workers.
- **Responsive Web interface** — Vue 3 UI for desktop and modern mobile browsers.
- **Mail sending** — Resend integration, multiple recipients, inline images, attachments, and delivery-status handling.
- **CC/BCC support** — compose, save drafts, send, store, and render CC/BCC recipients.
- **Administration** — user and mail management, role-based access controls, and resource limits.
- **Attachments** — receive, store, download, and send files with Cloudflare R2 when configured.
- **Notification integrations** — forward supported events to Telegram, configured mail targets, or the optional hosted push service.
- **Open APIs** — batch user creation and multi-condition mail queries.
- **Verification-code extraction** — optional Workers AI processing for verification-code extraction.
- **Analytics** — ECharts-based system, user, and mail growth dashboards.
- **Customization** — configurable site title, login presentation, transparency, and related UI settings.
- **Turnstile protection** — Cloudflare Turnstile integration for registration and abuse protection.
- **Security hardening** — protected initialization, signed webhooks, encrypted dynamic secrets, hardened sessions, migration checks, and production contract tests.

## Technology stack

- **Platform:** [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- **Backend framework:** [Hono](https://hono.dev/)
- **ORM:** [Drizzle ORM](https://orm.drizzle.team/)
- **Frontend:** [Vue 3](https://vuejs.org/)
- **UI:** [Element Plus](https://element-plus.org/)
- **Mail delivery:** [Resend](https://resend.com/)
- **Cache / state:** [Cloudflare KV](https://developers.cloudflare.com/kv/)
- **Database:** [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **Object storage:** [Cloudflare R2](https://developers.cloudflare.com/r2/)
- **AI:** [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)

## Public repository layout

```text
.
├── mail-worker/                         # Cloudflare Worker backend
│   ├── src/
│   │   ├── api/                         # API routes
│   │   ├── const/                       # Constants
│   │   ├── dao/                         # Data access
│   │   ├── email/                       # Mail receive/processing pipeline
│   │   ├── entity/                      # Data entities
│   │   ├── error/                       # Application errors
│   │   ├── hono/                        # Hono middleware and global handling
│   │   ├── i18n/                        # Backend localization
│   │   ├── init/                        # Initialization logic
│   │   ├── model/                       # Response models
│   │   ├── security/                    # Authentication and authorization
│   │   ├── service/                     # Business services
│   │   ├── template/                    # Message templates
│   │   ├── utils/                       # Utilities
│   │   └── index.js                     # Worker entry point
│   ├── migrations/                      # Versioned D1 migrations
│   ├── scripts/                         # Security and contract tests
│   ├── package.json
│   └── wrangler.toml
│
├── mail-vue/                            # Vue Web client
│   ├── src/
│   │   ├── components/                  # Reusable components
│   │   ├── i18n/                        # Web localization
│   │   ├── layout/                      # Application layout
│   │   ├── perm/                        # Permission handling
│   │   ├── request/                     # API client layer
│   │   ├── router/                      # Routes
│   │   ├── store/                       # State management
│   │   ├── utils/                       # Utilities
│   │   └── views/                       # Pages
│   ├── tests/
│   ├── package.json
│   └── vite.config.js
│
└── .github/workflows/
    └── cloudflare-deploy.yml             # CI + production deployment
```

## Local development

Recommended toolchain:

- Node.js 22
- pnpm 9.15.9
- A Cloudflare account for Worker-backed development

Install and test the Worker:

```bash
cd mail-worker
pnpm install --frozen-lockfile
pnpm test
```

Install and run the Web client:

```bash
cd ../mail-vue
pnpm install --frozen-lockfile
pnpm run dev
```

Build production Web assets into `mail-worker/dist`:

```bash
cd mail-vue
pnpm run build
```

Run the Worker locally after configuring local bindings and secrets:

```bash
cd ../mail-worker
pnpm run dev
```

Do not commit `.dev.vars`, `.env`, API tokens, Worker secrets, or production credentials.

## Production security

Before deploying to production:

1. Use independent random values of at least 32 characters for `JWT_SECRET`, `INIT_SECRET`, and `CONFIG_ENCRYPTION_KEY`.
2. Store secrets in GitHub Actions secrets or Wrangler secrets, never in `wrangler.toml` `[vars]`.
3. Keep legacy unsigned webhook behavior disabled.
4. Keep protected initialization locked outside maintenance windows.
5. Apply versioned D1 migrations during upgrades that change database state.
6. Validate mail send/receive, webhook signatures, object storage, authentication, and `/api/health` before switching production traffic.
7. During configuration-encryption-key rotation, temporarily provide `CONFIG_ENCRYPTION_KEY_PREVIOUS`, complete the re-encryption/migration flow, then remove the previous key.

## Optional hosted push service

CloudMail can submit notification events to the hosted CF Mail Push Service. The default service endpoint used by the Worker is:

```text
https://push.readori.com
```

The feature is optional. To explicitly disable hosted push delivery for a deployment, set:

```text
CFMAIL_PUSH_GATEWAY_URL=disabled
```

Core Web and mail functionality continues to work when the hosted push service is disabled.

## GitHub Actions CI and Cloudflare deployment

The included workflow is:

```text
.github/workflows/cloudflare-deploy.yml
```

It checks out **the repository that is running the workflow**. It works with either a public or private GitHub repository and does not require a separate repository token or a cross-repository checkout.

### Workflow behavior

- **Push / pull request:** install dependencies, run the public Worker/Web test suite, build the production Web assets, and run the frontend smoke test.
- **Manual `verify`:** run the same CI checks without deploying.
- **Manual `deploy`:** run CI checks and deploy the Worker plus Web assets.
- **Manual `deploy-and-migrate`:** deploy, run the protected initialization endpoint, and apply versioned D1 migrations.

For routine releases, use `deploy`. Use `deploy-and-migrate` only when a release includes database or initialization changes.

### Required GitHub Actions secrets

Configure these under **Repository → Settings → Secrets and variables → Actions → Secrets**:

| Secret | Required | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes for deployment | Cloudflare API token with permissions for Workers and the resources used by the deployment. |
| `CLOUDFLARE_ACCOUNT_ID` | Yes for deployment | Cloudflare account ID. |
| `JWT_SECRET` | Yes for deployment | JWT signing secret; at least 32 characters. |
| `INIT_SECRET` | Yes for deployment | Protected initialization secret; at least 32 characters. |
| `CONFIG_ENCRYPTION_KEY` | Yes for deployment | Root key for encrypted dynamic configuration; at least 32 characters. |
| `CONFIG_ENCRYPTION_KEY_PREVIOUS` | No | Previous configuration-encryption key during a key-rotation window only. |
| `RESEND_WEBHOOK_SECRET` | No | Resend webhook signing secret when Resend webhooks are enabled. |
| `LINUXDO_CLIENT_SECRET` | No | OAuth client secret when that integration is enabled. |

`JWT_SECRET`, `INIT_SECRET`, and `CONFIG_ENCRYPTION_KEY` must be different values.

### GitHub Actions variables

Configure these under **Repository → Settings → Secrets and variables → Actions → Variables**:

| Variable | Required | Example / purpose |
| --- | --- | --- |
| `DOMAIN` | Yes for deployment | JSON array of mail domains, for example `["example.com"]`. |
| `ADMIN` | Yes for deployment | Administrator email address. |
| `NAME` | No | Worker/D1/KV resource name. Defaults to `cloud-mail`. |
| `CUSTOM_DOMAIN` | No | Worker custom hostname, for example `mail.example.com`. |
| `D1_DATABASE_ID` | No | Existing D1 database ID. If omitted, the workflow resolves or creates a database named `NAME`. |
| `KV_NAMESPACE_ID` | No | Existing KV namespace ID. If omitted, the workflow resolves or creates a namespace named `NAME`. |
| `R2_BUCKET_NAME` | No | Existing R2 bucket to bind for attachment/object storage. |
| `PROJECT_LINK` | No | Optional project/support URL. |
| `AI_MODEL` | No | Workers AI model. Defaults to `@cf/meta/llama-3.1-8b-instruct`. |
| `ANALYSIS_CACHE` | No | `true` or `false`. Defaults to `false`. |
| `PASSWORD_PBKDF2_ITERATIONS` | No | Defaults to `150000`. |
| `PASSWORD_REHASH_ON_LOGIN` | No | Defaults to `true`. |
| `EMAIL_TRASH_RETENTION_DAYS` | No | Defaults to `30`. |
| `INIT_LOCKED` | No | `true` blocks protected initialization outside a maintenance window. Defaults to `false`. |
| `CLOUDFLARE_EMAIL` | No | `true` enables the Cloudflare `send_email` binding in the generated deployment config. |
| `CFMAIL_PUSH_GATEWAY_URL` | No | Hosted push service override. Use `disabled` to opt out. |
| `LINUXDO_CLIENT_ID` | No | Optional OAuth client ID. |
| `LINUXDO_CALLBACK_URL` | No | Optional OAuth callback URL. |
| `LINUXDO_SWITCH` | No | Optional OAuth feature switch. |

### First deployment

1. Create the required repository secrets and variables.
2. If attachments are required, create an R2 bucket and set `R2_BUCKET_NAME`.
3. Open **Actions → CloudMail CI & Cloudflare Deploy → Run workflow**.
4. Choose `deploy-and-migrate` for the first deployment.
5. After the first deployment, use `deploy` for normal releases unless a schema/init change requires migrations.

The workflow automatically resolves or creates the D1 database and KV namespace when their IDs are not supplied. It renders a temporary `wrangler-ci.toml`, deploys the Web assets together with the Worker, and deletes the temporary secret file after use.

## License

This project is distributed under the [GNU General Public License v3.0](LICENSE).

## Upstream

Cloud Mail is based on [maillab/cloud-mail](https://github.com/maillab/cloud-mail). Please retain upstream notices and comply with the applicable license terms when redistributing modified versions.
