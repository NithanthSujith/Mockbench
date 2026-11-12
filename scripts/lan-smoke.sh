#!/usr/bin/env bash
# LAN smoke test for the compose stack (FND-14). Proves the properties that break on day one, using
# only what exists before any feature: the SPA, /api/v1/readyz, /api/v1/instance and the mock stub.
#
#   scripts/lan-smoke.sh            everything: up, check, outage, down, scale, down   (default)
#   scripts/lan-smoke.sh up         cold start (also checks web waited for the api to be healthy)
#   scripts/lan-smoke.sh check      the checks against a running stack
#   scripts/lan-smoke.sh playwright browser check at a host-resolver-mapped name (needs a running stack)
#   scripts/lan-smoke.sh outage     stop the database, expect the api to turn unhealthy, restart it
#   scripts/lan-smoke.sh scale      two api containers against an empty volume: each migration once
#   scripts/lan-smoke.sh down       remove the stacks and their volumes
#
# Environment: LAN_SMOKE_PORT (default 8080), LAN_SMOKE_PROJECT (default mockbench-lansmoke),
# LAN_IP (override the discovered LAN address), RUN_PLAYWRIGHT=1 (include the browser check in `all`).
# Runs from Git Bash on Windows, macOS and Linux.
#
# Windows note: Git Bash rewrites /unix/paths in arguments to native programs. We switch that off so
# container paths (/usr/share/...) reach docker untouched, and therefore never pass a temp-file path
# to a native program (curl): output is captured through shell redirection or command substitution.
set -u
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

cd "$(dirname "$0")/.."
PORT="${LAN_SMOKE_PORT:-8080}"
PROJECT="${LAN_SMOKE_PROJECT:-mockbench-lansmoke}"
SCALE_PROJECT="${PROJECT}-scale"
export PORT
ENV_FILE=".env.example" # the exact configuration the three-command quickstart uses

compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" "$@"; }
compose_scale() { docker compose -p "$SCALE_PROJECT" --env-file "$ENV_FILE" "$@"; }

FAILS=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
info() { printf '  ---- %s\n' "$*"; }
section() { printf '\n== %s\n' "$*"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

lan_ip() { node scripts/lan-ip.mjs; }

# http <curl args...>: sets HTTP_CODE and HTTP_BODY (response headers excluded).
HTTP_CODE=""
HTTP_BODY=""
http() {
  local out
  out="$(curl -s -w '\n%{http_code}' --max-time 10 "$@")"
  HTTP_CODE="${out##*$'\n'}"
  HTTP_BODY="${out%$'\n'*}"
}

# wait_for <seconds> <command...>: polls once a second until the command succeeds.
wait_for() {
  local limit="$1"; shift
  local i=0
  while [ "$i" -lt "$limit" ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

# service_health <compose-fn> <service>: health status of the service's first container.
service_health() {
  local id
  id="$($1 ps -q "$2" | head -1)"
  if [ -n "$id" ]; then
    docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id"
  fi
}

# health_is <compose-fn> <service> <status>: true while the service currently has that status.
# (A function, so wait_for re-evaluates it on every poll instead of once up front.)
health_is() { [ "$(service_health "$1" "$2")" = "$3" ]; }

# ---------------------------------------------------------------------------------------------------
cmd_up() {
  section "cold start (${PROJECT}, port ${PORT})"
  compose events --json > "$WORK/events.jsonl" 2>/dev/null &
  local events_pid=$!
  sleep 1
  if compose up -d --build --wait; then
    pass "docker compose up -d --build --wait reached all-healthy"
  else
    fail "docker compose up --wait did not reach all-healthy"
    compose logs --tail 80
  fi
  kill "$events_pid" 2>/dev/null
  sleep 1

  # web must not START before the api reported healthy (depends_on: condition: service_healthy)
  local verdict
  verdict="$(cd "$WORK" && node -e '
    const fs = require("fs");
    const ev = fs.readFileSync("events.jsonl", "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
    const t = (e) => Date.parse(e.time);
    const first = (service, action) => ev.filter((e) => e.service === service && e.action === action).map(t).sort((a, b) => a - b)[0];
    const apiHealthy = first("api", "health_status: healthy");
    const webStart = first("web", "start");
    if (!apiHealthy || !webStart) console.log("missing events api-healthy=" + apiHealthy + " web-start=" + webStart);
    else console.log(webStart >= apiHealthy ? "ok" : "web started " + (apiHealthy - webStart) + "ms BEFORE the api was healthy");
  ')"
  if [ "$verdict" = "ok" ]; then pass "web started only after the api was healthy (compose events)"; else fail "cold-start ordering: ${verdict}"; fi
}

cmd_check() {
  local ip base
  ip="$(lan_ip)" || { fail "no non-loopback IPv4 address found (set LAN_IP)"; return; }
  base="http://${ip}:${PORT}"
  section "checks against ${base} (non-loopback LAN address ${ip})"

  # --- health and reachability on the LAN address (proves the port is not bound to loopback only)
  local s h
  for s in db api web; do
    h="$(service_health compose "$s")"
    if [ "$h" = "healthy" ]; then pass "${s} is healthy"; else fail "${s} health is '${h}', expected healthy"; fi
  done

  http "${base}/api/v1/readyz"
  if [ "$HTTP_CODE" = "200" ] && echo "$HTTP_BODY" | grep -q '"status":"ok"'; then
    pass "GET ${base}/api/v1/readyz -> 200"
  else fail "readyz at ${base} returned ${HTTP_CODE}: ${HTTP_BODY}"; fi

  http "${base}/api/v1/instance"
  if echo "$HTTP_BODY" | grep -q '"name":"Mockbench"'; then
    pass "GET /api/v1/instance through nginx returns the instance JSON"
  else fail "instance JSON missing (${HTTP_CODE}): ${HTTP_BODY}"; fi

  http "${base}/p/some-project/routes/abc"
  if [ "$HTTP_CODE" = "200" ] && echo "$HTTP_BODY" | grep -qi '<div id="root"'; then
    pass "a client-side route falls back to index.html"
  else fail "SPA fallback returned ${HTTP_CODE}"; fi

  http "${base}/api/v1/does-not-exist"
  if [ "$HTTP_CODE" = "404" ] && echo "$HTTP_BODY" | grep -q '"error"'; then
    pass "an unknown /api path reaches the api (404 envelope), not the SPA"
  else fail "unknown /api path returned ${HTTP_CODE}: ${HTTP_BODY}"; fi

  # --- OPTIONS must reach the api untouched
  curl -s -i -X OPTIONS -H 'Origin: http://x.test' -H 'Access-Control-Request-Method: POST' --max-time 10 \
    "${base}/mock/anything/at/all" > "$WORK/options.txt"
  # RUN-05: the data plane answers OPTIONS itself with 204 + permissive CORS (no X-Mock-Error).
  if head -1 "$WORK/options.txt" | grep -q ' 204 ' && grep -qi '^access-control-allow-origin: \*' "$WORK/options.txt" \
     && grep -qi '^access-control-max-age: 600' "$WORK/options.txt" && ! grep -qi 'text/html' "$WORK/options.txt"; then
    pass "OPTIONS /mock/... is answered by the api (204 + CORS), not nginx or index.html"
  else fail "OPTIONS /mock/... was not answered by the api: $(head -3 "$WORK/options.txt" | tr '\r\n' '  ')"; fi

  # --- network exposure and compose shape
  local published
  published="$(compose port web 80 2>/dev/null | tr -d '\r')"
  if [ "$published" = "0.0.0.0:${PORT}" ]; then pass "docker compose port web 80 -> ${published}"; else fail "docker compose port web 80 printed '${published}', expected 0.0.0.0:${PORT}"; fi

  compose config --format json > "$WORK/config.json"
  local verdict
  verdict="$(cd "$WORK" && node -e '
    const c = JSON.parse(require("fs").readFileSync("config.json", "utf8"));
    const out = [];
    for (const s of ["db", "api"]) if ((c.services[s].ports ?? []).length) out.push(s + " publishes " + JSON.stringify(c.services[s].ports));
    const web = c.services.web.ports ?? [];
    if (web.length !== 1 || web[0].host_ip !== "0.0.0.0") out.push("web must publish exactly one port on 0.0.0.0, got " + JSON.stringify(web));
    const vols = Object.keys(c.volumes ?? {});
    if (vols.length !== 1 || !vols[0].endsWith("pgdata")) out.push("volumes must be exactly pgdata, got " + JSON.stringify(vols));
    for (const [n, s] of Object.entries(c.services)) for (const v of s.volumes ?? []) if (v.type === "bind") out.push(n + " has a bind mount " + v.source);
    if (c.services.api.depends_on?.db?.condition !== "service_healthy") out.push("api must depend on db service_healthy");
    if (c.services.web.depends_on?.api?.condition !== "service_healthy") out.push("web must depend on api service_healthy");
    const env = c.services.api.environment ?? {};
    if (env.HOST !== "0.0.0.0") out.push("api HOST must be 0.0.0.0, got " + env.HOST);
    if (env.TRUST_PROXY !== "1") out.push("api TRUST_PROXY must be 1, got " + env.TRUST_PROXY);
    if (env.COOKIE_SECURE !== "false") out.push("COOKIE_SECURE must default to false, got " + env.COOKIE_SECURE);
    const hc = JSON.stringify(c.services.api.healthcheck?.test ?? []);
    if (!hc.includes("127.0.0.1:3000/readyz") || hc.includes("localhost")) out.push("api healthcheck must use 127.0.0.1, got " + hc);
    console.log(out.length ? out.join("; ") : "ok");
  ')"
  if [ "$verdict" = "ok" ]; then
    pass "compose config: db/api unpublished, web on 0.0.0.0, only pgdata, no bind mounts, health-gated, api HOST=0.0.0.0 TRUST_PROXY=1 COOKIE_SECURE=false"
  else fail "compose config: ${verdict}"; fi

  local vols
  vols="$(compose config --volumes | tr -d '\r')"
  if [ "$vols" = "pgdata" ]; then pass "docker compose config --volumes prints exactly pgdata"; else fail "config --volumes printed '${vols}'"; fi

  # --- logs: newline-delimited JSON (the entrypoint's one plain 'migrate:' line is the only exception)
  compose logs --no-log-prefix api > "$WORK/api.log" 2>&1
  verdict="$(cd "$WORK" && node -e '
    const lines = require("fs").readFileSync("api.log", "utf8").split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
    let json = 0; const bad = [];
    for (const l of lines) {
      try { const o = JSON.parse(l); if (o && typeof o === "object" && "level" in o) json++; else bad.push(l) }
      catch { if (!l.startsWith("migrate:")) bad.push(l) }
    }
    console.log(json > 0 && bad.length === 0 ? "ok" : "json=" + json + " non-json=" + JSON.stringify(bad.slice(0, 3)));
  ')"
  if [ "$verdict" = "ok" ]; then pass "docker compose logs api is newline-delimited JSON (pino)"; else fail "api logs: ${verdict}"; fi

  # --- image contents
  local uid dk ep env_cs web_index
  uid="$(compose exec -T api id -u | tr -d '\r')"
  if [ -n "$uid" ] && [ "$uid" != "0" ]; then pass "api container runs as non-root (uid ${uid})"; else fail "api container uid is '${uid}'"; fi
  dk="$(compose exec -T api sh -c 'find / -maxdepth 6 -name "drizzle-kit*" -not -path "/proc/*" 2>/dev/null | head -3' | tr -d '\r')"
  if [ -z "$dk" ]; then pass "api image contains no drizzle-kit"; else fail "drizzle-kit found: ${dk}"; fi
  ep="$(compose exec -T api cat /usr/local/bin/api-entrypoint.sh)"
  if echo "$ep" | grep -q 'node dist/migrate.js' && ! echo "$ep" | grep -q 'drizzle-kit'; then
    pass "entrypoint migrates via the programmatic migrator (node dist/migrate.js)"
  else fail "entrypoint does not run dist/migrate.js"; fi
  env_cs="$(compose exec -T api printenv COOKIE_SECURE | tr -d '\r')"
  if [ "$env_cs" = "false" ]; then pass "COOKIE_SECURE reaches the container and defaults to false"; else fail "COOKIE_SECURE in the container is '${env_cs}'"; fi
  web_index="$(compose exec -T web sh -c 'test -f /usr/share/nginx/html/index.html && echo present' | tr -d '\r')"
  if [ "$web_index" = "present" ]; then pass "the SPA is baked into the web image (no bind mount)"; else fail "index.html missing from the web image"; fi

  # --- no hardcoded hosts in the built SPA bundle (beyond reviewed library boilerplate)
  compose exec -T web sh -c 'grep -rEoh ".{0,60}(localhost|127\.0\.0\.1).{0,40}" /usr/share/nginx/html || true' \
    | tr -d '\r' > "$WORK/hosts.txt"
  grep -vE '^\s*(#|$)' docker/web-dist-hosts.allowlist | tr -d '\r' > "$WORK/allow.txt"
  verdict="$(cd "$WORK" && node -e '
    const fs = require("fs");
    const allow = fs.readFileSync("allow.txt", "utf8").split("\n").filter(Boolean);
    const found = fs.readFileSync("hosts.txt", "utf8").split("\n").filter(Boolean);
    const bad = found.filter((l) => !allow.some((a) => l.includes(a)));
    console.log(bad.length ? "unreviewed: " + JSON.stringify(bad.slice(0, 3)) : "ok (" + found.length + " reviewed match(es))");
  ')"
  case "$verdict" in
    ok*) pass "built web bundle has no localhost/127.0.0.1 beyond the reviewed allow-list: ${verdict}" ;;
    *) fail "built web bundle host check: ${verdict}" ;;
  esac
}

cmd_playwright() {
  section "browser check at a host-resolver-mapped name (mockbench.lan.test)"
  if LAN_PORT="$PORT" pnpm --filter @mockbench/web exec playwright test --config ../../e2e/playwright.lan.config.ts; then
    pass "Playwright: SPA, relative assets and /api/v1/instance served at mockbench.lan.test:${PORT}; no request left that host"
  else fail "the Playwright LAN test failed"; fi
}

cmd_outage() {
  section "database outage"
  compose stop db >/dev/null 2>&1
  local started=$SECONDS
  if wait_for 60 health_is compose api unhealthy; then
    pass "api turned unhealthy $((SECONDS - started))s after the database stopped (limit 60s)"
  else fail "api is '$(service_health compose api)' 60s after the database stopped, expected unhealthy"; fi

  local ip
  ip="$(lan_ip)"
  http "http://${ip}:${PORT}/api/v1/readyz"
  if [ "$HTTP_CODE" = "503" ]; then pass "GET /api/v1/readyz returns 503 while the database is down"; else fail "readyz returned ${HTTP_CODE} with the database down, expected 503"; fi

  compose start db >/dev/null 2>&1
  if wait_for 90 health_is compose api healthy; then
    pass "api recovered to healthy after the database came back"
  else info "api did not recover within 90s (informational, not a criterion)"; fi
}

cmd_scale() {
  section "two api containers, one empty database (${SCALE_PROJECT})"
  compose_scale down -v --remove-orphans >/dev/null 2>&1
  if compose_scale up -d --build --scale api=2 --wait db api; then
    pass "up --scale api=2 reached healthy"
  else
    fail "scale up failed"
    compose_scale logs --tail 60
  fi

  local ids n healthy=0 id
  ids="$(compose_scale ps -q api)"
  n="$(echo "$ids" | grep -c .)"
  for id in $ids; do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$id")" = "healthy" ]; then healthy=$((healthy + 1)); fi
  done
  if [ "$n" = "2" ] && [ "$healthy" = "2" ]; then pass "both api containers are healthy"; else fail "api containers: ${n}, healthy: ${healthy}"; fi

  local expected rows distinct
  expected="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("apps/api/src/db/migrations/meta/_journal.json","utf8")).entries.length)')"
  rows="$(compose_scale exec -T db psql -U mock -d mockserver -tAc 'select count(*) from drizzle.__drizzle_migrations' | tr -d '\r ')"
  distinct="$(compose_scale exec -T db psql -U mock -d mockserver -tAc 'select count(distinct hash) from drizzle.__drizzle_migrations' | tr -d '\r ')"
  if [ "$rows" = "$expected" ] && [ "$distinct" = "$expected" ]; then
    pass "each of the ${expected} migrations was applied exactly once"
  else fail "migration rows=${rows} distinct=${distinct} expected=${expected}"; fi

  local applied=0 a
  for id in $ids; do
    a="$(docker logs "$id" 2>&1 | grep -o 'migrate: applied [0-9]*' | grep -o '[0-9]*$' | head -1)"
    applied=$((applied + ${a:-0}))
  done
  if [ "$applied" = "$expected" ]; then
    pass "the two containers applied ${expected} migrations between them (the other found nothing to do)"
  else fail "the containers reported ${applied} applied migrations in total, expected ${expected}"; fi
  compose_scale down -v --remove-orphans >/dev/null 2>&1
}

cmd_down() {
  section "teardown"
  if compose down -v --remove-orphans >/dev/null 2>&1; then pass "removed ${PROJECT} (containers, network, volumes)"; fi
  compose_scale down -v --remove-orphans >/dev/null 2>&1
}

summary() {
  printf '\n'
  if [ "$FAILS" -eq 0 ]; then
    printf '\033[32mlan-smoke: all checks passed\033[0m\n'
  else
    printf '\033[31mlan-smoke: %s check(s) failed\033[0m\n' "$FAILS"
  fi
  [ "$FAILS" -eq 0 ]
}

case "${1:-all}" in
  up) cmd_up ;;
  check) cmd_check ;;
  playwright) cmd_playwright ;;
  outage) cmd_outage ;;
  scale) cmd_scale ;;
  down) cmd_down ;;
  all)
    cmd_up
    cmd_check
    if [ "${RUN_PLAYWRIGHT:-0}" = "1" ]; then cmd_playwright; fi
    cmd_outage
    cmd_down
    cmd_scale
    cmd_down
    ;;
  *) echo "usage: $0 [all|up|check|playwright|outage|scale|down]" >&2; exit 2 ;;
esac
summary
