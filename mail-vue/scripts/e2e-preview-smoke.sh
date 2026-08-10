#!/usr/bin/env bash
set -euo pipefail
PORT="${PORT:-4173}"
LOG="${RUNNER_TEMP:-/tmp}/cloudmail-vite-preview.log"

# Release builds intentionally write into ../mail-worker/dist so the Worker can
# serve the Vue assets. `pnpm preview` must therefore run in release mode;
# otherwise Vite falls back to mail-vue/dist and exits with "directory dist does not exist".
EXPECTED_RELEASE_OUT_DIR="../mail-worker/dist"
if [ ! -f "$EXPECTED_RELEASE_OUT_DIR/index.html" ]; then
  echo "❌ Release frontend assets are missing at $EXPECTED_RELEASE_OUT_DIR"
  echo "Run 'pnpm run build' before the preview smoke test."
  exit 1
fi

pnpm preview --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
pid=$!
cleanup(){ kill "$pid" >/dev/null 2>&1 || true; }
trap cleanup EXIT
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/login" -o /tmp/cloudmail-login.html; then break; fi
  sleep 1
done
test -s /tmp/cloudmail-login.html || { cat "$LOG"; exit 1; }
grep -qi '<html' /tmp/cloudmail-login.html
grep -qi '<div id="app"' /tmp/cloudmail-login.html
echo 'PASS: production Vite preview serves the SPA login entrypoint.'
