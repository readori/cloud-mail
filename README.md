# CloudMail

CloudMail/CF Mail contains four independently deployable components:

- `mail-vue/` — Vue 3 web client.
- `mail-worker/` — self-hostable CloudMail Cloudflare Worker API/backend.

## Web

```bash
cd mail-vue
pnpm install --frozen-lockfile
pnpm run contract:test
pnpm run dev
```

The request layer normalizes Worker pagination contracts before sending requests. Page `num` is always `1...1000000`; endpoint-specific `size` limits are enforced while mail cursors such as `emailId=0` keep their separate first-page semantics.

## Worker

```bash
cd mail-worker
pnpm install --frozen-lockfile
pnpm run security:test
pnpm run security:migration-test
pnpm run email:list:test
pnpm run dev
```

Copy `.dev.vars.example` to `.dev.vars` for local secrets. Never commit `.dev.vars`.

### Remote push for self-hosted CloudMail

CloudMail no longer connects directly to Apple APNs and never stores CF Mail APNs device tokens. To enable CF Mail iOS remote notifications, set:

```text
cfmail_push_gateway_url=https://push.readori.com
```

The Worker stores only a scoped `subscriptionId + pushSecret` and sends privacy-minimized push events to the independent Gateway. See `cfmail-push-gateway/README.md`.

## CF Mail Push Gateway

`cfmail-push-gateway/` is the only component that owns Readori's APNs provider credentials. Deploy it separately and keep its D1 database and Apple `.p8` private. See `cfmail-push-gateway/README.md`.

## iOS

Requirements for a full build: macOS, Xcode 16 or later, and Git.

Direct IMAP/SMTP setup includes provider-aware presets for **163.com, 126.com, yeah.net, QQ Mail / Foxmail, Yahoo Mail, Gmail, Outlook/Hotmail, iCloud Mail and Fastmail**, plus a generic advanced IMAP/SMTP path. For NetEase/QQ accounts the iOS UI explicitly asks for a client authorization code; Yahoo/iCloud-style providers show App Password guidance. Chinese mailbox names such as 收件箱、已发送、草稿箱、已删除 and 垃圾邮件 are normalized to standard mailbox roles.

Production/device builds use MailCore2's upstream Swift Package pinned to commit `8f0923db493ad8fc3e0f33fd0c70f3633e8787a7`. The package supplies the arm64 iOS-device binary required for Archive, IPA and TestFlight. Production CI does not rebuild MailCore2/libetpan from source and does not use the legacy MailCore2 Simulator slice as a release gate.

### Local diagnostics and administrator console

iOS includes a local-only diagnostic center backed by Apple Unified Logging plus bounded JSONL files in Application Support. Diagnostic files use iOS Data Protection, are excluded from backups, rotate at roughly 2 MB per file, and are pruned to seven days / seven files. API timing, IMAP/SMTP phases, sync/offline operations, app lifecycle and network-path state are recorded without message bodies, subjects, attachment contents, credentials or authorization values. Email addresses and account identifiers are replaced with stable short hashes. Nothing is uploaded automatically; the user must explicitly export/share a redacted diagnostic JSON package from **Settings → Support & Diagnostics**.

CloudMail users with administrator permissions also get a permission-gated iOS administrator console mirroring the existing Web/Worker APIs for **Analytics, Users, All Mail, Roles/Permissions, Invite Codes and System Settings**. Visibility and write operations continue to use the exact Worker `permKey` checks such as `analysis:query`, `user:query`, `all-email:delete`, `role:set` and `reg-key:add`; the iOS UI does not bypass backend authorization.

Local project preparation on macOS:

```bash
cd mail-ios
/bin/bash scripts/prepare_xcode_project.sh
```

Static validation:

```bash
/bin/bash scripts/phase11_static_qa.sh
```

### Manual GitHub Actions

Release/deployment workflows are **manual only**. Pull requests and pushes run the dedicated secret-free quality gate, but never perform signing, App Store uploads, or Cloudflare production deployment.

For iOS distribution, open GitHub **Actions → CloudMail iOS → Run workflow**. Choose:

- `archive` — creates and validates a signed Release `.xcarchive` through Fastlane Match without uploading to TestFlight.
- `testflight` — runs the same signed Release Archive Gate, then uploads only after the archive passes.
- `sideload` — builds an unsigned Release IPA and publishes it as a GitHub prerelease for tools such as Sideloadly/AltStore/SideStore to sign locally.
- `both` — produces the sideload prerelease and also runs the signed Archive Gate + TestFlight upload.

**Ad Hoc distribution is retired.** CI no longer creates or revokes Ad Hoc/Distribution assets outside the Fastlane Match source of truth.

`app_version` controls `CFBundleShortVersionString`; `build_number` controls `CFBundleVersion` (blank uses the GitHub run number). `Info.plist` consumes Xcode's `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)` values.

TestFlight/Archive signing uses `readori/readori-certificates` through pinned Fastlane Match in readonly mode by default. Required repository secrets are the App Store Connect/Match values referenced by `.github/workflows/cloudmail-ios.yml`; `signing_bootstrap=true` is an explicit one-time exception when signing assets must be created or updated.

Debug builds use `CloudMail.entitlements` with APNs development entitlement. Release Archive/TestFlight builds use `CloudMailRelease.entitlements` with APNs production entitlement.

## Repository validation

Web contract check:

```bash
cd mail-vue && node scripts/api-contract-test.mjs
```

Worker checks:

```bash
cd mail-worker
pnpm install --frozen-lockfile
pnpm audit:test
```

## Security / release notes

- Passwords and tokens belong in iOS Keychain or Worker secrets/environment bindings, never source control.
- TestFlight upload credentials are read only from GitHub Actions secrets.
- App Store Connect API private keys must never be committed.
- Third-party license files are retained where required.

## Production security secrets

Production CloudMail deployments require three independent Worker secrets with at least 32 characters:

- `jwt_secret` — signs API/native-client JWTs.
- `init_secret` — authorizes `POST /api/init` during a maintenance window.
- `config_encryption_key` — AES-GCM envelope-encryption root for administrator-configured Turnstile, Telegram, Resend and S3 credentials stored in D1/KV.

Set them with Cloudflare Worker Secrets (or the GitHub Actions `JWT_SECRET`, `INIT_SECRET`, and `CONFIG_ENCRYPTION_KEY` secrets). Never place these values in `wrangler.toml` `[vars]`.

For encryption-key rotation, temporarily configure `config_encryption_key_previous` / `CONFIG_ENCRYPTION_KEY_PREVIOUS` with the old value and set `config_encryption_key` to the new value. Run the protected database initialization once; CloudMail decrypts legacy envelopes with the previous key and re-encrypts them with the new key. After verification, remove the previous key.

## Upstream

This project is modified based on [maillab/cloud-mail](https://github.com/maillab/cloud-mail) .
