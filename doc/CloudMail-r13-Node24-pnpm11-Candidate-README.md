# Cloud-Mail 3.1 Node 24 / pnpm 11 toolchain candidate

This toolchain change is intentionally separated from the r13 functional compatibility release.

## Upstream changes to reproduce

- Node.js: 22 -> 24 (candidate pin: 24.19.0)
- pnpm: 9 -> 11 (candidate pin: 11.22.0)
- `mail-worker/pnpm-workspace.yaml`:
  - `packages: ['.']`
  - allow builds for `esbuild`, `sharp`, `workerd`
- `mail-vue/pnpm-workspace.yaml`:
  - `packages: ['.']`
  - allow builds for `@parcel/watcher`, `esbuild`, `vue-demi`

The `packages: ['.']` entry is mandatory: upstream added it immediately after the first pnpm-workspace change to fix workspace resolution.

## CF Mail promotion gate

Do not merge the candidate into the production baseline until CI proves all of the following with frozen lockfiles:

1. Worker `pnpm install --frozen-lockfile` succeeds on Node 24 / pnpm 11.
2. Worker full `pnpm audit:test`, including Vitest, passes.
3. Web frozen install, unit/security/contract/a11y tests, production build and preview smoke pass.
4. Push Gateway frozen install and full test suite pass.
5. D1 historical migration matrix and audit closure remain green.
6. Supply-chain/runtime contracts are updated to the new explicit pins rather than weakened.

## Current r13 status

The production r13 core artifact keeps Node 22.23.2 and pnpm 9.15.9. This candidate tree pins Node 24.19.0 and pnpm 11.22.0 so it can be exercised independently in CI. This environment cannot honestly certify a Node 24 / pnpm 11 frozen install unless those runtimes/packages are already available locally, so promotion remains a CI acceptance decision.
