#!/usr/bin/env bash
# `pnpm e2e` (XC-01): bring up the real compose stack, run the Playwright suite against it, tear down.
#
#   e2e/run.sh          both runs: the loop stack (SEED_DEMO=false), then a fresh SEED_DEMO=true stack
#   e2e/run.sh loop     only the loop run
#   e2e/run.sh seed     only the seed run
#   e2e/run.sh up|down  bring the loop stack up / remove it (for debugging a single spec)
#
# Environment: E2E_PORT (host port, default 8080), E2E_PROJECT (compose project, default mockbench-e2e),
# E2E_SKIP_BUILD=1 (reuse images). The browser reaches the stack as http://mockbench.lan.test:$E2E_PORT.
# Always leaves no containers or volumes behind, including after a failure.
set -u
cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-8080}"
PROJECT="${E2E_PROJECT:-mockbench-e2e}"
export PORT E2E_PORT="$PORT"
compose() { docker compose -p "$PROJECT" --env-file .env.example "$@"; }

up() {
  local seed="$1" build=(--build)
  [ "${E2E_SKIP_BUILD:-}" = "1" ] && build=()
  SEED_DEMO="$seed" compose up -d "${build[@]}" --wait
}
down() { compose down -v --remove-orphans >/dev/null 2>&1; }
trap down EXIT

run_suite() { # <stack> <seed-demo>
  down
  echo "== e2e: $1 stack (SEED_DEMO=$2) on port $PORT"
  if ! up "$2"; then compose logs --no-color --tail 100; return 1; fi
  E2E_STACK="$1" pnpm --filter @mockbench/web exec playwright test --config ../../e2e/playwright.config.ts
  local status=$?
  [ "$status" -ne 0 ] && compose logs --no-color --tail 100 api
  down
  return "$status"
}

case "${1:-all}" in
  up) trap - EXIT; down; up false ;;
  down) down ;;
  loop) run_suite loop false ;;
  seed) run_suite seed true ;;
  all)
    run_suite loop false; a=$?
    run_suite seed true; b=$?
    [ "$a" -eq 0 ] && [ "$b" -eq 0 ]
    ;;
  *) echo "usage: e2e/run.sh [all|loop|seed|up|down]" >&2; exit 2 ;;
esac
