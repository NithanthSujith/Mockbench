#!/usr/bin/env bash
# REL-03: run CONTRIBUTING.md's "Five-minute setup" block exactly as written, then prove the dev
# environment works: the API answers through Vite's proxy and the UI is served.
#
#   bash scripts/contributing-smoke.sh        run the block, start `pnpm dev`, check, stop
#   bash scripts/contributing-smoke.sh down   stop the dev database and delete its volume
#
# The block is the fenced code between <!-- contributing-smoke:start --> and :end in CONTRIBUTING.md.
# Its last line must be `pnpm dev` (it blocks), so this script runs it in the background.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "down" ]]; then
  docker compose -f docker-compose.dev.yml down -v --remove-orphans
  exit 0
fi

block="$(awk '/<!-- contributing-smoke:start -->/{on=1;next} /<!-- contributing-smoke:end -->/{on=0} on' CONTRIBUTING.md | grep -v '^```')"
if [[ -z "$block" ]]; then
  echo "contributing-smoke: no marked setup block in CONTRIBUTING.md" >&2
  exit 1
fi
last="$(printf '%s\n' "$block" | sed '/^[[:space:]]*$/d' | tail -n 1)"
if [[ "$last" != "pnpm dev" ]]; then
  echo "contributing-smoke: the block must end with 'pnpm dev' (got: $last)" >&2
  exit 1
fi
setup="$(printf '%s\n' "$block" | sed '/^[[:space:]]*$/d' | sed '$d')"

if [[ -e .env ]]; then
  echo "contributing-smoke: .env already exists; run this on a clean checkout" >&2
  exit 1
fi

echo "contributing-smoke: running the documented setup"
printf '%s\n' "$setup"
bash -euo pipefail -c "$setup"

log="$(mktemp)"
echo "contributing-smoke: starting pnpm dev (log: $log)"
setsid pnpm dev >"$log" 2>&1 &
dev_pid=$!
cleanup() {
  kill -- -"$dev_pid" 2>/dev/null || true
  wait "$dev_pid" 2>/dev/null || true
}
trap cleanup EXIT

wait_for() {
  local url="$1" deadline=$((SECONDS + 120))
  until curl -fsS -o /dev/null "$url"; do
    if ((SECONDS > deadline)); then
      echo "contributing-smoke: timed out waiting for $url" >&2
      tail -n 80 "$log" >&2
      return 1
    fi
    sleep 2
  done
}

base="http://127.0.0.1:5173"
wait_for "$base/api/v1/readyz"
echo "contributing-smoke: API ready through the Vite proxy"

html="$(curl -fsS "$base/")"
grep -q '<div id="root"' <<<"$html" || { echo "contributing-smoke: UI did not serve the app shell" >&2; exit 1; }
echo "contributing-smoke: UI served"

wait_for "$base/mock/demo/users"
echo "contributing-smoke: demo mock answers"

echo "contributing-smoke: ok"
