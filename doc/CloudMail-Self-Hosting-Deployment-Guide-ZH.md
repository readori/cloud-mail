# CloudMail 最新版自建部署指南（后端 + Web + iOS 对接）

> 面向开源用户的自建文档。本文按当前 CloudMail 项目实际架构整理：`mail-worker` + `mail-vue` 作为一个 Cloudflare Workers 全栈应用部署；D1/KV 为必需资源，R2 可选；CF Mail iOS 通过 CloudMail API 使用自建服务器；远程推送由独立的 `cfmail-push-gateway` 负责。
>
> **推送服务说明：当前官方 CF Mail App 使用公开的托管 Push Gateway：`https://push.readori.com`。这个 URL 本身是公共服务端点，不属于 Secret。真正必须保密的是 Apple APNs `.p8`、`APNS_KEY_ID`、`APNS_TEAM_ID`、Cloudflare API Token、Gateway 数据库/内部凭据等。自建用户也可以完全不使用官方 Gateway，改用自己的 Gateway，或禁用远程推送。

---

## 1. 当前项目结构

核心目录：

```text
cloud-mail/
├── mail-worker/                 # Cloudflare Worker 后端 + API + Email Handler + Worker Assets
├── mail-vue/                    # Vue Web 前端
├── cfmail-push-gateway/         # 独立 APNs Push Gateway
├── mail-ios/                    # CF Mail iOS 客户端
└── .github/workflows/           # GitHub Actions
```

### 1.1 `mail-worker`

负责：

- `/api/*` 后端 API
- 用户、账号、邮件、设置、权限等业务逻辑
- Cloudflare Email Routing 的 `email` handler
- D1 数据访问
- KV Session / 缓存 / 限流等
- R2 / S3 / KV 附件存储
- Web 静态资源托管
- 初始化与数据库迁移
- CloudMail → Push Gateway 的推送 webhook
- 健康检查

### 1.2 `mail-vue`

Vue 前端不是单独部署到 Cloudflare Pages。

当前项目会执行：

```bash
cd mail-vue
pnpm run build
```

构建结果写入 Worker 的静态资源目录，然后由 `mail-worker` 通过 Workers Assets 一起发布。

因此最终是：

```text
浏览器
   │
   ├── /             → Vue / Worker Assets
   └── /api/*        → mail-worker API
```

前后端同源，不需要另外给 Web API 配一个跨域域名。

### 1.3 `cfmail-push-gateway`

这是独立 Worker，不属于普通 CloudMail 自建服务器的必选组件。

它负责：

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

**普通 CloudMail Worker 不保存 Apple APNs `.p8`，也不应该保存 APNs device token。**

---

# 2. 部署前准备

建议：

- Cloudflare Account
- 一个托管在 Cloudflare 的域名
- GitHub 仓库 Fork / Clone
- Node.js 22
- pnpm 9.15.x
- Wrangler
- 可选：Apple Developer Account（仅自己构建 iOS 并自建 Push Gateway 时需要）

安装：

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
```

验证：

```bash
node --version
pnpm --version
```

---

# 3. Cloudflare 资源

## 3.1 D1 — 必需

CloudMail 使用 D1 保存主要关系数据：

- 用户
- 邮箱账号
- 邮件
- 系统设置
- 权限
- 邀请码
- Push Subscription
- 其他业务数据

创建：

```bash
cd mail-worker
pnpm wrangler login
pnpm wrangler d1 create cloud-mail
```

记下：

```text
database_id
```

Worker binding 必须保持：

```toml
binding = "db"
```

不要随意改成 `DB`、`database` 等名称。

---

## 3.2 Workers KV — 必需

KV 用于：

- Session
- 设置缓存
- 限流状态
- 临时/公共 token
- 部分运行时缓存
- 未配置 R2 时的存储 fallback

创建：

```bash
pnpm wrangler kv namespace create cloud-mail
```

记下 namespace ID。

binding 必须保持：

```toml
binding = "kv"
```

---

## 3.3 R2 — 可选但推荐

附件较多时建议创建：

```bash
pnpm wrangler r2 bucket create cloud-mail-assets
```

推荐 binding：

```toml
[[r2_buckets]]
binding = "r2"
bucket_name = "cloud-mail-assets"
```

如果没有 R2，当前项目可回退到其他存储路径；后台也可配置外部 S3。

**生产环境如果长期保存较多附件，建议使用 R2 或 S3，而不是长期依赖 KV。**

---

# 4. Cloudflare Email Routing

仅部署 Worker 不代表已经可以接收邮件。

需要在 Cloudflare Dashboard 中为邮件域名开启：

```text
Email → Email Routing
```

并创建路由，把接收邮件交给 CloudMail Worker。

Worker 项目中已经存在 `email` handler，但 Cloudflare 仍然必须建立 Email Routing 规则。

建议流程：

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

如果使用多个收件域名，确保 `DOMAIN` 与 Email Routing 配置一致。

---

# 5. 必需 Secrets

敏感值不要直接写进：

```text
wrangler.toml
GitHub Actions YAML
README
公开仓库
```

应使用：

```bash
wrangler secret put
```

或 GitHub Repository Secrets。

## 5.1 `JWT_SECRET`

用于 CloudMail 登录/session/JWT。

要求至少 32 字符，建议随机 64 字节：

```bash
openssl rand -hex 64
```

设置：

```bash
pnpm wrangler secret put jwt_secret
```

GitHub Actions Secret 名称：

```text
JWT_SECRET
```

---

## 5.2 `INIT_SECRET`

保护：

```text
POST /api/init
```

必须与 `JWT_SECRET` 不同。

生成：

```bash
openssl rand -hex 64
```

设置：

```bash
pnpm wrangler secret put init_secret
```

GitHub：

```text
INIT_SECRET
```

---

## 5.3 `CONFIG_ENCRYPTION_KEY`

当前安全加固版使用该密钥保护可动态配置的敏感 integration secrets。

要求：

- 至少 32 字符
- 不得与 `JWT_SECRET` 相同
- 不得与 `INIT_SECRET` 相同
- 不要写入 `[vars]`

设置：

```bash
pnpm wrangler secret put config_encryption_key
```

GitHub：

```text
CONFIG_ENCRYPTION_KEY
```

### 密钥轮换

轮换窗口中可临时设置：

```text
CONFIG_ENCRYPTION_KEY_PREVIOUS
```

完成数据库初始化/迁移并确认旧数据已重新加密后，应删除 previous key。

---

# 6. 常用 Variables / Repository Variables

以下不是 APNs 私钥，可根据部署情况配置。

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

示例：

```text
NAME=cloud-mail
DOMAIN=["example.com"]
ADMIN=admin@example.com
CUSTOM_DOMAIN=mail.example.com
R2_BUCKET_NAME=cloud-mail-assets
```

`DOMAIN` 是 JSON 数组，不是普通字符串：

```text
["example.com"]
```

多域名：

```text
["example.com","example.net"]
```

---

# 7. 可选 Secrets

根据功能启用：

```text
LINUXDO_CLIENT_SECRET
RESEND_WEBHOOK_SECRET
CONFIG_ENCRYPTION_KEY_PREVIOUS
```

这些仍应通过 Worker Secret / GitHub Secret 管理。

---

# 8. 本地安装与 QA

Clone：

```bash
git clone https://github.com/readori/cloud-mail.git
cd cloud-mail
```

## 8.1 后端

```bash
cd mail-worker
pnpm install --frozen-lockfile
```

建议部署前至少运行当前项目已有的安全与契约测试：

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

如果某个 script 在你 Fork 的版本中不存在，以该版本 `package.json` 中的实际 scripts 为准。

## 8.2 Web

```bash
cd ../mail-vue
pnpm install --frozen-lockfile
pnpm run security:test
pnpm run contract:test
pnpm run build
```

Web build 后应生成 Worker Assets 所需的 `dist` 内容。

---

# 9. 使用 GitHub Actions 部署 CloudMail

当前整理后的仓库建议只保留一个 Cloudflare 主入口，例如：

```text
.github/workflows/cloudflare-deploy.yml
```

底层可继续调用 reusable workflow：

```text
.github/workflows/_deploy-cloudflare.yml
```

在 GitHub：

```text
Repository
→ Settings
→ Secrets and variables
→ Actions
```

添加前述 Secrets / Variables。

然后：

```text
Actions
→ Cloudflare Deploy
→ Run workflow
```

第一次部署使用带数据库初始化/迁移的模式，例如：

```text
deploy-and-migrate
```

后续普通代码更新使用：

```text
deploy
```

> 如果你 Fork 的 workflow 名称略有不同，以仓库 `.github/workflows/` 中实际文件为准；不要同时保留多个功能完全相同的 backend/frontend deploy workflow。

---

# 10. Wrangler CLI 手动部署

如果不使用 GitHub Actions：

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

确认 Wrangler 配置包含：

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

可选 R2：

```toml
[[r2_buckets]]
binding = "r2"
bucket_name = "cloud-mail-assets"
```

上传 Secrets：

```bash
pnpm wrangler secret put jwt_secret
pnpm wrangler secret put init_secret
pnpm wrangler secret put config_encryption_key
```

部署：

```bash
pnpm wrangler deploy
```

---

# 11. 初始化 / 数据库迁移

部署完成后不要使用：

```text
GET /api/init/<secret>
```

生产环境应使用受 Header 保护的：

```text
POST /api/init
```

示例：

```bash
BASE_URL="https://mail.example.com"

curl -fsS "$BASE_URL/api/health"

curl -fsS -X POST \
  -H "X-Init-Secret: $INIT_SECRET" \
  -H "Accept: text/plain" \
  "$BASE_URL/api/init"
```

成功预期：

```text
success
```

该初始化入口应设计为可重复执行，用于：

- 首次建表
- 数据库版本升级
- 安全迁移
- Push subscription schema 更新
- 配置 secret 加密迁移

生产环境完成迁移后，可根据你的维护策略使用 `INIT_LOCKED` 限制初始化入口。

---

# 12. 健康检查

CloudMail：

```bash
curl -fsS https://mail.example.com/api/health
```

正常状态应类似：

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

关键判断：

```text
HTTP 200 不等于 ready=true
```

至少确认：

```text
ready = true
d1 = true
kv = true
jwtSecret = true
initSecret = true
```

---

# 13. Web 上线验证

打开：

```text
https://mail.example.com
```

检查：

1. 首页正常加载。
2. `/login` 正常加载。
3. 登录成功。
4. 浏览器 F12 Console 没有阻断级 CSP 错误。
5. `/api/*` 请求同源正常。
6. Dark / Light 主题正常。
7. Iconify 图标正常。
8. Cloudflare Turnstile（启用时）正常。
9. 附件上传/下载正常。
10. 发信/收信正常。

如果启用了严格 CSP，请确保需要的第三方域名有精确白名单，不要为了消除报错简单加入：

```text
script-src 'unsafe-inline'
connect-src https:
```

---

# 14. iOS 对接 CloudMail 自建服务器

CF Mail iOS 的 CloudMail Account 需要连接用户自己的 CloudMail Server。

用户在 iOS 中添加服务器时填写：

```text
Server URL:
https://mail.example.com
```

不要填写：

```text
https://mail.example.com/api
```

客户端会自行调用 `/api/*`。

建议服务器必须：

- HTTPS
- 有效公开证书
- 不使用自签名证书
- `/api/health` 正常
- Web 登录正常
- D1 / KV 已初始化
- 用户账户已建立

---

# 15. iOS 登录链路

典型链路：

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

iOS 端使用的是 CloudMail API，而不是 Web 页面 DOM。

Web 与 iOS 共用同一个后端业务数据，但认证客户端行为可能不同，因此不要通过修改 Web localStorage token 的方式“兼容 iOS”。

---

# 16. Push Gateway 隐私架构

这是当前版本很重要的边界。

## 16.1 不应该发生

自建 CloudMail Worker 不应该接收：

```text
Apple .p8
APNS_KEY_ID
APNS_TEAM_ID
raw APNs device token
```

这些信息只属于独立 Push Gateway。

## 16.2 当前安全链路

### 第一步：iOS → Gateway

```http
POST https://push.readori.com/v1/subscriptions
```

示例：

```json
{
  "deviceToken": "<APNs token>",
  "installationId": "<installation UUID>",
  "accountId": "<local CloudMail profile UUID>",
  "environment": "production"
}
```

Gateway 返回：

```json
{
  "subscriptionId": "ps_...",
  "pushSecret": "pgs_..."
}
```

iOS 将 scoped credential 存在 Keychain。

### 第二步：iOS → 用户自建 CloudMail

```http
POST https://mail.example.com/api/device/register
```

发送：

```json
{
  "subscriptionId": "ps_...",
  "pushSecret": "pgs_...",
  "accountId": "<local profile UUID>"
}
```

该 API 仍需要正常 CloudMail 用户认证。

### 第三步：CloudMail → Gateway

有新邮件时：

```http
POST https://push.readori.com/v1/push
Authorization: Bearer <pushSecret>
```

CloudMail 发送最小化事件：

```json
{
  "subscriptionId": "ps_...",
  "event": "new_mail",
  "emailId": 123
}
```

### 第四步：Gateway → APNs

Gateway 持有 APNs provider 凭据并向 Apple 发送通知。

这样：

```text
用户自建 CloudMail
    不知道 APNs token
    不知道 Apple .p8
    不知道 Team ID
    不知道 Key ID
```

Gateway 不需要拿到用户 CloudMail 登录密码。

---

# 16.3 官方 Gateway 与自建 Gateway

官方 CF Mail App 当前可使用：

```text
https://push.readori.com
```

这是官方托管 Gateway 的公共入口。

自建用户有三种选择：

```text
A. 使用官方 Gateway
CFMAIL_PUSH_GATEWAY_URL=https://push.readori.com

B. 使用自己的 Gateway
CFMAIL_PUSH_GATEWAY_URL=https://push.example.com

C. 不使用远程推送
CFMAIL_PUSH_GATEWAY_URL=
```

CloudMail 核心邮件功能与 Web/iOS API 不应依赖 Gateway 才能工作；Gateway 只负责远程通知链路。

# 17. 是否必须部署 Push Gateway？

不是。

如果用户只需要：

- Web Mail
- iOS 手动刷新/同步
- 邮件收发
- CloudMail API

可以不启用 Push Gateway。

此时：

```text
CFMAIL_PUSH_GATEWAY_URL=
```

远程 APNs 推送不可用，但核心邮件功能应继续工作。

---

# 18. 官方 Push Gateway 的公开策略

当前项目建议把：

```text
https://push.readori.com
```

明确公开为：

```text
Official CF Mail Push Gateway
官方 CF Mail 托管推送网关
```

这是**公共服务端点**，不是 Secret。

普通自建用户如果使用官方 CF Mail App，可以直接使用该 Gateway，而不需要拥有 Apple APNs 凭据。

但以下内容仍然绝对不能公开：

```text
APNS_PRIVATE_KEY
APNS_KEY_ID
APNS_TEAM_ID
Cloudflare API Token
Gateway D1 内部数据
任何内部管理凭据
```

推荐公开配置方式：

```text
# 使用官方 CF Mail Push Gateway
CFMAIL_PUSH_GATEWAY_URL=https://push.readori.com
```

如果用户希望完全自托管：

```text
CFMAIL_PUSH_GATEWAY_URL=https://push.example.com
```

如果用户不需要远程推送：

```text
CFMAIL_PUSH_GATEWAY_URL=
```

或按当前部署脚本/运行时支持的禁用值设置为明确的 disabled/empty 配置。

## 为什么可以公开 Gateway URL？

因为公开一个 HTTPS API endpoint 与公开 Secret 是两件事。

公开：

```text
https://push.readori.com
```

只说明“客户端/CloudMail 应该向哪里发送 Push Gateway 请求”。

它不会泄露：

- Apple `.p8`
- Apple Team ID
- APNs Key ID
- Cloudflare Account Token
- 用户 CloudMail 登录密码
- Gateway 内部数据库凭据

真正的安全性来自：

- scoped `subscriptionId`
- scoped `pushSecret`
- API 输入验证
- WAF / Rate Limit
- D1 subscription 限制
- Queue / DLQ
- 日志脱敏
- 不让 CloudMail Worker 持有 APNs provider credentials

## 官方 Gateway 的运营建议

既然这是公共 Hosted Service，建议生产环境至少配置：

- Cloudflare WAF
- Rate Limiting
- Bot / abuse protection
- Subscription 数量限制
- 单 installation/source 去重
- Queue / DLQ 告警
- APNs 错误率监控
- 日志 device token 脱敏
- 不记录完整 `pushSecret`
- 独立隐私说明
- 独立服务可用性说明

这样可以在公开服务 URL 的同时，继续保护真正敏感的生产基础设施。

# 19. 用户自建 Push Gateway

只有在以下场景才需要：

- 用户自己编译 iOS App；
- 用户拥有自己的 Apple Developer Account；
- 用户使用自己的 Bundle ID；
- 用户希望完全自己掌控 APNs。

目录：

```bash
cd cfmail-push-gateway
npm install
npm test
```

创建 D1：

```bash
npx wrangler d1 create cfmail-push-gateway
```

创建 Queues：

```bash
npx wrangler queues create cfmail-apns-retry
npx wrangler queues create cfmail-apns-dead-letter
```

应用 migration：

```bash
npm run db:migrate:remote
```

设置：

```bash
npx wrangler secret put APNS_KEY_ID
npx wrangler secret put APNS_TEAM_ID
npx wrangler secret put APNS_PRIVATE_KEY
```

设置自己的 Bundle ID：

```toml
[vars]
APNS_BUNDLE_ID = "com.example.cfmail"
```

部署：

```bash
npm run deploy
```

绑定你自己的自定义域名，例如：

```text
https://push.example.com
```

然后 CloudMail 配置：

```text
CFMAIL_PUSH_GATEWAY_URL=https://push.example.com
```

---

# 20. 重要：官方 App Store iOS 与自建 Gateway

Apple Push Notification 不是“知道 URL 就能发”。

APNs provider credential 与：

```text
Apple Developer Team
APNs Key
Bundle ID / Topic
```

绑定。

因此：

### 使用官方 App Store CF Mail

普通自建用户不应该拿到官方：

```text
APNS_PRIVATE_KEY
APNS_KEY_ID
APNS_TEAM_ID
```

这些永远不能写入开源仓库或部署教程。

### 自己编译 iOS

用户可以：

1. 换成自己的 Bundle ID；
2. 使用自己的 Apple Developer Team；
3. 创建自己的 APNs Key；
4. 自建 `cfmail-push-gateway`；
5. 修改 iOS 的 Gateway Base URL；
6. 重新签名安装。

---

# 21. Push Gateway 健康检查

```bash
curl -fsS https://push.example.com/healthz
```

当前 Gateway 健康检查应至少返回服务正常状态，并可反映 Retry Queue 是否绑定。

运行时重点监控：

```text
push delivered
push queued
retry delivered
retry rescheduled
subscription deactivated
APNs permanent failure
```

并检查：

```text
cfmail-apns-dead-letter
```

是否持续有消息。

---

# 22. Push Gateway 可靠性

当前架构使用：

- APNs Provider JWT 缓存
- Warm isolate memory cache
- D1 provider-token cache
- Provider JWT 提前刷新
- `ExpiredProviderToken` 单次强制刷新
- 首次立即 APNs 请求
- 仅失败后进入 Queue
- 延迟 retry
- Dead Letter Queue
- 无效 device token 自动失活

因此不要自己在 CloudMail Worker 里再写第二套 APNs 直连代码。

---

# 23. iOS 推送上线验证

真实 APNs 必须使用真机验证。

推荐顺序：

1. 部署 Gateway。
2. 检查 `/healthz`。
3. 部署 CloudMail。
4. 执行 `POST /api/init`。
5. iOS 安装最新 TestFlight / Release。
6. 登录 CloudMail Account。
7. 允许通知权限。
8. iOS 获得 APNs token。
9. iOS 成功创建 Gateway subscription。
10. iOS 成功向 CloudMail 注册 scoped subscription。
11. 发一封新邮件。
12. CloudMail 写入邮件。
13. CloudMail 调用 Gateway。
14. Gateway 调用 APNs。
15. 锁屏检查系统通知。
16. 前台检查 CF Mail in-app banner。
17. 检查通知预览模式是否与设置一致。

如果系统：

```text
Settings → Notifications → CF Mail → Show Previews
```

不是 `Always`，iOS 可能主动隐藏通知正文，这不是 CloudMail 服务端错误。

---

# 24. 推荐生产部署顺序

完整生产顺序：

```text
1. Fork / Clone
2. 创建 Cloudflare D1
3. 创建 KV
4. 可选创建 R2
5. 配置 Email Routing
6. 配置 GitHub Secrets / Variables
7. 构建 mail-vue
8. 执行 Worker QA
9. 部署 mail-worker + Worker Assets
10. GET /api/health
11. POST /api/init
12. 再次 GET /api/health
13. Web 登录测试
14. 收件测试
15. 发件测试
16. iOS 添加自建 CloudMail Server
17. iOS 登录 / 同步测试
18. 如需 Push，再配置独立 Gateway
19. 真机 APNs 测试
20. 检查日志 / Queue / DLQ
```

如果是数据库升级：

```text
部署新 Worker
→ POST /api/init
→ 验证 health
→ 验证 Web
→ 验证 iOS
```

---

# 25. 上线后的最低验证清单

## Worker

```text
[ ] /api/health ready=true
[ ] D1=true
[ ] KV=true
[ ] JWT Secret 正常
[ ] INIT Secret 正常
[ ] CONFIG_ENCRYPTION_KEY 已配置
```

## Web

```text
[ ] 首页
[ ] 登录
[ ] CSP
[ ] Turnstile
[ ] Iconify
[ ] Light/Dark
[ ] 邮件列表
[ ] 邮件详情
[ ] 写信
[ ] 附件
[ ] 管理后台
```

## 邮件

```text
[ ] Email Routing
[ ] 入站
[ ] 出站
[ ] 多域名
[ ] 附件
[ ] 转发
```

## iOS

```text
[ ] HTTPS Server
[ ] CloudMail 登录
[ ] Inbox
[ ] Sent
[ ] Draft
[ ] Compose
[ ] Attachment
[ ] Background refresh
```

## Push（启用时）

```text
[ ] Gateway /healthz
[ ] Subscription create
[ ] Subscription refresh
[ ] CloudMail device/register
[ ] new_mail webhook
[ ] APNs delivered
[ ] Queue retry
[ ] DLQ=0（稳态）
[ ] Logout unregister
```

---

# 26. 安全红线

永远不要提交：

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

不要把这些值：

- 写进 README；
- 写进截图；
- 打印进 GitHub Actions log；
- 放在前端 `VITE_*` 环境变量；
- 放进 iOS bundle；
- 写入公开 issue。

---

# 27. 结论

当前 CloudMail 的推荐自建模型是：

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

最重要的边界：

> **CloudMail 自建服务器属于用户；APNs Provider Credentials 不属于普通 CloudMail Worker。**
>
> 开源自建文档可以公开官方 Push Gateway 的公共服务 URL，但绝不能公开任何 Apple APNs provider credentials、Cloudflare Token、Gateway 内部凭据或其他真正的 Secret。
