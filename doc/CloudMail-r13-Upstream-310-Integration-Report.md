# Cloud-Mail upstream 3.1.0 compatibility integration

CF Mail r13 adopts the user-visible and server behaviors introduced by upstream Cloud-Mail 3.1.0 without replacing the audited r12 architecture. The integration target is upstream main after the 3.1.0 release and its immediate workspace fix (`cced5eb`).

## Adopted behavior

1. **Sync Delete**
   - Web and iOS administration surfaces expose the upstream 3.1 setting.
   - `0` means enabled and `1` means disabled, matching upstream semantics.
   - CF Mail defaults the feature to **disabled (`1`)** for databases that did not previously contain the setting so the audited soft-delete and retention policy remains the default.
   - Enabling it requires an explicit destructive confirmation in CF Mail UI.
   - Physical mail deletion first intersects caller-supplied IDs with messages owned by the authenticated user.
   - Account/user physical deletion keeps existing CF Mail authorization and child-cleanup protections.

2. **Workers AI default model**
   - The default model is `@cf/meta/llama-3.1-8b-instruct-fast`.
   - Existing CF Mail AI privacy controls remain unchanged: AI stays opt-in, sender/domain policy remains enforced, and request disclosure limits remain in force.

3. **Maximum 95 selected Web messages**
   - Web bulk-selection caps a selection at 95 messages and prevents additional unchecked rows from being selected after the cap.
   - Server APIs retain their existing validated request limits for compatibility and automation.

4. **Keyboard and duplicate-submit behavior**
   - Enter submits supported login/register/account/admin forms.
   - Escape returns from mail detail when no higher-priority overlay/editor is active.
   - Loading guards reject duplicate submit actions while a request is already running.

5. **URL compatibility**
   - Canonical CF Mail routes remain `/mail/*` and `/admin/*`.
   - `/mail` redirects to `/mail/inbox`.
   - Legacy `/message` continues to resolve to `/mail/message`.
   - `/system-setting` and upstream `/system-settings` resolve to `/admin/system-settings`.
   - Upstream route names do not replace the audited Mail/Admin information architecture.

6. **System settings layout**
   - Settings cards use a centered single-column layout with a 900 px maximum width while preserving CF Mail design tokens, dark/light themes, reduced motion and accessibility contracts.

## Database compatibility

The repository production workflow performs the protected `POST /api/init` compatibility pass before versioned D1 migrations. r13 adds a `v3_9DB` bridge that adds `setting.sync_delete` only when absent, using `DEFAULT 1` (disabled). If an imported upstream 3.1 database already has the column, its current value is preserved.

`migrations/0005_sync_delete.sql` therefore records the upstream 3.1 compatibility baseline but deliberately does **not** issue a second `ALTER TABLE`. This avoids a duplicate-column failure when migrating an existing upstream 3.1 database into CF Mail.

Supported paths include:

- CF Mail r12 / Cloud-Mail 3.0-era schema -> protected init adds `sync_delete=1` -> versioned migrations apply.
- Existing upstream Cloud-Mail 3.1 schema -> protected init sees the existing column and preserves its value -> versioned migrations apply.

Operators should use the repository deploy workflow, or reproduce the documented order: protected initialization first, then `wrangler d1 migrations apply`. For the first production deployment from r12 to r13, choose **`deploy-and-migrate`** rather than plain `deploy`; the new Worker schema expects `setting.sync_delete` after the protected compatibility pass. Subsequent code-only deployments can return to the normal deploy mode until another schema migration is introduced.

## iOS compatibility policy

Unmodified Cloud-Mail 3.0.0 remains the compatibility floor. `syncDelete` is decoded as optional in iOS, so servers without the 3.1 field remain usable. Cloud-Mail 3.1.0 is the current upstream reference baseline, while CF Mail Enhanced capabilities remain optional extensions discovered at runtime.

## Intentionally not imported into r13 core

Node.js 24 and pnpm 11 are treated as a separate toolchain upgrade. r13 core remains on the audited Node 22.23.2 / pnpm 9.15.9 toolchain until the frozen-install, Worker, Web, Push Gateway and CI matrix passes under the new toolchain. The candidate upgrade is documented separately in `UPSTREAM_310_TOOLCHAIN_UPGRADE.md`.
