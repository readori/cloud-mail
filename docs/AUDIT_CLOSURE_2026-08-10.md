# CF Mail / CloudMail 工业级审计闭环记录 — 2026-08-10

本文件记录 2026-08-09《CF MAIL / CLOUDMAIL 工业级产品审计与整改报告》在当前源码树中的代码侧闭环状态，以及 2026-08-10 首次安装登录 / CloudMail Server 删除 / 邮箱域名记忆问题的追加整改。

## 1. 结论

- 审计正式整改 ID：**32 / 32 代码侧 closure contract PASS**。
- iOS Phase 11：**PASS**；140 个 Swift source 与 PBX Sources 对齐。
- Cloud-Mail 3.0.0 compatibility：**PASS**。
- Web Node unit/security/API/design/accessibility/workspace：**PASS**。
- Push Gateway syntax/retry/APNs/App Attest/operations：**PASS**。
- Worker 无第三方运行依赖的 security/migration/init/config-secret/web-session/email/push/OpenAPI/i18n/retention/AI/Telegram contracts：**PASS**。
- GitHub workflow YAML + 73 个 `run:` Bash block：**PASS**。
- Supply-chain contract：**PASS**。
- `git diff --check`：**PASS**。

由于当前审计容器没有网络、没有 Xcode/macOS、没有 Apple/Cloudflare 生产账号，也没有真实 APNs/IMAP 测试设备，最终生产环境证据继续由 `docs/EXTERNAL_RELEASE_ACCEPTANCE.md` 管理；代码侧不得把这些外部证据伪装成已验证。

## 2. 2026-08-10 首次安装 / 登录 / Server 生命周期追加整改

### 2.1 首次安装登录失败

修复 Fresh Install 把 CI/build-time CloudMail URL 默认值误迁移成“用户已保存服务器”的问题。

现在只有 `CloudMailConfig.hasUserConfiguredBaseURL == true` 才执行 legacy server migration。构建时 prefill 不再提前占用 Free 版 1 个 CloudMail Server 名额。

### 2.2 CloudMail 邮箱域名推导

服务器 URL 与邮件身份域名分开管理：

```text
https://mail.readori.com  ->  @readori.com
https://mail.example.co.uk -> @example.co.uk
```

优先级：

1. 该服务器上一次成功认证的真实邮箱域名；
2. 服务器公开的 `domainList`；
3. 本机该服务器已有 CloudMail identity 的域名；
4. 从服务器 hostname 推导 registrable/root domain 的首次登录 fallback。

服务器 hostname 不再直接当邮箱 suffix。

### 2.3 登录域名可编辑 / 可选择

首次登录与 Add Account 两个界面都统一为：

```text
username  @  editable-domain  [candidate menu]
```

- 一个候选域名时仍然可手动编辑；
- 多个候选域名时可从菜单选择；
- 在 username 输入框直接粘贴完整 `name@example.com` 会自动拆分；
- 登录提交时重新组合完整邮箱地址。

### 2.4 每服务器记住成功邮箱域名

`CloudMailServerProfile` 新增 `preferredEmailDomain`。

首次成功认证后，以 `/api/my/loginUserInfo` 返回的真实 `user.email` 为权威来源，把 `@domain` 保存到对应 CloudMail Server profile。之后切回该服务器或重新登录时优先恢复该 domain，不使用全局 domain。

### 2.5 删除服务器按钮 no-op 根因

共享 destructive confirmation 原顺序是：

```text
dismiss confirmation
-> Binding setter 清空 pendingRemoval
-> callback 再读取 pendingRemoval
-> nil
-> remove() 根本没有执行
```

已在 Design System 层改为：

```text
execute callback
-> dismiss confirmation
```

因此同类 `pendingRemoval` / `pendingDelete` confirmation 不再发生“点确认但没有动作”。

### 2.6 删除 Server 不再等待远端网络

删除 CloudMail Server 被定义为本地设备操作：

1. 同步快照最小 remote cleanup credential；
2. 立即清理 active local session；
3. 清理本地账号 Keychain、Draft、Scheduled Send、Preferences、Recipient、Snooze、Sync Status、Diagnostics、Mail Cache、Attachment Cache、Search Index、Offline Queue、Send Ledger、Provider Registry；
4. 删除 Server profile；
5. UI 立即完成删除；
6. `/api/device/unregister`、`/api/logout`、Push Gateway subscription delete 在 utility Task 中 best-effort 继续，不阻塞本地删除。

即使 self-hosted CloudMail 已离线，用户也不再被卡在“服务器删不掉”。

## 3. CI / Release 治理最终收口

已删除历史重复入口：

```text
.github/workflows/ios-build.yml
.github/workflows/backend-deploy.yml
.github/workflows/frontend-deploy.yml
```

Cloudflare 只保留一个用户入口：

```text
.github/workflows/cloudflare-deploy.yml
```

内部调用：

```text
.github/workflows/_deploy-cloudflare.yml
```

模式：

```text
deploy
deploy-and-migrate
```

iOS 只保留：

```text
.github/workflows/cloudmail-ios.yml
```

分发模式：

```text
archive
testflight
sideload
both
```

历史 Ad Hoc 路径已退役，并删除：

```text
mail-ios/scripts/ci_archive_ipa.sh
mail-ios/scripts/ci_upload_testflight.sh
mail-ios/scripts/ci_publish_ipa_release.sh
```

TestFlight / Archive 的签名 source of truth 保持 Fastlane Match；不会回退到 CI 自动撤销 Apple Team Distribution certificates 的危险模型。

## 4. 审计 32 项代码侧状态

当前 `.github/scripts/audit_closure_contract.py` 对以下审计 ID 全部 PASS：

```text
SEC-001
PRIV-001
WEB-SEC-001
WEB-SEC-002
BE-SEC-001
BE-SEC-002
REL-001
ASC-001
PRIV-002
PRIV-003
AUTH-001
AUTH-002
DB-001
DB-002
PUSH-001
QA-001
QA-002
ARCH-001
ARCH-002
UX-001
PROD-001
OPS-001
BIZ-001
PRIV-004
WEB-001
BE-001
API-001
UX-002
OPS-002
WEB-002
REL-002
I18N-001
```

其中包括：Privacy Manifest、Draft/Recipient/Mail Cache Data Protection、HttpOnly+CSRF Web Session、CSP/XSS、AES-GCM integration secret、init tombstone、Release Archive Gate、D1 migrations/FK invariants、PBKDF2、atomic limiter、App Attest、Vitest/Node/Web test pyramid、automatic PR gate、legacy iOS UI 删除、大文件拆分、design token、capability schema v2、SLO/runbook、retention、OpenAPI v1、accessibility、supply-chain、i18n 等。

## 5. 本轮验证命令摘要

```bash
# iOS
bash mail-ios/scripts/phase11_static_qa.sh
python3 mail-ios/scripts/test_cloudmail_login_domain_contract.py
python3 mail-ios/scripts/test_server_management_contract.py
bash mail-ios/scripts/test_account_quota_forward_login.sh
bash mail-ios/scripts/test_cloudmail_300_compatibility.sh

# Web
cd mail-vue && npm test

# Push Gateway
cd cfmail-push-gateway && npm test

# Worker (当前无 node_modules 环境可直接执行的 contracts)
node scripts/security-smoke-test.mjs
python3 scripts/security-migration-test.py
python3 scripts/push-gateway-migration-test.py
python3 scripts/versioned-migration-test.py
node scripts/init-security-contract-test.mjs
node scripts/config-secret-crypto-test.mjs
node scripts/web-session-security-contract-test.mjs
node scripts/secret-storage-contract-test.mjs
node scripts/email-list-contract-test.mjs
node scripts/push-webhook-contract-test.mjs
node scripts/openapi-contract-test.mjs
node scripts/i18n-error-contract-test.mjs
node scripts/retention-contract-test.mjs
node scripts/ai-privacy-contract-test.mjs
node scripts/telegram-forward-contract-test.mjs

# Repo closure
python3 .github/scripts/audit_closure_contract.py
python3 .github/scripts/supply_chain_contract_test.py
git diff --check
```

Worker 的 `vitest` 与 rich-email/linkedom runtime suite 需要先执行 frozen dependency install。当前容器无法访问 npm registry，因此没有伪造该执行结果；`pr-quality-gate.yml` 和 Cloudflare deploy workflow 都会先 frozen install 再运行完整 `pnpm audit:test`。

## 6. 仍需外部环境提供的 Release Evidence

这些不是未完成源码任务，而是无法由 Linux 源码审计代替的真实生产验收：

- Xcode 26+ signed Release Archive 与 App Store privacy validation；
- iPhone 6.9-inch `1320 × 2868`、iPad 13-inch `2064 × 2752` 当前 UI screenshot 人工内容审核；
- 真机 App Attest / APNs；
- Cloudflare WAF / rate limit / production alerts；
- D1 Time Travel recovery drill；
- Gmail / Outlook / iCloud / generic IMAP / CloudMail 3.0.0 / enhanced CloudMail 真实 E2E；
- StoreKit / App Store production funnel data。

完整步骤见 `docs/EXTERNAL_RELEASE_ACCEPTANCE.md`。
