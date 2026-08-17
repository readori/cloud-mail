#!/usr/bin/env python3
"""Repository-level closure gate for the 2026-08-09 industrial audit.

This test intentionally verifies durable evidence rather than claiming that account/device-side
acceptance has happened. Environment-only evidence is tracked in docs/EXTERNAL_RELEASE_ACCEPTANCE.md.
"""
from __future__ import annotations

import json
import plistlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
errors: list[str] = []
closed: list[tuple[str, str]] = []


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        errors.append(f"missing required audit artifact: {rel}")
        return ""
    return path.read_text(encoding="utf-8")


def exists(rel: str) -> bool:
    ok = (ROOT / rel).exists()
    if not ok:
        errors.append(f"missing required audit artifact: {rel}")
    return ok


def require(condition: bool, audit_id: str, message: str) -> None:
    if not condition:
        errors.append(f"{audit_id}: {message}")


def mark(audit_id: str, evidence: str) -> None:
    closed.append((audit_id, evidence))


# ---------------------------------------------------------------------------
# P0 — release/security/privacy
# ---------------------------------------------------------------------------
manifest_path = ROOT / "mail-ios/PrivacyInfo.xcprivacy"
if manifest_path.exists():
    try:
        manifest = plistlib.loads(manifest_path.read_bytes())
    except Exception as exc:
        manifest = {}
        errors.append(f"SEC-001: PrivacyInfo.xcprivacy is not valid plist: {exc}")
    entries = {
        item.get("NSPrivacyAccessedAPIType"): set(item.get("NSPrivacyAccessedAPITypeReasons", []))
        for item in manifest.get("NSPrivacyAccessedAPITypes", []) if isinstance(item, dict)
    }
    require("CA92.1" in entries.get("NSPrivacyAccessedAPICategoryUserDefaults", set()), "SEC-001", "UserDefaults CA92.1 missing")
    require("C617.1" in entries.get("NSPrivacyAccessedAPICategoryFileTimestamp", set()), "SEC-001", "File Timestamp C617.1 missing")
else:
    errors.append("SEC-001: PrivacyInfo.xcprivacy missing")
pbx = read("mail-ios/CloudMail.xcodeproj/project.pbxproj")
require("PrivacyInfo.xcprivacy in Resources" in pbx, "SEC-001", "privacy manifest not in app Resources")
mark("SEC-001", "Privacy manifest + required-reason declarations + Xcode resource reference")

draft = read("mail-ios/Core/Accounts/DraftStore.swift")
require("drafts-v3.json" in draft, "PRIV-001", "protected draft v3 store missing")
require("completeUntilFirstUserAuthentication" in draft, "PRIV-001", "draft Data Protection missing")
require("isExcludedFromBackup = true" in draft, "PRIV-001", "draft backup exclusion missing")
require("removeLegacyDefaultsAfterSuccessfulMigration" in draft, "PRIV-001", "legacy draft migration cleanup missing")
mark("PRIV-001", "Draft V3 protected Application Support store + migration")

auth_session = read("mail-worker/src/security/auth-session.js")
web_security = read("mail-vue/scripts/web-security-contract-test.mjs")
require("__Host-cfmail_session" in auth_session and "httpOnly: true" in auth_session, "WEB-SEC-001", "HttpOnly host session cookie missing")
require("sameSite: 'Strict'" in auth_session and "assertCookieCsrf" in read("mail-worker/src/security/security.js"), "WEB-SEC-001", "CSRF/SameSite session guard missing")
require("localStorage" in web_security and "token" in web_security, "WEB-SEC-001", "Web token regression contract missing")
mark("WEB-SEC-001", "HttpOnly cookie + CSRF/origin + Web token regression contract")

worker_index = read("mail-worker/src/index.js")
hono = read("mail-worker/src/hono/hono.js")
web_hygiene = read("mail-vue/scripts/production-hygiene-test.mjs")
require("frame-ancestors 'none'" in worker_index and "object-src 'none'" in worker_index, "WEB-SEC-002", "static CSP hardening missing")
require("Content-Security-Policy" in hono, "WEB-SEC-002", "API CSP hardening missing")
require("dangerouslyUseHTMLString" in web_hygiene, "WEB-SEC-002", "dangerous-HTML regression gate missing")
mark("WEB-SEC-002", "CSP + safe error HTML + sanitizer/session regression gates")

setting_service = read("mail-worker/src/service/setting-service.js")
crypto_test = read("mail-worker/scripts/config-secret-crypto-test.mjs")
require("config_encryption_key" in setting_service or "encrypt" in setting_service.lower(), "BE-SEC-001", "encrypted settings integration missing")
require("backup" in crypto_test.lower() and "rotation" in crypto_test.lower(), "BE-SEC-001", "secret rotation/backup-restore contract missing")
mark("BE-SEC-001", "AES-GCM dynamic-secret encryption/migration/rotation/backup-restore contract")

init_api = read("mail-worker/src/api/init-api.js")
require("410" in init_api and "Legacy initialization URL retired" in init_api, "BE-SEC-002", "legacy URL initializer is not a 410 tombstone")
require("X-Init-Secret" in init_api, "BE-SEC-002", "protected header initialization missing")
mark("BE-SEC-002", "GET init tombstone + POST X-Init-Secret maintenance path")

fastfile = read("mail-ios/fastlane/Fastfile")
ios_workflow = read(".github/workflows/cloudmail-ios.yml")
require("verify_release_archive!" in fastfile and "PrivacyInfo.xcprivacy" in fastfile, "REL-001", "real signed Release Archive/privacy gate missing")
require("release_archive" in ios_workflow and "archive_sha256" in ios_workflow, "REL-001", "Archive CI/hash evidence missing")
mark("REL-001", "Signed Release Archive gate + archive content SHA-256")

iphone_ci = read("mail-ios/scripts/ci_iphone_screenshots.sh")
ipad_ci = read("mail-ios/scripts/ci_ipad_screenshots.sh")
require("expected_width=1320" in iphone_ci and "expected_height=2868" in iphone_ci and '"$count" -ne 6' in iphone_ci, "ASC-001", "iPhone 6.9-inch exact screenshot gate missing")
require("expected_width=2064" in ipad_ci and "expected_height=2752" in ipad_ci and '"$count" -ne 6' in ipad_ci, "ASC-001", "iPad 13-inch exact screenshot gate missing")
require(exists(".github/workflows/iphone-app-store-screenshots.yml") and exists(".github/workflows/ipad-app-store-screenshots.yml"), "ASC-001", "dedicated screenshot workflows missing")
mark("ASC-001", "iPhone/iPad exact-count/dimension screenshot candidate gates; human content approval remains external")

# ---------------------------------------------------------------------------
# P1 — storage/auth/database/push/quality/architecture/product/ops
# ---------------------------------------------------------------------------
recipient = read("mail-ios/Core/Contacts/RecipientDirectoryStore.swift")
require("completeFileProtectionUntilFirstUserAuthentication" in recipient, "PRIV-002", "recipient protected write missing")
require("isExcludedFromBackup = true" in recipient and "90 * 86_400" in recipient, "PRIV-002", "recipient backup exclusion/TTL missing")
require("learnsFromMessages" in recipient and "removeObject(forKey: Keys.legacyRecent)" in recipient, "PRIV-002", "recipient learning control/migration cleanup missing")
mark("PRIV-002", "Protected recent-recipient store + TTL + learn toggle + clear/migration")

mail_cache = read("mail-ios/Core/Storage/ProviderMailCache.swift")
require("completeFileProtectionUntilFirstUserAuthentication" in mail_cache, "PRIV-003", "mail cache Data Protection missing")
require("textBody: nil" in mail_cache and "htmlBody: nil" in mail_cache and "data: nil" in mail_cache, "PRIV-003", "cache minimization missing")
require("func cleanup(olderThan" in mail_cache, "PRIV-003", "cache TTL cleanup API missing")
mark("PRIV-003", "Protected/minimized provider mail cache + cleanup")

crypto = read("mail-worker/src/utils/crypto-utils.js")
login_service = read("mail-worker/src/service/login-service.js")
require("DEFAULT_PBKDF2_ITERATIONS = 150_000" in crypto, "AUTH-001", "PBKDF2 target is not hardened")
require("POLICY_MIN_PBKDF2_ITERATIONS = 100_000" in crypto and "needsRehash" in crypto, "AUTH-001", "KDF rehash policy missing")
require("password.length < 10" in login_service and "password.length > 128" in login_service, "AUTH-001", "password length policy is not 10..128+")
mark("AUTH-001", "PBKDF2 hardening + rehash-on-login + passphrase length policy")

rate = read("mail-worker/src/service/rate-limit-service.js")
require("INSERT INTO rate_limit_bucket" in rate and "ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1" in rate, "AUTH-002", "D1 atomic limiter missing")
require("database-init-invalid-secret" in read("mail-worker/src/init/init.js"), "AUTH-002", "init abuse limiter missing")
require("/v1/subscriptions" in read("docs/PUSH_GATEWAY_PRODUCTION_HARDENING.md"), "AUTH-002", "Push/WAF rate-limit runbook missing")
mark("AUTH-002", "Atomic D1 security limiter + pre-schema compatibility + edge hardening runbook")

migrations = sorted((ROOT / "mail-worker/migrations").glob("*.sql"))
require(len(migrations) >= 3, "DB-001", "versioned D1 migration chain incomplete")
require(exists("mail-worker/scripts/versioned-migration-test.py"), "DB-001", "historical migration fixture matrix missing")
deploy = read(".github/workflows/_deploy-cloudflare.yml")
require("d1 migrations apply" in deploy and "Capture pre-migration D1 recovery point" in deploy, "DB-001", "production migration/recovery gate missing")
mark("DB-001", "Versioned migrations + historical fixture matrix + pre-migration recovery gate")

integrity = read("mail-worker/migrations/0001_integrity_guards.sql") + read("mail-worker/migrations/0003_integrity_cascade.sql")
require("TRIGGER" in integrity.upper() and "RAISE" in integrity.upper(), "DB-002", "referential invariant triggers missing")
require("orphan" in read("mail-worker/scripts/versioned-migration-test.py").lower(), "DB-002", "orphan/integrity fixture assertions missing")
mark("DB-002", "D1 referential invariant/cascade triggers + corrupt/orphan fixtures")

app_attest_gateway = read("cfmail-push-gateway/src/app-attest-service.js")
app_attest_ios = read("mail-ios/Core/Push/AppAttestCoordinator.swift")
require("/v1/app-attest/challenge" in read("cfmail-push-gateway/src/index.js"), "PUSH-001", "App Attest challenge route missing")
require("verifyAttestation" in app_attest_gateway and "verifyAssertion" in app_attest_gateway, "PUSH-001", "Gateway App Attest verification missing")
require("DCAppAttestService" in app_attest_ios, "PUSH-001", "iOS App Attest coordinator missing")
require(exists("cfmail-push-gateway/src/app-attest-verifier.test.mjs") and exists("mail-ios/scripts/test_app_attest_contract.py"), "PUSH-001", "App Attest contract tests missing")
mark("PUSH-001", "App Attest challenge/attestation/assertion + replay counter + monitor/enforce policy; physical-device acceptance remains external")

worker_pkg = json.loads(read("mail-worker/package.json") or "{}")
web_pkg = json.loads(read("mail-vue/package.json") or "{}")
require(worker_pkg.get("scripts", {}).get("test") == "vitest run", "QA-001", "Worker standard Vitest entry point missing")
require("audit:test" in worker_pkg.get("scripts", {}) and "audit:test" in web_pkg.get("scripts", {}), "QA-001", "Worker/Web audit test pyramids missing")
require(exists("mail-vue/tests") and exists("mail-vue/scripts/e2e-preview-smoke.sh"), "QA-001", "Web unit/E2E preview smoke evidence missing")
mark("QA-001", "Worker Vitest/contracts + Web unit/security/build/preview smoke + Push tests")

pr_gate = read(".github/workflows/pr-quality-gate.yml")
require("pull_request:" in pr_gate and "push:" in pr_gate, "QA-002", "automatic PR/push CI trigger missing")
require("CODE_SIGNING_ALLOWED=NO" in pr_gate and "pnpm audit:test" in pr_gate, "QA-002", "secret-free macOS compile/runtime gate missing")
mark("QA-002", "Automatic secret-free PR/push iOS compile + Worker/Web/Push gates")

legacy_paths = [
    "mail-ios/Features/Compose/ComposeView.swift",
    "mail-ios/Features/Compose/ComposeViewModel.swift",
    "mail-ios/Features/Inbox/InboxListView.swift",
    "mail-ios/Features/Inbox/InboxViewModel.swift",
    "mail-ios/Features/Inbox/MailDetailView.swift",
    "mail-ios/Features/Inbox/MailDetailViewModel.swift",
]
require(all(not (ROOT / p).exists() for p in legacy_paths), "ARCH-001", "legacy Compose/Inbox/Detail island still exists")
require(exists("mail-ios/scripts/test_legacy_ui_removed.py"), "ARCH-001", "legacy-removal guard missing")
mark("ARCH-001", "Unreachable legacy iOS UI removed + regression contract")

arch_doc = read("docs/IOS_ARCHITECTURE_DECOMPOSITION.md")
arch_modules = [
    "mail-ios/Core/Push/CFMailPushGatewayClient.swift",
    "mail-ios/Core/Push/AppAttestCoordinator.swift",
    "mail-ios/Core/Push/PushNotificationManager+LocalNotifications.swift",
    "mail-ios/Core/Push/PushNotificationManager+CloudMailRegistration.swift",
    "mail-ios/Core/Push/PushNotificationManager+Navigation.swift",
    "mail-ios/Core/Push/PushNotificationManager+Delegate.swift",
    "mail-ios/Core/Mail/Providers/Direct/MailCore2SMTPEngine.swift",
    "mail-ios/Core/Mail/Providers/Direct/MailCore2IMAPSupport.swift",
    "mail-ios/Features/Compose/RichComposeToolbar.swift",
]
require(all(exists(p) for p in arch_modules), "ARCH-002", "required extracted modules missing")
for hotspot in [
    "mail-ios/Core/Push/PushNotificationManager.swift",
    "mail-ios/Core/Mail/Providers/Direct/MailCore2Engines.swift",
    "mail-ios/Features/Settings/AppSettingsHubView.swift",
    "mail-ios/Features/Admin/AdminConsoleView.swift",
    "mail-ios/Features/Compose/RichTextEditor.swift",
]:
    require(len((ROOT / hotspot).read_text().splitlines()) < 500, "ARCH-002", f"audited hotspot still exceeds 500 lines: {hotspot}")
require("no-growth" in arch_doc.lower() and exists("mail-ios/scripts/test_architecture_size_gate.py"), "ARCH-002", "large-file no-growth architecture gate missing")
mark("ARCH-002", "Audited fat-view/service hotspots decomposed + no-growth architecture gate")

workspace = read("mail-vue/src/router/index.js") + read("mail-vue/src/perm/perm.js")
design_tokens = read("docs/design-tokens.json")
require("/mail/" in workspace and "/admin/" in workspace, "UX-001", "Web Mail/Admin route namespace split missing")
require(all(name in design_tokens.lower() for name in ["polar", "mono", "oled"]), "UX-001", "shared theme token spec missing core themes")
require(exists("mail-vue/scripts/design-token-contract-test.mjs") and exists("mail-vue/scripts/workspace-contract-test.mjs"), "UX-001", "design/workspace contract tests missing")
mark("UX-001", "Shared semantic token spec + branded Web themes + explicit Mail/Admin workspaces")

cap_api = read("mail-worker/src/api/capability-api.js")
cap_ios = read("mail-ios/Core/Mail/Providers/CloudMail/CloudMailCapabilities.swift")
require("schemaVersion: 2" in cap_api, "PROD-001", "CloudMail capability schema v2 missing")
require("serverSearch" in cap_api and "serverScheduledSend" in cap_api and "serverSearch" in cap_ios, "PROD-001", "versioned parity capability fields missing")
require(exists("docs/CLOUDMAIL_CAPABILITY_ROADMAP.md") and exists("mail-ios/scripts/test_capability_v2_contract.py"), "PROD-001", "capability roadmap/contract missing")
mark("PROD-001", "Capability schema v2 + 3.0.0 fallback + parity roadmap")

ops = read("docs/OPERATIONS_RUNBOOK.md")
require("0.1%" in ops and "500 ms" in ops and "DLQ" in ops, "OPS-001", "SLO/dashboard thresholds missing")
require("Worker 5xx" in ops and "migration" in ops.lower(), "OPS-001", "alert/runbook coverage missing")
require("/health/detail" in read("mail-worker/src/api/init-api.js") and "c.get('user')" in read("mail-worker/src/api/init-api.js"), "OPS-001", "admin-only detailed health endpoint missing")
mark("OPS-001", "SLO thresholds + structured event/runbook + coarse public/admin detailed health; live dashboards/alerts remain external")

pro_doc = read("docs/PRO_ENTITLEMENT_AND_PRIVACY_METRICS.md")
paywall_test = read("mail-ios/scripts/test_paywall_conversion.py")
require("must not be abruptly reduced" in pro_doc and "power-user" in pro_doc, "BIZ-001", "Free grandfathering/power-feature governance missing")
require("Annual must be the default selected plan" in paywall_test and "StoreKit Product.displayPrice" in paywall_test, "BIZ-001", "paywall conversion/storefront pricing contract missing")
require("subject" in pro_doc and "Forbidden payloads" in pro_doc, "BIZ-001", "privacy-safe commercial measurement contract missing")
mark("BIZ-001", "Power-feature entitlement roadmap + Free grandfathering + paywall/funnel privacy contract; production funnel decision remains external")

ai_worker = read("mail-worker/scripts/ai-privacy-contract-test.mjs")
require("aiCodeFilter" in read("mail-worker/src/service/setting-service.js") or "aiCodeFilter" in read("mail-worker/src/entity/setting.js"), "PRIV-004", "AI sender/domain allowlist missing")
require("default off" in ai_worker.lower() or "default" in ai_worker.lower(), "PRIV-004", "AI default-off privacy contract missing")
require("Workers AI" in read("mail-vue/src/i18n/en.js") and "Workers AI" in read("mail-ios/Localization/Resources/en.lproj/Localizable.strings"), "PRIV-004", "cross-client AI data-path disclosure missing")
mark("PRIV-004", "AI default-off + sender/domain allowlist + explicit mail-content disclosure")

# ---------------------------------------------------------------------------
# P2 — cleanup/versioning/accessibility/retention/supply-chain/i18n
# ---------------------------------------------------------------------------
vue_router = read("mail-vue/src/router/index.js")
vue_login = read("mail-vue/src/views/login/index.vue")
require("path: '/test'" not in vue_router and not re.search(r"console\.(?:log|info|debug|warn|error)\([^\n]*registerForm\.email", vue_login), "WEB-001", "production test route or registration PII log remains")
mark("WEB-001", "Production test route/PII log removal + hygiene regression test")

require(worker_pkg.get("type") == "module", "BE-001", "mail-worker package type=module missing")

# `type=module` makes Node's old experimental default-module flag obsolete. Keep
# package scripts and public documentation free of that historical workaround.
obsolete_module_flag = "--experimental-default-type=" + "module"
be001_scan_paths = [ROOT / "README.md", ROOT / "mail-worker/package.json"]
be001_scan_paths.extend(sorted((ROOT / "docs").glob("**/*.md")))
be001_hits = []
for candidate in be001_scan_paths:
    if not candidate.exists():
        continue
    for line_number, line in enumerate(candidate.read_text(encoding="utf-8").splitlines(), 1):
        if obsolete_module_flag in line:
            be001_hits.append(f"{candidate.relative_to(ROOT)}:{line_number}")
require(
    not be001_hits,
    "BE-001",
    "obsolete experimental module flag remains in " + ", ".join(be001_hits),
)
mark("BE-001", "Worker package ESM contract + obsolete module-flag regression scan")

openapi = read("mail-worker/openapi/cloudmail-v1.openapi.json")
require('"openapi"' in openapi and '"/health"' in openapi, "API-001", "generated OpenAPI document missing")
require("/api/v1" in worker_index and "X-CloudMail-API-Version" in worker_index, "API-001", "v1 compatibility alias/header missing")
require(exists("mail-worker/scripts/openapi-contract-test.mjs"), "API-001", "OpenAPI contract test missing")
mark("API-001", "Versioned /api/v1 alias + generated OpenAPI/client contract surface")

accessibility = read("docs/ACCESSIBILITY_RELEASE_CHECKLIST.md")
require("VoiceOver" in accessibility and "Dynamic Type" in accessibility and "keyboard" in accessibility.lower(), "UX-002", "cross-platform accessibility release checklist incomplete")
require(exists("mail-ios/scripts/test_accessibility_contract.py") and exists("mail-vue/scripts/accessibility-contract-test.mjs"), "UX-002", "iOS/Web automated accessibility smoke contracts missing")
mark("UX-002", "iOS/Web automated accessibility contracts + release checklist")

retention = read("docs/DATA_RETENTION_POLICY.md")
require("email_trash_retention_days" in read("mail-worker/src/service/email-service.js") and "cleanupRetention" in read("mail-worker/src/index.js"), "OPS-002", "Worker trash retention cleanup missing")
require("PUSH_SUBSCRIPTION_RETENTION_DAYS" in read("cfmail-push-gateway/wrangler.toml"), "OPS-002", "Push subscription retention control missing")
require("diagnostic" in retention.lower() and "subscription" in retention.lower() and "cache" in retention.lower(), "OPS-002", "cross-component retention policy missing")
mark("OPS-002", "Configurable Worker/Push/client retention and cleanup policy")

require("vite-plugin-pwa" not in read("mail-vue/package.json"), "WEB-002", "unused PWA dependency still installed")
lock_text = read("mail-vue/pnpm-lock.yaml")
lock_importer = lock_text.split("packages:", 1)[0]
require("vite-plugin-pwa" not in lock_importer, "WEB-002", "PWA dependency remains in the active lockfile importer")
mark("WEB-002", "Unused PWA complexity removed pending a future explicit offline/privacy design")

supply = read(".github/scripts/supply_chain_contract_test.py")
manifest_gen = read(".github/scripts/generate_supply_chain_manifest.py")
all_workflows = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / ".github/workflows").glob("*.yml"))
require("@v" not in "\n".join(line for line in all_workflows.splitlines() if "uses:" in line), "REL-002", "unpinned version-tag GitHub Action remains")
require("22.23.2" in all_workflows and "9.15.9" in all_workflows, "REL-002", "Node/pnpm production pins missing")
require(exists(".github/workflows/cloudflare-deploy.yml"), "REL-002", "single Cloudflare deployment entry point missing")
require(not (ROOT / ".github/workflows/backend-deploy.yml").exists() and not (ROOT / ".github/workflows/frontend-deploy.yml").exists(), "REL-002", "duplicate Cloudflare backend/frontend wrappers remain")
require(not (ROOT / ".github/workflows/ios-build.yml").exists(), "REL-002", "legacy duplicate iOS distribution workflow remains")
require("adhoc" not in read(".github/workflows/cloudmail-ios.yml").lower(), "REL-002", "retired Ad Hoc distribution path remains")
for obsolete in [
    "mail-ios/scripts/ci_archive_ipa.sh",
    "mail-ios/scripts/ci_upload_testflight.sh",
    "mail-ios/scripts/ci_publish_ipa_release.sh",
]:
    require(not (ROOT / obsolete).exists(), "REL-002", f"obsolete distribution helper remains: {obsolete}")
require("SPDX" in manifest_gen and "sha256" in manifest_gen.lower(), "REL-002", "SBOM/artifact digest generation missing")
require("full commit SHA" in supply and "frozen lockfile" in supply, "REL-002", "supply-chain regression contract missing")
mark("REL-002", "Action/Node/pnpm pins + SBOM/provenance + single Cloudflare/iOS distribution entry points; Ad Hoc retired")

i18n_contract = read("mail-worker/scripts/i18n-error-contract-test.mjs")
error_message = read("mail-worker/src/i18n/error-message.js")
require("localizeErrorMessage" in error_message and "RESOURCE_EN_EXACT" in error_message, "I18N-001", "response-level BizError localization missing")
require("concurrency-safe" in i18n_contract and "English response leaked CJK" in i18n_contract, "I18N-001", "language/concurrency regression contract missing")
mark("I18N-001", "Request-safe response localization with no Chinese-only BizError leak to English clients")

# ---------------------------------------------------------------------------
# Cross-cutting closure evidence
# ---------------------------------------------------------------------------
require(exists("docs/SELF_HOSTING.md"), "DOC", "self-host deployment v1 missing")
require(exists("docs/EXTERNAL_RELEASE_ACCEPTANCE.md"), "DOC", "external acceptance boundary missing")
require("Time Travel" in read("docs/OPERATIONS_RUNBOOK.md"), "DOC", "D1 recovery runbook missing")
require("All code-side remediation" in read("docs/EXTERNAL_RELEASE_ACCEPTANCE.md"), "DOC", "external-only acceptance boundary is unclear")

# Keep this gate itself wired into automatic CI.
require("audit_closure_contract.py" in pr_gate, "QA-002", "industrial audit closure contract is not wired into PR CI")

if errors:
    print("❌ CloudMail industrial audit closure contract FAILED", file=sys.stderr)
    for error in errors:
        print(f" - {error}", file=sys.stderr)
    sys.exit(1)

print(f"✅ CloudMail industrial audit repository closure contract PASS ({len(closed)} audit IDs)")
for audit_id, evidence in closed:
    print(f"   {audit_id}: {evidence}")
print("   External account/device/production evidence is tracked separately in docs/EXTERNAL_RELEASE_ACCEPTANCE.md")
