# CloudMail 自建部署指南

本文只覆盖公开的 CloudMail 组件：`mail-vue`、`mail-worker` 和 `.github/workflows/cloudflare-deploy.yml`。

CloudMail 会把 Vue Web 构建产物写入 `mail-worker/dist`，再与 Worker 一起部署，因此不需要额外创建 Cloudflare Pages 项目。

## 1. 架构

```text
浏览器
  │
  ▼
CloudMail Worker + Vue 静态资源
  │
  ├── D1 数据库                 必需
  ├── Workers KV                必需
  ├── R2 / 外部 S3              可选附件存储
  ├── Cloudflare Email Routing  入站邮件
  ├── Resend / send_email       外发邮件方案
  └── 托管通知服务 URL           可选
```

公开源码目录：

```text
cloud-mail/
├── mail-worker/
├── mail-vue/
└── .github/workflows/
    └── cloudflare-deploy.yml
```

## 2. 前置要求

- Cloudflare 账号
- 托管在 Cloudflare 的域名
- Node.js 22
- pnpm 9.15.9
- D1 和 Workers KV
- 如果需要收邮件：Cloudflare Email Routing
- 可选：R2 或外部 S3，用于附件/对象存储
- 可选：Resend 或 Cloudflare `send_email`，用于向外部邮箱发送邮件

本地安装：

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate

cd mail-worker
pnpm install --frozen-lockfile

cd ../mail-vue
pnpm install --frozen-lockfile
```

## 3. 推荐部署方式：GitHub Actions

公开仓库只需要一个独立 workflow：

```text
.github/workflows/cloudflare-deploy.yml
```

该 workflow 为独立完整版本，不需要额外的源码仓库 Token，也不需要跨仓库 checkout。

workflow 直接 checkout 当前运行 Actions 的仓库，因此无论仓库是 public 还是 private，都采用相同方式运行。

### 运行模式

- `verify`：只测试和构建，不部署。
- `deploy`：测试/构建后部署 Worker + Web 静态资源。
- `deploy-and-migrate`：部署后调用受保护初始化接口，再执行版本化 D1 migrations。

Push 和 Pull Request 默认只运行验证，不自动覆盖生产环境。真正部署时进入：

**GitHub → Actions → CloudMail CI & Cloudflare Deploy → Run workflow**

普通更新使用 `deploy`。首次生产部署或包含数据库/初始化变化的版本使用 `deploy-and-migrate`。

## 4. GitHub Actions 必需 Secrets

位置：**Repository → Settings → Secrets and variables → Actions → Secrets**。

| Secret | 必需 | 用途 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | 是 | Cloudflare API Token，需要 Workers 以及部署所用资源的权限。 |
| `CLOUDFLARE_ACCOUNT_ID` | 是 | Cloudflare Account ID。 |
| `JWT_SECRET` | 是 | JWT 签名密钥，至少 32 字符。 |
| `INIT_SECRET` | 是 | 初始化接口保护密钥，至少 32 字符。 |
| `CONFIG_ENCRYPTION_KEY` | 是 | 动态敏感配置加密主密钥，至少 32 字符。 |
| `CONFIG_ENCRYPTION_KEY_PREVIOUS` | 否 | 配置加密密钥轮换期间临时使用的上一把密钥。 |
| `RESEND_WEBHOOK_SECRET` | 否 | 启用 Resend Webhook 时使用的签名密钥。 |
| `LINUXDO_CLIENT_SECRET` | 否 | 启用对应 OAuth 集成时使用。 |

`JWT_SECRET`、`INIT_SECRET`、`CONFIG_ENCRYPTION_KEY` 必须是三个不同的值。

可使用：

```bash
openssl rand -hex 64
```

生成随机密钥。生产 Secret 不应提交到 Git 仓库，也不要放进公开 Variables。

## 5. GitHub Actions Variables

位置：**Repository → Settings → Secrets and variables → Actions → Variables**。

| Variable | 必需 | 示例 / 用途 |
| --- | --- | --- |
| `DOMAIN` | 是 | 收件域名 JSON 数组，例如 `["example.com"]`。 |
| `ADMIN` | 是 | 管理员邮箱。 |
| `NAME` | 否 | Worker/D1/KV 资源名称，默认 `cloud-mail`。 |
| `CUSTOM_DOMAIN` | 否 | Worker 自定义访问域名，例如 `mail.example.com`。 |
| `D1_DATABASE_ID` | 否 | 已有 D1 ID；不填时 CI 会查找或创建名称为 `NAME` 的数据库。 |
| `KV_NAMESPACE_ID` | 否 | 已有 KV ID；不填时 CI 会查找或创建名称为 `NAME` 的命名空间。 |
| `R2_BUCKET_NAME` | 否 | 已存在的 R2 bucket 名称。 |
| `PROJECT_LINK` | 否 | 项目/支持页面 URL。 |
| `AI_MODEL` | 否 | Workers AI 模型。 |
| `ANALYSIS_CACHE` | 否 | `true` / `false`，默认 `false`。 |
| `PASSWORD_PBKDF2_ITERATIONS` | 否 | 密码 PBKDF2 迭代次数，默认 `150000`。 |
| `PASSWORD_REHASH_ON_LOGIN` | 否 | 默认 `true`。 |
| `EMAIL_TRASH_RETENTION_DAYS` | 否 | 垃圾箱保留天数，默认 `30`。 |
| `INIT_LOCKED` | 否 | `true` 时禁止在非维护窗口执行远程初始化。 |
| `CLOUDFLARE_EMAIL` | 否 | `true` 时在生成配置中启用 Cloudflare `send_email` binding。 |
| `CFMAIL_PUSH_GATEWAY_URL` | 否 | 可选托管通知服务地址；设为 `disabled` 可关闭。 |
| `LINUXDO_CLIENT_ID` | 否 | 启用 OAuth 时的 Client ID。 |
| `LINUXDO_CALLBACK_URL` | 否 | OAuth Callback URL。 |
| `LINUXDO_SWITCH` | 否 | OAuth 功能开关。 |

`DOMAIN` 必须始终使用 JSON 数组格式，即使只有一个域名：

```text
["example.com"]
```

多个域名：

```text
["example.com","example.net"]
```

## 6. D1、KV 和 R2

如果没有填写 `D1_DATABASE_ID` 和 `KV_NAMESPACE_ID`，公开 CI 可以自动查找或创建 D1/KV。

也可以手动创建：

```bash
cd mail-worker
pnpm wrangler login
pnpm wrangler d1 create cloud-mail
pnpm wrangler kv namespace create cloud-mail
```

R2 为可选项。填写 `R2_BUCKET_NAME` 前请先创建 bucket：

```bash
pnpm wrangler r2 bucket create cloud-mail-assets
```

不要在 CI 中填写一个实际不存在的 R2 bucket 名称。

## 7. Email Routing

部署 Worker **不会自动配置入站邮件路由**。

每个收件域名都需要：

1. 开启 **Cloudflare Email Routing**；
2. 完成所需 DNS/MX 配置；
3. 创建 Catch-all 或具体邮箱规则；
4. Action 选择 **Send to a Worker**；
5. 指向当前 CloudMail Worker；
6. 保证 `DOMAIN` Variable 与 Email Routing 中实际使用的域名一致。

之后入站邮件会进入 Worker 的 `email(message, env, ctx)` handler。

## 8. 外发邮件

CloudMail 管理范围内的内部地址可以由应用内部处理。

向外部邮箱发送时，需要配置至少一种受支持方案：

- Resend，并完成对应发件域名配置；或
- Cloudflare `send_email` binding，并设置 `CLOUDFLARE_EMAIL=true`。

没有正确配置外发服务时，不应期待外部收件地址能够正常发送。

## 9. 初始化和数据库迁移

正式支持的初始化接口：

```http
POST /api/init
X-Init-Secret: <INIT_SECRET>
```

生产环境不应继续使用旧式 URL 携带 secret 的初始化方式。

CI 中首次部署或需要 schema/init 更新时使用 `deploy-and-migrate`。workflow 会在部署后调用受保护 init，再执行版本化 D1 migrations。

手动检查示例：

```bash
BASE_URL="https://mail.example.com"

curl -fsS "$BASE_URL/api/health"

curl -fsS -X POST \
  -H "X-Init-Secret: $INIT_SECRET" \
  -H "Accept: text/plain" \
  "$BASE_URL/api/init"
```

如果希望日常运行期间禁止远程初始化，可设置：

```text
INIT_LOCKED=true
```

## 10. 健康检查

部署完成后：

```bash
curl -fsS https://mail.example.com/api/health
```

预期公开响应结构：

```json
{
  "status": "ok",
  "service": "cloudmail",
  "ready": true
}
```

在 `ready=true` 前不要切换正式流量。

## 11. 公开版本地质量检查

Worker：

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

Web：

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

这些就是公开 CI 中使用、并且只依赖 `mail-vue + mail-worker` 的自包含检查。

## 12. 可选托管通知服务

CloudMail 可以把受支持的通知事件发送到托管服务：

```text
https://push.readori.com
```

如需明确关闭：

```text
CFMAIL_PUSH_GATEWAY_URL=disabled
```

关闭后，Web、API、收件、发件、存储和后台管理等核心功能仍然可以正常工作。

托管通知服务的内部实现和基础设施不属于公开自建源码范围。

## 13. 上线前安全检查

- [ ] `JWT_SECRET`、`INIT_SECRET`、`CONFIG_ENCRYPTION_KEY` 足够强且互不相同。
- [ ] Secret 只保存在 GitHub Secrets / Wrangler Secrets，不进入源码。
- [ ] `/api/health` 返回 `ready=true`。
- [ ] D1/KV 已完成初始化。
- [ ] 数据库 migrations 已更新到当前版本。
- [ ] 每个收件域名的 Email Routing 已配置完成。
- [ ] 如果需要外发，已配置并验证外发服务。
- [ ] 附件存储已测试。
- [ ] 登录、退出、Session、管理员权限、写信、CC/BCC、草稿、邮件详情已验证。
- [ ] 生产 CSP 没有阻断错误。
- [ ] 托管通知功能已明确配置或明确关闭。

## 14. 常见问题

### CI 提示缺少 Secret 或 Variable

检查 **Settings → Secrets and variables → Actions**。`DOMAIN`、`ADMIN` 属于 Variables；Cloudflare 凭据和应用密钥属于 Secrets。

### 无法解析 D1 / KV

检查 Cloudflare API Token 权限。也可以手动创建 D1/KV 后填写 `D1_DATABASE_ID` / `KV_NAMESPACE_ID`。

### Worker 部署成功，但收不到邮件

部署 Worker 不会自动创建 Email Routing。重新检查 Email Routing、MX/DNS 以及指向当前 Worker 的规则。

### 内部邮件可以发送，外部收件人失败

请配置 Resend 或 Cloudflare 外发邮件。项目在没有可用外发服务时会拒绝外部发送。

### `/api/health` 返回 `ready=false`

检查 D1、KV、必需 Secret、初始化和 migrations。首次部署或 schema 更新请运行 `deploy-and-migrate`。

### R2 部署失败

设置 `R2_BUCKET_NAME` 前先创建 bucket；或者删除该 Variable，使用当前部署支持的其他存储配置。

## 15. 升级方式

普通代码/Web 更新：

```text
Run workflow → deploy
```

首次部署或包含数据库/init 变化：

```text
Run workflow → deploy-and-migrate
```

每次正式升级后都应检查 `/api/health`、Web 登录、邮件收发和存储。
