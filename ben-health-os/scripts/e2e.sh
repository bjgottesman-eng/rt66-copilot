#!/usr/bin/env bash
# End-to-end smoke: migrate the local DB, start the API (local auth, demo seed enabled) and the built
# web app, run the Playwright suite, then stop both servers. Requires Postgres on 127.0.0.1:5432.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgres://bho:bho@127.0.0.1:5432/ben_health_os}"
export API_PORT="${API_PORT:-8787}"
export WEB_PORT="${WEB_PORT:-3000}"
LOG_DIR="${LOG_DIR:-/tmp/bho-e2e}"
mkdir -p "$LOG_DIR"

for p in "$API_PORT" "$WEB_PORT"; do if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":$p "; then echo "port $p is already in use; stop the other server first" >&2; exit 1; fi; done
node "$ROOT/scripts/db-migrate.mjs"

( cd "$ROOT/services/api" && exec env NODE_ENV=development AUTH_MODE=local ALLOW_DEMO_SEED=true PORT="$API_PORT" LOG_LEVEL=warn node dist/server.js > "$LOG_DIR/api.log" 2>&1 ) &
API_PID=$!
( cd "$ROOT/apps/web" && exec env API_BASE_URL="http://127.0.0.1:$API_PORT" NEXT_PUBLIC_AUTH_MODE=local node node_modules/next/dist/bin/next start --port "$WEB_PORT" > "$LOG_DIR/web.log" 2>&1 ) &
WEB_PID=$!
cleanup() { pkill -P "$API_PID" 2>/dev/null || true; pkill -P "$WEB_PID" 2>/dev/null || true; kill "$API_PID" "$WEB_PID" 2>/dev/null || true; wait "$API_PID" "$WEB_PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null && break; sleep 1; done
for i in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$WEB_PORT/login" && break; sleep 1; done
curl -sf "http://127.0.0.1:$API_PORT/health"; echo
( cd "$ROOT/apps/web" && WEB_BASE_URL="http://127.0.0.1:$WEB_PORT" pnpm exec playwright test "$@" )
