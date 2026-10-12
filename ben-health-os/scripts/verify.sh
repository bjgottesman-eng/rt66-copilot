#!/usr/bin/env bash
# Full verification: packages + API tests (Postgres), web typecheck/build/unit, Android build + unit tests, e2e.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export DATABASE_URL="${DATABASE_URL:-postgres://bho:bho@127.0.0.1:5432/ben_health_os}"
echo "== workspace install"; pnpm install --frozen-lockfile=false >/dev/null
echo "== packages build + tests"; pnpm run build:packages && pnpm -r --filter './packages/**' --filter './services/analytics' --filter './services/integrations' --filter './services/ai' --filter './fixtures' run test
echo "== secret scan"; if git grep -nE "sk-ant-api[0-9A-Za-z_-]{8,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]{10,}" -- . ':!scripts/verify.sh' ; then echo "possible secret committed" >&2; exit 1; fi
echo "== migrations (local)"; node scripts/db-migrate.mjs
echo "== api tests"; pnpm --filter @bho/api test
echo "== web"; pnpm --filter @bho/web typecheck && pnpm --filter @bho/web test && pnpm --filter @bho/web build
if [[ -n "${ANDROID_HOME:-}" || -f apps/android/local.properties ]]; then
  echo "== android"; (cd apps/android && ./gradlew :app:assembleDebug :app:testDebugUnitTest --console=plain -q)
else
  echo "== android skipped (ANDROID_HOME not set)"
fi
echo "== e2e"; bash scripts/e2e.sh
echo "ALL CHECKS PASSED"
