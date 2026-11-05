# FND-10 — API skeleton: app factory, two planes, registry-driven wiring

Status: approved
Phase: 1   Team: Core
Depends on: FND-07, FND-09
Size: L

## Goal
A running Express 5 app that already exposes **every** contract endpoint — bound to its owning module's handler, or answering `501 not_implemented` until that module fills it in — with the error envelope, validation, config, health, rate-limit scaffold, logging and the two separated planes in place.

## In scope
- `createApp(deps)` factory; two routers (control plane, data plane) with separate middleware and error handlers; registry-driven binding: for each endpoint, validate params/query/body from its Zod schemas, then call `modules[area].handlers[id]`, else `501`.
- Shared `http/` helpers (`HttpError`, envelope, cookies, request-id, pino logger, `trust proxy`, CSRF guard, rate-limit scaffold, 404/405 handling), `config.ts` with the **complete** env schema, `/healthz`, `/readyz`, `/api/v1/*` aliases, `/api/v1/openapi.json`, graceful shutdown.
- `http/hooks.ts`: a typed in-process hook registry (`onVersionDeployed(projectId)`, `onProjectDeleted(projectId)`, each a list of listeners that never throws into the caller) — the **only** sanctioned way for Projects/Runtime code to signal each other without importing each other's modules.
- `modules/index.ts` with an empty typed `handlers` map per area, and a **seed** of the session middleware (read path only) in `modules/auth/session-middleware.ts` so other teams can authenticate from day one.

## Out of scope
Any real handler. The data-plane behaviour (it is a `501`-with-`X-Mock-Error` stub; RUN-05 owns it). Docker (FND-14).

## Contract
- `modules/<area>/index.ts` exports `handlers: Partial<Handlers<typeof endpoints.<area>>>` — TypeScript **rejects** a handler for an endpoint id outside that area.
- `req.auth: { userId: string; sessionId: string }` set by `requireSession`; `req.log` (pino child with request id).
- `HttpError(status, code, message, details?)` and `isHttpError`; the only way to emit an error.
- Env (all read in `config.ts`; nothing else reads `process.env`):

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `HOST` | `0.0.0.0` | bind address — never `127.0.0.1` |
| `API_PORT` | `3000` | internal |
| `DATABASE_URL` | required | |
| `SESSION_SECRET` | required; placeholder warned (D8) | HMAC pepper |
| `SESSION_TTL_DAYS` | `30` | |
| `COOKIE_SECURE` | `false` | |
| `ALLOW_SIGNUP` | `true` | |
| `SEED_DEMO` | `true` | |
| `LOG_LEVEL` | `info` | |
| `TRUST_PROXY` | `1` | hops |
| `CONTROL_RATE_LIMIT` | `100` | per session per minute (tests override) |
| `LOGIN_RATE_LIMIT` | `10` | per IP per minute |
| `MOCK_RATE_LIMIT` | unset | data plane; unset = unlimited |
| `LOG_RETENTION_DAYS` / `LOG_RETENTION_ROWS` | `7` / `1000` | |
| `MOCK_CACHE_MAX_MB` | `256` | byte bound for the version cache |
| `CACHE_FANOUT` | `true` | Postgres `LISTEN`/`NOTIFY` cache fan-out (RUN-12; ignored until it merges) |

- Mount order: data-plane router **first**, mounted at `/mock`, before any body parser, cookie parser, session, CSRF or JSON error handler.

## Acceptance criteria
- [ ] `GET /api/v1/readyz` → `200 {status:"ok",db:"up"}`; with the database stopped → `503` envelope `not_ready`. `GET /readyz` and `/healthz` behave the same at the root.
- [ ] Every registry endpoint with no handler returns `501` with the envelope `{error:"not_implemented",…,details:[]}` (iterating the registry in one test) — even for endpoints that would require a session.
- [ ] An unknown `/api/v1/nope` returns `404` envelope `not_found`; malformed JSON → `400 invalid_json`; a body with an unknown key → `422 validation_failed` whose `details[0].path` names it; `Content-Type: text/plain` with a body → `415`.
- [ ] A handler that throws (sync or async) yields `500 internal_error` with no stack trace in the body and one pino error line carrying the request id; the same request id is in `X-Request-Id`.
- [ ] `POST` without `X-Mockbench-Client` → `403 csrf_rejected`; the same `GET` succeeds.
- [ ] With `CONTROL_RATE_LIMIT=3`, the 4th request in a minute from one session returns `429 rate_limited` with a numeric `Retry-After`; a second session is unaffected.
- [ ] `GET /mock/x/y` does **not** invoke the cookie parser, session middleware, CSRF guard or JSON body parser (asserted with spies) and answers `501` with `X-Mock-Error: true`.
- [ ] A fixture module binding an endpoint id from another area fails `tsc` (`@ts-expect-error` test).
- [ ] `hooks.onVersionDeployed.emit(id)` calls every registered listener once, in registration order, and a throwing listener neither stops the others nor propagates (logged once).
- [ ] `GET /api/v1/openapi.json` returns a document generated from the registry containing every control-plane path.
- [ ] `SIGTERM` stops accepting connections, drains in-flight requests and closes the pool, exiting 0 within 10 s.
- [ ] With `SESSION_SECRET` equal to the `.env.example` placeholder the app starts and logs one `warn` line; with it empty the app exits non-zero naming the variable.

## Tests
Supertest suites for each criterion; a registry-iterating test for the `501` coverage; a compile-fail test for handler ownership.

## Open questions
- Whether `X-Mockbench-Client` should be configurable off for API consumers using curl (assumed: always required; the header is trivial to add).
- Per-session limit key for unauthenticated requests (assumed client IP).
