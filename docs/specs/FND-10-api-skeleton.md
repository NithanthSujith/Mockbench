# FND-10 — API skeleton: app factory, two planes, registry-driven wiring

Status: done
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
- [x] `GET /api/v1/readyz` → `200 {status:"ok",db:"up"}`; with the database stopped → `503` envelope `not_ready`. `GET /readyz` and `/healthz` behave the same at the root. *(Database-down case tested with an app whose pool points at a closed port, not by stopping the shared test database.)*
- [x] Every registry endpoint with no handler returns `501` with the envelope `{error:"not_implemented",…,details:[]}` (iterating the registry in one test) — even for endpoints that would require a session.
- [x] An unknown `/api/v1/nope` returns `404` envelope `not_found`; malformed JSON → `400 invalid_json`; a body with an unknown key → `422 validation_failed` whose `details[0].path` names it; `Content-Type: text/plain` with a body → `415`.
- [x] A handler that throws (sync or async) yields `500 internal_error` with no stack trace in the body and one pino error line carrying the request id; the same request id is in `X-Request-Id`.
- [x] `POST` without `X-Mockbench-Client` → `403 csrf_rejected`; the same `GET` succeeds.
- [x] With `CONTROL_RATE_LIMIT=3`, the 4th request in a minute from one session returns `429 rate_limited` with a numeric `Retry-After`; a second session is unaffected.
- [x] `GET /mock/x/y` does **not** invoke the cookie parser, session middleware, CSRF guard or JSON body parser (asserted with spies) and answers `501` with `X-Mock-Error: true`.
- [x] A fixture module binding an endpoint id from another area fails `tsc` (`@ts-expect-error` test).
- [x] `hooks.onVersionDeployed.emit(id)` calls every registered listener once, in registration order, and a throwing listener neither stops the others nor propagates (logged once).
- [x] `GET /api/v1/openapi.json` returns a document generated from the registry containing every control-plane path.
- [x] `SIGTERM` stops accepting connections, drains in-flight requests and closes the pool, exiting 0 within 10 s. *(`createShutdown` is tested in-process on every platform: in-flight request completes, idle keep-alive does not block, stuck requests are cut after the drain budget, pool closed once. The real-signal test of the built `dist/server.js` is `it.skipIf(win32)` because Node cannot catch SIGTERM on Windows; it runs on Linux CI and has NOT been run locally.)*
- [x] With `SESSION_SECRET` equal to the `.env.example` placeholder the app starts and logs one `warn` line; with it empty the app exits non-zero naming the variable. *(Verified both in-process via `start()` and on the built artifact.)*

## Tests
Supertest suites for each criterion; a registry-iterating test for the `501` coverage; a compile-fail test for handler ownership.

## Implementation notes (decisions and additions made while building)
**Entry points and build** (decision recorded here). `src/server.ts` starts the app and runs **no** migrations (FND-14's entrypoint runs `migrate` first). `pnpm --filter @mockbench/api dev` = `tsx watch --env-file-if-exists=../../.env src/dev.ts` (`dev.ts` defaults `NODE_ENV=development` for pretty logs). `build` = `node build.mjs`: an esbuild bundle (platform node, ESM, sourcemaps) producing `dist/server.js` and `dist/migrate.js`, **inlining the `@mockbench/*` workspace packages** (and, transitively, zod) and keeping every other `dependencies` entry external, plus `dist/migrations` copied next to `migrate.js`. `typecheck` stays `tsc --noEmit`. `start` = `node dist/server.js`. This answers FND-09's open question about how `bin/migrate` runs outside the source tree: `node dist/migrate.js`. FND-14 copies `dist/` plus production `node_modules` into the image.

**Modules.** `modules/index.ts` lists the module directories; each `modules/<dir>/index.ts` exports `areas` (the endpoint-id prefixes it owns), `handlers: ModuleHandlers<Areas>` and optionally `init(ctx)` (db, pool, config, hooks, log) for registering hook listeners. Area ownership: auth=`auth`; workspaces=`workspaces`+`members`; projects; presets; routes; cases; schema; versions=`versions`+`deploy`+`deployments`+`cache`; requests; **system** (`system.*`, **Core-owned**, implemented for real here: instance, healthz, readyz, openapi). A test asserts every registry area is owned by exactly one module. The data plane is `modules/dataplane/router.ts` (a router, not handlers; RUN-05 replaces its body). `collectHandlers` also enforces ownership at runtime; the compile-time half is `modules/__fixtures__/ownership.typecheck.ts` (`@ts-expect-error` lines, checked by `pnpm typecheck`).

**Handler contract.** `Handler<E> = (ctx: ApiContext, input) => Promise<{ status, body? }>` with `input = { params, query, body }` parsed by the registry schemas and the return type checked against the endpoint's declared responses. `ApiContext` = `{ req, res, requestId, log, db, pool, config, hooks, auth, ip }`; `authOf(ctx)` returns the caller or throws 401. The contract package's own `HandlerContext` is empty and cannot be augmented across a package boundary, so the api defines its own `Handler`/`ModuleHandlers` types (reusing `EndpointInput`/`EndpointResponse`).

**Control-plane step order** (names are what `trace` reports): `request-id` → `csrf` → `cookies` → `session` (optional) → `rate-limit` → per endpoint: `require-session` (non-public, **bound** endpoints only) → `json-body` → validate → handler. Validation errors use `toValidationIssues` with `params`/`query` path prefixes (body paths are relative to the body).

**Behaviours the spec did not spell out (strictly implied; confirm if you disagree).**
- An unbound endpoint answers 501 *before* authentication, body parsing and validation (that is what makes "every endpoint, even session ones, is 501" true).
- An unknown path **or a wrong method on a known path** is `404 not_found`: the contract has no 405 code, so none is invented.
- An absent body is validated as `{}` (all-optional bodies pass; required fields are reported). Any non-empty body must be `application/json` even when the endpoint declares no body schema.
- A stale/unknown session cookie on a *public* endpoint is tolerated (no 401, cookie left alone); only a 401 on a protected endpoint clears it.
- An undecodable percent-escape in a path is `422 validation_failed` with issue code `invalid_encoding`, not a 500.
- Login/register are limited per IP by `LOGIN_RATE_LIMIT` in addition to the per-session/per-IP control-plane limit.
- The data-plane stub's body is `{ error: "not_implemented", message, hint }`; `not_implemented` is not in the API-CONTRACT 4.5 table (stub only).

**Addition to flag (not in the original spec):** outside `NODE_ENV=production` every handler response is checked against the endpoint's declared status and body schema; drift is a loud `500 internal_error` plus an error log naming the endpoint, instead of a silent contract violation. It is off in production.

**Config.** `apps/api` has no direct `zod` dependency, so `config.ts` validates by hand (`loadConfig(env)`, reports every problem at once). It also validates `NODE_ENV`, `TRUST_PROXY` (hop count, true, false) and `MOCK_RATE_LIMIT` (positive integer or unset; RUN-13 relies on this).

**`hashSessionToken(token, secret)`** (hex HMAC-SHA-256) lives in `access/session-token.ts`; `createTokenHasher(secret)` binds the secret. FND-11 and AUTH-01 build on it.

**Verified:** 146 tests in `apps/api` pass (1 skipped on Windows, see above): config, envelope/validation/413/415/400/422, CSRF, 501 sweep over the registry, request id and 500 handling, rate limits, session seam, data-plane isolation by spy, hooks, shutdown, `start()`, and the built artifact (`node dist/server.js`, `node dist/migrate.js`).

## Open questions
- Whether `X-Mockbench-Client` should be configurable off for API consumers using curl (assumed: always required; the header is trivial to add).
- Per-session limit key for unauthenticated requests (assumed client IP).
