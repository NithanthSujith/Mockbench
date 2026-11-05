# FND-14 — Docker and LAN skeleton

Status: approved
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
- [ ] From a clean clone, `cp .env.example .env && docker compose up -d` reaches all-healthy with no edits to `.env`, and `GET http://<host-non-loopback-IPv4>:8080/api/v1/readyz` returns `200` — the CI job discovers a non-loopback address of the runner and curls it (proving the mapping is not loopback-only).
- [ ] `docker compose port web 80` prints `0.0.0.0:8080`; `docker compose config` shows no published port for `db` or `api`.
- [ ] `docker compose config --volumes` prints exactly `pgdata`; `docker compose config` contains no `bind` volume type; `docker compose logs api` shows newline-delimited JSON (pino) lines.
- [ ] `docker compose ps` shows `db`, `api`, `web` healthy; stopping `db` turns `api` unhealthy within 60 s (its `/readyz` is `503`); `web` does not start before `api` is healthy on a cold start.
- [ ] `curl -i -X OPTIONS -H 'Origin: http://x.test' -H 'Access-Control-Request-Method: POST' http://<LAN-IP>:8080/mock/anything/at/all` returns a `2xx` response (not a nginx `405`/SPA page) — i.e. nginx does not intercept `OPTIONS` on `/mock/`.
- [ ] `grep -rE "localhost|127\.0\.0\.1" apps/web/dist` returns nothing except library boilerplate recorded in an allow-list file reviewed in the PR; `apps/web/src` has none (lint).
- [ ] With the app opened in a browser at `http://mockbench.lan.test:8080` (host-resolver mapped to the runner), the topbar base URL text contains `mockbench.lan.test:8080/mock/` and not `localhost` (Playwright).
- [ ] A `Set-Cookie` produced by a test route over plain HTTP has `HttpOnly; SameSite=Lax; Path=/`, **no `Secure`, no `Domain`**; with `COOKIE_SECURE=true` it adds `Secure`.
- [ ] Starting two `api` containers at once (`docker compose up --scale api=2`) against an empty `pgdata` applies each migration exactly once and both become healthy.
- [ ] `docker buildx build --platform linux/amd64,linux/arm64` succeeds for both images in CI (no push), and the runtime image runs as a non-root user (`id -u` ≠ 0).
- [ ] The api image contains no `drizzle-kit` and the entrypoint migrates via the programmatic migrator.
- [ ] The README contains a "Run it on your LAN" section that names the URL form `http://<this-machine's-LAN-IP>:8080`, shows how to find the IP on macOS, Linux and Windows, and tells the user they may need to allow the port through the host firewall (and notes Docker Desktop may show a gateway IP in logs).

## Tests
A `scripts/lan-smoke.sh` driven by CI (steps above); Playwright test for the base-URL and cookie checks; image-inspection assertions (`docker inspect`).

## Open questions
- IPv6 publishing (`[::]:8080`) in the compose mapping — add or leave to the OS default?
- Whether `docker-compose.pull.yml` should pin image digests (REL-02).
