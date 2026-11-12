# RUN-05 — Data-plane handler

Status: done
Phase: 3   Team: Runtime
Depends on: RUN-04, RUN-06
Size: L

## Goal
`ANY /mock/:slug/*` answers consumers exactly as API-CONTRACT §4 specifies — lifecycle, case selection, delay, diagnostic headers, CORS and `OPTIONS`, hardening, and the mock-server error format — touching the database zero times on the warm path.

## In scope
- The data-plane router (its own middleware stack and error handler), the lifecycle steps 1–8, response writing (`res.end(string)`, no ETag, no `X-Powered-By`), `HEAD`, `204`.
- CORS per `settings.cors`, `OPTIONS` before slug resolution, `Access-Control-Expose-Headers`, `X-Content-Type-Options: nosniff` + `Content-Security-Policy: sandbox` (D9).
- Mock-server errors (`project_not_found`, `project_not_published`, `route_not_found`, `case_not_found`, `mock_internal_error`) with `X-Mock-Error: true`; per-request generation in `random` mode; the log hook (`logger.record`) call after flush.

## Out of scope
The cache (RUN-06), the log writer (RUN-07), the rate cap (RUN-13).

## Contract
API-CONTRACT §4 in full. Consumes `VersionCache` (RUN-06) and `compileVersion` (RUN-04); calls `requestLog.record(entry)` (RUN-07, no-op until merged). No tables read on the warm path.

## Acceptance criteria
- [x] With a published demo project: `GET /mock/demo/users` → `200`, body equals the baked string byte-for-byte, `Content-Type: application/json; charset=utf-8`, and `X-Mock-Version`, `X-Mock-Route: GET /users`, `X-Mock-Case: <default name>` present.
- [x] After a first request warms the cache, **100 further requests issue zero SQL queries** (query counter fails the test on any query).
- [x] `X-Mock-Case: Not found` → the 404 case; `?__case=not found` → same; `X-Mock-Status: 500` → the first 500 case; `X-Mock-Case: nope` → `400 case_not_found` with `X-Mock-Error: true` and a body listing available cases; header present-but-wrong plus a valid `__case` still returns `400`.
- [x] Unknown slug → `404 project_not_found`; unpublished → `503 project_not_published`; unmatched path → `404 route_not_found` whose body lists the project's routes; each carries `X-Mock-Error: true`; a **mocked** 404 case does not.
- [x] A case with `delayMs: 300` takes ≥300 ms (fake clock); `delayMs: null` uses `defaultDelayMs`; `0` waits not at all even if the default is 500.
- [x] `OPTIONS /mock/anything/else` (unknown slug) → `204` with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` (echoing the request), `Access-Control-Max-Age: 600`; with a project whose `cors` is `"off"`, `OPTIONS` → `204` with **no** CORS headers and a normal response also has none.
- [x] Every response (including mock errors) carries `Access-Control-Expose-Headers` listing `X-Mock-*` and the case's custom headers when `cors` is `*`.
- [x] Every response carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`; a case that sets `Content-Type: text/html` is served with those headers and cannot execute script in the editor origin (Playwright check in XC-01).
- [x] `HEAD /mock/demo/users` → same status and headers, no body; a `204` case sends no body and no `Content-Type`.
- [x] `random` mode: two requests to a case with a `uuid` leaf return different bodies; the other modes return identical bytes.
- [x] The data-plane router does not run cookie parsing, session lookup, CSRF or JSON body parsing, and a request body (including invalid JSON) is ignored without error.
- [x] A throw inside generation or the handler yields `500 mock_internal_error` with `X-Mock-Error: true` (never the control-plane envelope) and the process stays up.
- [x] 1,000 concurrent requests to one route complete with no unhandled rejections and `X-Mock-Version` constant.

## Tests
Supertest against factory-built published projects; query-counter, fake-timer, CORS matrix and error-shape tests.

## Open questions
- `Vary: Origin` on CORS responses (assumed unnecessary because the value is always `*`).
- Behaviour for request `Expect: 100-continue` / very large bodies (assumed ignored; body size cap at nginx).
