# CloudMail Industrial Operations Runbook

## Scope

This runbook covers the production `mail-worker`, Web assets, CF Mail iOS integration, D1 migrations, and `cfmail-push-gateway`. It intentionally defines metrics without logging mail subject/body/recipient content.

## Service-level objectives

| Domain | SLO / release threshold | Primary signal |
|---|---:|---|
| iOS crash-free sessions | >= 99.8%, target 99.9% | App Store / MetricKit diagnostics |
| Main-provider connection test success | >= 98% | opt-in redacted client event |
| Foreground refresh success | >= 99.5% | provider result category |
| Accepted send success | >= 99.5%, excluding remote bounce | Worker/direct SMTP result category |
| Worker API 5xx rate | < 0.1% | Workers observability |
| Worker API p95 latency | < 500 ms for non-external-send APIs | Workers traces/metrics |
| Push first attempt accepted or queued | >= 99.9% | Gateway structured events |
| Push DLQ | steady-state 0; any sustained >0 alerts | Cloudflare Queues |
| Supported migration fixture success | 100% | CI migration matrix |
| Release Candidate Archive | 100% | macOS release CI |

## Required alerts

1. **Worker 5xx:** alert when 5xx exceeds 0.1% over a meaningful production window, with a minimum-request floor to avoid low-volume noise.
2. **Send failure:** alert when accepted-send success drops below 99.5% after excluding known remote bounces/recipient rejections.
3. **Push DLQ:** page/notify whenever DLQ count remains above zero; investigate `permanent_failure`, provider authentication, and repeated retry causes.
4. **D1 migration failure:** release-blocking alert/event. No deployment may be considered ready after a failed migration.
5. **iOS crash-free:** release/operations warning below 99.8%; target remains 99.9%.

## Structured event vocabulary

Gateway production logs use event names such as:

```text
delivered
queued
retry_delivered
retry_rescheduled
deactivated
permanent_failure
attestation_verified
assertion_verified
subscription_fallback
retention_cleanup
```

Do not add `deviceToken`, `pushSecret`, sender, subject, preview, mail body, APNs private keys, or authorization headers to structured log fields.

## Health checks

Public readiness:

```bash
curl -fsS https://mail.example.com/api/health
```

The public response is deliberately coarse (`status`, `service`, `ready`). It must not reveal which secret/binding is missing.

Authenticated administrator diagnostics are available at:

```text
GET /api/health/detail
```

Push Gateway:

```bash
curl -fsS https://push.example.com/healthz
```

## Deployment / migration incident procedure

1. Stop promotion of the affected release.
2. Preserve the source commit, build artifact SHA-256, migration number, and deployment run ID.
3. Do not re-run destructive SQL manually until the failed migration has been classified.
4. Restore/Time-Travel D1 according to the Cloudflare account's available recovery mechanism if data integrity is at risk.
5. Fix the versioned migration and run all historical fixtures locally/CI.
6. Re-deploy in an explicit maintenance window; `INIT_LOCKED` must not be silently bypassed.
7. Verify `/api/health`, Web login, inbound/outbound mail, iOS login/sync, and push when enabled.

## Push incident procedure

- `provider auth error`: verify APNs provider credentials and time skew; never print the `.p8`.
- `invalid token`: subscription should deactivate automatically; verify token cleanup.
- `retry ratio spike`: inspect APNs status classes and Queue age.
- `DLQ > 0`: preserve event metadata but not rich mail content; determine whether failures are permanent or transient policy errors.
- suspected abuse of `/v1/subscriptions`: tighten WAF/rate limits and inspect App Attest policy metrics.

## Privacy-safe product/reliability telemetry

Allowed examples:

```text
account_add_success/provider_type
first_sync_success/result_category
send_result/provider_type/result_category
push_result/event_category
paywall_view
purchase_result/product_id/result_category
```

Never include:

```text
mail subject
mail body
recipient/sender address
attachment names/content
raw APNs token
pushSecret
password/JWT/session cookie
```

## D1 migration recovery gate

Production migration mode captures two recovery anchors **before** `POST /api/init` or versioned migrations run:

1. `wrangler d1 time-travel info ... --json` records the current D1 Time Travel bookmark.
2. `wrangler d1 export ... --remote` writes a runner-local SQL export and records only its SHA-256 in the job summary.

The SQL export can contain user/mail data. It is never uploaded as a GitHub artifact and is deleted with an `always()` cleanup step. Migration must fail closed if the recovery point cannot be captured.

If rollback is required, use the recorded pre-migration Time Travel bookmark with the Cloudflare operator account:

```bash
pnpm wrangler d1 time-travel restore cloud-mail --bookmark='<recorded-bookmark>'
```

Treat restore as a destructive operator action: stop writes/declare a maintenance window, confirm the target bookmark, restore, redeploy the known-good source revision, and re-run `/api/health` plus mail/Web/iOS smoke checks.
