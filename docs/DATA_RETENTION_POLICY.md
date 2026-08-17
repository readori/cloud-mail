# CloudMail Data Retention and Cleanup Policy

This document is the source-of-truth retention inventory for server, push gateway, and iOS local operational data. Mail content owned by a self-host administrator remains subject to that administrator's own policy; this document defines the cleanup behavior implemented by CF Mail/CloudMail components.

| Data class | Default retention | Configuration / behavior |
|---|---:|---|
| CloudMail soft-deleted/trash messages | 30 days | `EMAIL_TRASH_RETENTION_DAYS`; `0` disables physical cleanup; bounded to 3650 days |
| Worker rate-limit D1 buckets | until window expiry | scheduled cleanup removes expired buckets |
| Worker KV rate-limit fallback | window + 60 sec | KV TTL |
| OAuth state / bind nonce | 10 min | KV TTL; one-time/short-lived semantics |
| Public token | 15 min default | `public_token_ttl`, bounded 60–86400 sec |
| Analysis cache | 6 hours | KV TTL |
| Push delivery de-dup records | 3 days | scheduled Gateway cleanup |
| Inactive Push subscriptions | 90 days | `PUSH_SUBSCRIPTION_RETENTION_DAYS`, bounded 1–3650 days |
| App Attest challenge | 5 min | one-time challenge + scheduled cleanup |
| Inactive App Attest key records | 30 days | retained briefly for replay/abuse investigation, then removed |
| Recent-recipient learning | 90 days | iOS protected store; user learning toggle/clear is supported |
| iOS diagnostics | 7 days | protected Application Support; backup excluded |
| iOS attachment/provider caches | bounded cache cleanup | local cache cleanup APIs; protected storage where audit requires it |
| Draft attachments | until draft cleanup/deletion | protected Application Support; excluded from backup |

## Server Trash retention

`mail-worker/migrations/0002_retention.sql` introduces `email.deleted_at` and triggers that set/clear the timestamp when delete state changes. Daily scheduled cleanup calls `emailService.cleanupRetention()` and permanently deletes only messages whose soft-delete timestamp is older than the configured retention. Attachment/star cleanup continues through the normal physical-delete path.

Recommended production setting:

```text
EMAIL_TRASH_RETENTION_DAYS=30
```

Set to `0` only when the self-host administrator intentionally wants no automatic physical purge.

## Push retention

The Gateway scheduled handler performs subscription/App-Attest cleanup. `PUSH_SUBSCRIPTION_RETENTION_DAYS` defaults to 90 days for inactive subscriptions. Delivery de-dup records are shorter-lived (3 days). Retry queues are transport mechanisms, not archival stores; DLQ should be kept near zero and operationally investigated rather than treated as permanent storage.

## Deletion / reset semantics

- Account logout/unregister should revoke or unregister the relevant push subscription.
- “Reset Data” and per-feature clear operations should delete local protected cache/index/diagnostic data according to their existing store APIs.
- Physical server deletion must continue to remove related attachments and star/invariant records.
- Retention cleanup must never log message content.

## Backup policy

Sensitive local transient data (draft attachments, diagnostics, caches where applicable) should use iOS Data Protection and be excluded from device backup when the data can be re-fetched or is operational rather than user-authored durable content.
