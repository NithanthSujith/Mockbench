#!/usr/bin/env bash
# README smoke test (REL-01). Does what the README tells a stranger to do and checks the answers the
# README prints:
#   1. bring the stack up from .env.example (the same file `cp .env.example .env` copies)
#   2. curl the demo project and compare the body with the README's marked JSON block
#   3. register the first user over the API, import every examples/*.mockbench.json through
#      projects.import, publish and deploy each, and call a mock
#   4. compare the README's second example (a case picked by header) with the real response
#   5. reset the user's password with `docker compose exec api node dist/reset-password.js` (AUTH-04)
#   6. run scripts/setup.sh in a temp directory and check the .env it generates (the `setup` step)
#
#   scripts/readme-smoke.sh          setup, up, check, down
#   scripts/readme-smoke.sh up|check|setup|down
#
# Environment: README_SMOKE_PORT (default 8080), README_SMOKE_PROJECT (default mockbench-readme).
# Runs from Git Bash on Windows, macOS and Linux. Needs docker, curl and node.
set -u
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

cd "$(dirname "$0")/.."
PORT="${README_SMOKE_PORT:-8080}"
PROJECT="${README_SMOKE_PROJECT:-mockbench-readme}"
export PORT
BASE="http://127.0.0.1:${PORT}"
CLIENT_HEADER='X-Mockbench-Client: readme-smoke'

compose() { docker compose -p "$PROJECT" --env-file .env.example "$@"; }

FAILS=0
pass() { printf '  PASS %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }
section() { printf '\n== %s\n' "$*"; }

HTTP_CODE=""
HTTP_BODY=""
http() {
  local out
  out="$(curl -s -w '\n%{http_code}' --max-time 20 "$@")"
  HTTP_CODE="${out##*$'\n'}"
  HTTP_BODY="${out%$'\n'*}"
}

# json_get <json> <js expression over d>
json_get() { node -e 'const d = JSON.parse(process.argv[1]); const v = ('"$2"'); console.log(typeof v === "string" ? v : JSON.stringify(v))' "$1"; }

# readme_block <marker>: the JSON between <!-- smoke:begin NAME --> and <!-- smoke:end --> in README.md
readme_block() {
  node -e '
    const t = require("fs").readFileSync("README.md", "utf8");
    const m = new RegExp("<!-- smoke:begin " + process.argv[1] + " -->\\s*```json\\n([\\s\\S]*?)```\\s*<!-- smoke:end -->").exec(t);
    if (!m) { console.error("no marked block " + process.argv[1]); process.exit(1) }
    console.log(JSON.stringify(JSON.parse(m[1])))' "$1"
}

same_json() { [ "$(node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1])))' "$1")" = "$2" ]; }

cmd_up() {
  section "quickstart: docker compose up (${PROJECT}, port ${PORT})"
  if compose up -d --build --wait; then pass "stack is healthy"; else fail "stack did not become healthy"; compose logs --tail 80; fi
}

cmd_check() {
  section "the README's first curl, against the demo project"
  http "${BASE}/mock/demo/users"
  if [ "$HTTP_CODE" = "200" ]; then pass "GET /mock/demo/users -> 200"; else fail "GET /mock/demo/users -> ${HTTP_CODE}"; fi
  if same_json "$HTTP_BODY" "$(readme_block demo-users)"; then pass "body equals the README block"; else fail "body differs from the README block: ${HTTP_BODY}"; fi

  section "register the first user"
  local resp cookie ws
  resp="$(curl -si --max-time 20 -X POST "${BASE}/api/v1/auth/register" -H "$CLIENT_HEADER" -H 'Content-Type: application/json' \
    --data '{"email":"smoke@example.com","password":"correct-horse-battery","name":"Smoke"}')"
  cookie="$(printf '%s' "$resp" | tr -d '\r' | grep -i '^set-cookie:' | head -1 | sed -e 's/^[Ss]et-[Cc]ookie: *//' -e 's/;.*//')"
  if [ -n "$cookie" ]; then pass "registered, got a session cookie"; else fail "no session cookie after register"; printf '%s\n' "$resp" | head -20; return; fi
  ws="$(json_get "$(printf '%s' "$resp" | tr -d '\r' | sed -n '/^$/,$p' | tail -n +2)" 'd.workspaces[0].id')"

  section "the README second curl: a case picked by header"
  http "${BASE}/mock/demo/users/3" -H 'X-Mock-Case: Not found'
  if [ "$HTTP_CODE" = "404" ]; then pass "GET /mock/demo/users/3 with X-Mock-Case -> 404"; else fail "demo not found: ${HTTP_CODE}"; fi
  if same_json "$HTTP_BODY" "$(readme_block demo-user-not-found)"; then pass "body equals the README block"; else fail "body differs from the README block: ${HTTP_BODY}"; fi

  section "import, publish and deploy every example"
  local f slug body pid vid
  for f in examples/*.mockbench.json; do
    slug="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).project.slug)' "$f")"
    body="$(node -e 'console.log(JSON.stringify({ workspaceId: process.argv[1], document: JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")) }))' "$ws" "$f")"
    http -X POST "${BASE}/api/v1/projects/import" -H "$CLIENT_HEADER" -H "Cookie: ${cookie}" -H 'Content-Type: application/json' --data "$body"
    if [ "$HTTP_CODE" != "201" ]; then fail "import ${f} -> ${HTTP_CODE} ${HTTP_BODY}"; continue; fi
    pass "import ${f} -> 201"
    pid="$(json_get "$HTTP_BODY" 'd.id')"
    http -X POST "${BASE}/api/v1/projects/${pid}/versions" -H "$CLIENT_HEADER" -H "Cookie: ${cookie}" -H 'Content-Type: application/json' --data '{}'
    if [ "$HTTP_CODE" != "201" ]; then fail "publish ${slug} -> ${HTTP_CODE} ${HTTP_BODY}"; continue; fi
    vid="$(json_get "$HTTP_BODY" 'd.id')"
    http -X POST "${BASE}/api/v1/projects/${pid}/deploy" -H "$CLIENT_HEADER" -H "Cookie: ${cookie}" -H 'Content-Type: application/json' --data "{\"versionId\":\"${vid}\"}"
    if [ "$HTTP_CODE" = "200" ]; then pass "publish and deploy ${slug}"; else fail "deploy ${slug} -> ${HTTP_CODE} ${HTTP_BODY}"; fi
  done

  section "calls against the imported examples"
  http "${BASE}/mock/shop-api/products"
  if [ "$HTTP_CODE" = "200" ] && [ "$(json_get "$HTTP_BODY" 'd.length')" = "3" ]; then pass "GET /mock/shop-api/products -> 3 products"; else fail "shop-api products: ${HTTP_CODE} ${HTTP_BODY}"; fi
  http -X POST "${BASE}/mock/flaky-payments/charges" -H 'X-Mock-Case: Card declined' -H 'Content-Type: application/json' --data "$(cat examples/payloads/create-charge.json)"
  if [ "$HTTP_CODE" = "422" ]; then pass "flaky-payments, case chosen by X-Mock-Case -> 422"; else fail "flaky-payments card declined: ${HTTP_CODE} ${HTTP_BODY}"; fi

  # Last, because it signs the smoke user out.
  section "password reset in the container (AUTH-04)"
  local who out rc newpw
  who="$(compose exec -T api id -un 2>&1)"
  if [ "$who" = "node" ]; then pass "api container runs as node"; else fail "api container user: ${who}"; fi
  out="$(compose exec -T api node dist/reset-password.js SMOKE@example.com 2>&1)"
  newpw="$(printf '%s' "$out" | tr -d '\r' | sed -n 's/^reset-password: new password for SMOKE@example.com: //p')"
  if [ "${#newpw}" = "20" ]; then pass "reset-password printed a 20-character password"; else fail "reset-password output: ${out}"; fi
  http "${BASE}/api/v1/auth/me" -H "Cookie: ${cookie}"
  if [ "$HTTP_CODE" = "401" ]; then pass "the old session is signed out"; else fail "old session after reset -> ${HTTP_CODE}"; fi
  http -X POST "${BASE}/api/v1/auth/login" -H "$CLIENT_HEADER" -H 'Content-Type: application/json' \
    --data "{\"email\":\"smoke@example.com\",\"password\":\"${newpw}\"}"
  if [ "$HTTP_CODE" = "200" ]; then pass "the new password logs in"; else fail "login with the new password -> ${HTTP_CODE} ${HTTP_BODY}"; fi
  rc=0
  out="$(printf 'piped-password-123\n' | compose exec -T api node dist/reset-password.js smoke@example.com --password-stdin 2>&1)" || rc=$?
  if [ "$rc" = "0" ] && ! printf '%s' "$out" | grep -q 'piped-password-123'; then pass "--password-stdin sets it without printing it"; else fail "--password-stdin (exit ${rc}): ${out}"; fi
  http -X POST "${BASE}/api/v1/auth/login" -H "$CLIENT_HEADER" -H 'Content-Type: application/json' \
    --data '{"email":"smoke@example.com","password":"piped-password-123"}'
  if [ "$HTTP_CODE" = "200" ]; then pass "the piped password logs in"; else fail "login with the piped password -> ${HTTP_CODE} ${HTTP_BODY}"; fi
}

cmd_setup() {
  section "the README's setup step (scripts/setup.sh)"
  # Run it in a throwaway directory: the repository's own .env belongs to whoever is running this.
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  cp .env.example "$tmp/.env.example"
  cp scripts/setup.sh "$tmp/setup.sh"

  rc=0
  (cd "$tmp" && bash setup.sh --defaults >/dev/null 2>&1) || rc=$?
  if [ "$rc" = "0" ] && [ -f "$tmp/.env" ]; then
    pass "setup.sh --defaults writes .env next to .env.example"
  else
    fail "setup.sh --defaults (exit ${rc}) wrote no .env"
    return
  fi

  secret="$(sed -n 's/^SESSION_SECRET=//p' "$tmp/.env" | head -n 1)"
  if [ "${#secret}" -ge 32 ] && [ "$secret" != "change-me-this-is-a-placeholder-not-a-secret" ]; then
    pass "the generated SESSION_SECRET is long and is not the placeholder"
  else
    fail "SESSION_SECRET is ${#secret} characters and may still be the placeholder"
  fi

  pg="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$tmp/.env" | head -n 1)"
  if [ "${#pg}" -ge 32 ] && [ "$pg" != "$secret" ]; then
    pass "POSTGRES_PASSWORD is generated separately from SESSION_SECRET"
  else
    fail "POSTGRES_PASSWORD is ${#pg} characters or repeats the session secret"
  fi

  # Every other variable must survive the rewrite untouched.
  if diff <(grep -vE '^(SESSION_SECRET|POSTGRES_PASSWORD|PORT)=' "$tmp/.env.example") \
    <(grep -vE '^(SESSION_SECRET|POSTGRES_PASSWORD|PORT)=' "$tmp/.env") >/dev/null; then
    pass "every other line of .env.example is carried over unchanged"
  else
    fail "setup.sh altered lines it should have copied verbatim"
  fi

  (cd "$tmp" && bash setup.sh >/dev/null 2>&1)
  if [ "$(sed -n 's/^SESSION_SECRET=//p' "$tmp/.env" | head -n 1)" = "$secret" ]; then
    pass "a second run leaves an existing .env alone"
  else
    fail "a second run overwrote an existing .env"
  fi
}

cmd_down() {
  section "tear down"
  compose down -v --remove-orphans >/dev/null 2>&1 && pass "removed ${PROJECT} and its volume"
}

case "${1:-all}" in
  up) cmd_up ;;
  check) cmd_check ;;
  setup) cmd_setup ;;
  down) cmd_down ;;
  all) cmd_setup; cmd_up; cmd_check; cmd_down ;;
  *) echo "usage: $0 [up|check|setup|down]"; exit 2 ;;
esac

if [ "$FAILS" -gt 0 ]; then printf '\n%s check(s) failed\n' "$FAILS"; exit 1; fi
printf '\nall checks passed\n'
