# CloudMail Industrial Audit — External Release Acceptance

This checklist contains only acceptance evidence that cannot be honestly produced by source inspection or the current Linux audit container. All code-side remediation for these items is represented by repository gates/tests; these steps provide the environment/account/device evidence required before declaring a production release Industrial GA.

## 1. Apple / signed iOS release evidence

- [ ] Run `.github/workflows/cloudmail-ios.yml` in `archive` or `testflight` mode on the release candidate.
- [ ] Confirm the signed Xcode 26+ Release Archive gate passes.
- [ ] Confirm `CloudMail.app/PrivacyInfo.xcprivacy` exists in the final archive.
- [ ] Run Xcode/App Store Connect privacy validation on the final archive and confirm no Required Reason API warning remains.
- [ ] Record the archive SHA-256/provenance artifact emitted by CI.

## 2. Current App Store screenshots

Run the dedicated screenshot workflows against the same source commit as the release candidate:

- [ ] iPhone 6.9-inch candidate set: exactly 6 screenshots at `1320 × 2868`.
- [ ] iPad 13-inch candidate set: exactly 6 screenshots at `2064 × 2752`.
- [ ] Human review confirms every screenshot reflects the current UI, theme, navigation and purchasable feature set.
- [ ] Review English and Simplified Chinese copy before uploading to App Store Connect.

The repository scripts fail when screenshot count/dimensions are wrong; human content review is still required because CI cannot decide whether marketing copy accurately describes the currently shipping experience.

## 3. Real-device App Attest and APNs

With a production-signed/TestFlight build:

- [ ] Keep `APP_ATTEST_POLICY=monitor` for initial rollout.
- [ ] Confirm real devices complete challenge → attestation → assertion successfully.
- [ ] Confirm replayed assertions are rejected.
- [ ] Confirm unsupported/development-device fallback is separately observable.
- [ ] After healthy telemetry, switch production to `APP_ATTEST_POLICY=enforce` according to support policy.
- [ ] Verify new-mail APNs delivery on a physical device while locked.
- [ ] Verify foreground in-app notification behavior.
- [ ] Verify invalid APNs tokens deactivate the subscription and do not hot-loop.
- [ ] Verify transient APNs failure enters retry Queue and exhausted retry enters DLQ.

## 4. Cloudflare edge controls

Repository code cannot create or prove account-level WAF policy unless the operator grants infrastructure-management authority. Before broad public rollout:

- [ ] Rate-limit `POST /v1/subscriptions` at the Cloudflare edge.
- [ ] Apply appropriate bot/abuse controls to the public Push Gateway.
- [ ] Apply login/register/init rate-limit policy to the CloudMail deployment as appropriate for the plan/traffic profile.
- [ ] Confirm alerts exist for Worker 5xx, send failures, Push DLQ, D1 migration failure and iOS crash-free regression.
- [ ] Confirm operational dashboards expose the SLOs in `docs/OPERATIONS_RUNBOOK.md` without collecting mail subject/body/recipient content.

## 5. Production D1 recovery drill

On a non-production clone or approved maintenance exercise:

- [ ] Capture the CI pre-migration Time Travel recovery point.
- [ ] Confirm the private SQL export is not uploaded to GitHub artifacts.
- [ ] Apply the current versioned migration chain.
- [ ] Exercise the restore procedure in `docs/OPERATIONS_RUNBOOK.md` using the recorded recovery point.
- [ ] Confirm the restored database passes health and migration integrity checks.

## 6. Real provider end-to-end matrix

At minimum, validate representative providers with real accounts/test mailboxes:

- [ ] Gmail IMAP/SMTP or OAuth configuration used by the product.
- [ ] Microsoft/Outlook.
- [ ] iCloud.
- [ ] At least one generic standards-compliant IMAP/SMTP server.
- [ ] A self-hosted CloudMail 3.0.0-compatible server.
- [ ] The current enhanced CloudMail server.

For each supported path, verify add-account → first sync → detail → compose/send → refresh, plus provider-capability degradation where features are unavailable.

## 7. Commercial / Pro validation

The audit explicitly recommends not cutting the existing Free allowance merely to manufacture conversion. The repository therefore defines a power-feature roadmap and privacy-safe funnel contract without inventing production results.

Before changing entitlement gates or removing Weekly:

- [ ] Review App Store product-page conversion.
- [ ] Review StoreKit plan mix / renewal / refund data.
- [ ] Measure paywall view → purchase with privacy-safe, opt-in/Apple-provided signals.
- [ ] Do not collect subject, body, recipient/sender addresses, attachment content, passwords or tokens.
- [ ] Decide whether Weekly remains, and how Annual/Lifetime are emphasized, from observed funnel data.
- [ ] Any future feature advertised as Pro must have a shipping entitlement gate and behavior before marketing copy changes.

## 8. Release declaration

A release may be called **Industrial GA** only when:

1. repository audit closure contract is green;
2. PR quality gate is green;
3. signed Archive/privacy validation is green;
4. current screenshot sets are approved;
5. production Cloudflare edge/alert policy is verified;
6. physical-device App Attest/APNs checks are green; and
7. the operator has completed the D1 recovery drill for the supported migration path.

Until then, the source can be code-complete for the audit while the operational release remains under an external acceptance gate.
