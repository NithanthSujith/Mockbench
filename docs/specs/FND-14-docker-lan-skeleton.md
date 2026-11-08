# FND-14 — Docker and LAN skeleton

Status: done
Phase: 1   Team: Core
Depends on: FND-10, FND-13
Size: L

## Goal
`cp .env.example .env && docker compose up` produces a working instance — editor UI and mock endpoints on one port — that every machine on the LAN can reach, before any feature exists. This unit exists because these are the details that break on day one.

## In scope
- `docker/api.Dockerfile` (multi-stage, `node:22-alpine`, non-root `node` user, `dist` + production deps only), `docker/web.Dockerfile` (Vite build → `nginx:alpine`), `docker/nginx.conf`, `docker/api-entrypoint.sh` (migrate behind the advisory lock, then start).
- `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.pull.yml`, `.env.example`, `.dockerignore`; buildx multi-arch setup.
- README "Run it on your LAN" section and a CI job that proves the LAN properties below.

## Out of scope
The release/GHCR workflow (REL-02). Real features: the stack serves the skeleton ("hello" page via the SPA shell, `/api/v1/readyz`, mock `501`). Demo seed (RUN-11).

## Contract
- Compose services `db` (`postgres:16-alpine`, **not published**), `api` (not published; internal 3000), `web` (publishes `"0.0.0.0:${PORT:-8080}:80"`). One named volume: `pgdata`. No bind mounts in `docker-compose.yml`.
- nginx: `listen 80` and `listen [::]:80`; `location /api/` and `location /mock/` proxy to `api:3000` with `proxy_http_version 1.1`, `Host $host`, `X-Forwarded-For $remote_addr`, `X-Forwarded-Proto $scheme`, `proxy_read_timeout 60s`, no `OPTIONS` interception; everything else `try_files $uri /index.html`.
- API listens on `HOST=0.0.0.0`; `TRUST_PROXY=1`.
- `.env.example` (committed) contains every variable from FND-10's table with safe LAN defaults, a **clearly labelled placeholder** `SESSION_SECRET` (D8), and `PORT=8080`, `COOKIE_SECURE=false`.
- Healthchecks: `db` — `pg_isready`; `api` — `node -e "fetch('http://127.0.0.1:3000/readyz')…"` (**`127.0.0.1`, not `localhost`**); `web` — `wget -qO- http://127.0.0.1/ >/dev/null`. `api` `depends_on: db: {condition: service_healthy}`; `web` `depends_on: api: {condition: service_healthy}`.
- Images build for `linux/amd64` and `linux/arm64`.

## Acceptance criteria
- [x] From a clean clone, `cp .env.example .env && docker compose up -d` reaches all-healthy with no edits to `.env`, and `GET http://<host-non-loopback-IPv4>:8080/api/v1/readyz` returns `200` — the CI job discovers a non-loopback address of the runner and curls it (proving the mapping is not loopback-only). *(Local: all healthy in 48 s; `readyz` and `instance` answered at the non-loopback address 192.168.29.27:18080 by `scripts/lan-smoke.sh`. CI runs the same script on the runner address in the `lan-smoke` job: first run pending.)*
- [x] `docker compose port web 80` prints `0.0.0.0:8080`; `docker compose config` shows no published port for `db` or `api`. *(Local: `0.0.0.0:18080`; `compose config` shows no ports on db/api.)*
- [x] `docker compose config --volumes` prints exactly `pgdata`; `docker compose config` contains no `bind` volume type; `docker compose logs api` shows newline-delimited JSON (pino) lines. *(Local.)*
- [x] `docker compose ps` shows `db`, `api`, `web` healthy; stopping `db` turns `api` unhealthy within 60 s (its `/readyz` is `503`); `web` does not start before `api` is healthy on a cold start. *(Local: api turned unhealthy 36 s after the database stopped; web `start` event is after the api `health_status: healthy` event on a cold start; api recovered after the database returned.)*
- [x] `curl -i -X OPTIONS -H 'Origin: http://x.test' -H 'Access-Control-Request-Method: POST' http://<LAN-IP>:8080/mock/anything/at/all` is **answered by the api, not nginx**: the response carries `X-Mock-Error: true` (the Phase-1 data-plane stub answers 501; RUN-05 later makes it a 204 with CORS headers), and is not an nginx 405 or the SPA `index.html`. *(Amended 2026-11-08: the stub cannot return 2xx yet.)* *(Local.)*
- [x] `grep -rE "localhost|127\.0\.0\.1" apps/web/dist` returns nothing except library boilerplate recorded in an allow-list file reviewed in the PR; `apps/web/src` has none (lint). *(Local: one match, TanStack Router's `window.origin:`http://localhost`` URL-parsing fallback, recorded in `docker/web-dist-hosts.allowlist`.)*
- [x] The SPA is served at `http://mockbench.lan.test:8080` (host-resolver mapped to the runner), its assets load with relative URLs from that origin, `GET /api/v1/instance` through nginx returns the instance JSON, and no request leaves that host (Playwright). *(Amended 2026-11-08: the topbar base-URL text needs a signed-in project page, so that assertion moves to XC-01, which already contains it.)* *(Local, Playwright at `mockbench.lan.test:18080`.)*
- [x] *Moved to XC-01 (2026-11-08):* the session cookie attributes (`HttpOnly; SameSite=Lax; Path=/`, no `Secure`, no `Domain`; `Secure` only with `COOKIE_SECURE=true`) need a real sign-in, so XC-01 asserts them against this stack. This unit proves only that `COOKIE_SECURE` reaches the container environment and defaults to false.
- [x] Starting two `api` containers at once (`docker compose up --scale api=2`) against an empty `pgdata` applies each migration exactly once and both become healthy. *(Local: 3 migrations, applied once between the two containers; both healthy.)*
- [x] `docker buildx build --platform linux/amd64,linux/arm64` succeeds for both images in CI (no push), and the runtime image runs as a non-root user (`id -u` ≠ 0). *(Local: both images built for `linux/amd64` and `linux/arm64` on a temporary docker-container builder, 4 m 41 s (web) and 2 m 22 s (api); runtime user is `node` (uid 1000), verified on amd64. **Pending CI:** the `multiarch-build` job has not run yet; tick after its first green run.)* *(CI evidence: run 42474229187 - multiarch-build (api) and (web) both succeeded for linux/amd64 and linux/arm64, and lan-smoke passed, on 2026-11-08.)*
- [x] The api image contains no `drizzle-kit` and the entrypoint migrates via the programmatic migrator. *(Local: also no `esbuild`, `tsx`, `typescript` or `@mockbench/*` sources; node_modules is 39.7 MB.)*
- [x] The README contains a "Run it on your LAN" section that names the URL form `http://<this-machine's-LAN-IP>:8080`, shows how to find the IP on macOS, Linux and Windows, and tells the user they may need to allow the port through the host firewall (and notes Docker Desktop may show a gateway IP in logs).

## Decisions and implementation notes (recorded 2026-11-08)
- **Production node_modules (api image):** the build stage installs only the workspace subset the api needs (`pnpm install --frozen-lockfile --filter "@mockbench/api..."`), bundles with `apps/api/build.mjs`, then runs `pnpm --filter @mockbench/api deploy --prod --legacy /out` and deletes `/out/node_modules/@mockbench` (the workspace packages are inlined into `dist/*.js`). The runtime image copies only that `node_modules` and `dist`: 5 top-level packages (`cookie`, `drizzle-orm`, `express`, `pg`, `pino`), no dev dependencies, no TypeScript sources, 196 MB total. `--legacy` is needed because pnpm 10 refuses `deploy` without `inject-workspace-packages`.
- **nginx resolves `api` per request** (`resolver 127.0.0.11 valid=5s` plus a `set $api` variable in `proxy_pass`), so a restarted or scaled api container is picked up within seconds instead of leaving nginx pointing at a stale IP (502s). Consequence: nginx needs Docker's embedded DNS (compose provides it).
- **`SESSION_SECRET` uses `${SESSION_SECRET:?…}` in compose.** It fails immediately with a clear message when unset or empty (no .env copied), and does **not** reject the non-empty placeholder from `.env.example`, so the three-command quickstart works (the api logs a warning). An empty value passed some other way is rejected by the api config, naming the variable.
- **Healthcheck timing:** api `interval 5s, timeout 3s, retries 5, start_period 30s` (DESIGN's 10 s × 5 would take about 50 s to flag an outage, too close to the 60 s criterion); measured unhealthy 36 s after the database stopped.
- **Env pass-through:** compose maps every variable from FND-10's table with the same defaults; `MOCK_RATE_LIMIT` defaults to empty, which the api treats as unset.
- **IPv6 (open question):** nginx listens on `[::]:80` inside the container; the host mapping is IPv4 (`0.0.0.0:${PORT}:80`). Publishing on the host's IPv6 addresses is left to a later request.
- **`docker-compose.dev.yml`** is a standalone file (not an override): just the database, published on `127.0.0.1:${DEV_DB_PORT:-5432}`, own volume `pgdata_dev`, project `mockbench-dev`.
- **`docker-compose.pull.yml`** mirrors the main file with `image: ghcr.io/nithanthsujith/mockbench-{api,web}:${MOCKBENCH_VERSION:-latest}` (digest pinning stays an open question for REL-02).
- **Added files beyond the list:** `scripts/lan-ip.mjs` (picks the LAN address, skipping VMware/WSL/Hyper-V/Docker adapters; `LAN_IP` overrides), `docker/web-dist-hosts.allowlist` (reviewed `localhost` matches in the bundle), `e2e/playwright.lan.config.ts` and `e2e/lan.spec.ts`.
- **Playwright layout:** `@playwright/test` is installed under `apps/web`, so the root `e2e/` files import it by relative path to `index.mjs` (same installed copy as the runner). The test makes every request from inside the page: Playwright's Node-side `page.request` does not use the browser's host-name mapping.
- **Windows/Git Bash:** `scripts/lan-smoke.sh` sets `MSYS_NO_PATHCONV=1` so container paths are not rewritten, and therefore never passes a temp-file path to a native program (curl); it captures output through the shell instead.
- **CI:** `.github/workflows/ci.yml` gains `lan-smoke` (up, check, Playwright, outage, down, scale, down; logs on failure; always tears down) and `multiarch-build` (matrix api/web, QEMU + buildx, `linux/amd64,linux/arm64`, no push). `actionlint` is clean. Neither job has run on GitHub yet.
- **Local runs:** project `mockbench-fnd14`, port 18080; everything removed afterwards (containers, volumes, networks, images, the temporary buildx builder). `mockbench-test-pg` (port 55432) was not touched.

## Tests
A `scripts/lan-smoke.sh` driven by CI (steps above); Playwright test for the base-URL and cookie checks; image-inspection assertions (`docker inspect`).

## Open questions
- IPv6 publishing: see "Decisions and implementation notes" (container listens on `[::]:80`; host mapping is IPv4 only).
- Whether `docker-compose.pull.yml` should pin image digests (REL-02).
