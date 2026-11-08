# FND-11 — Access policy, test factories, test sessions

Status: done
Phase: 1   Team: Core
Depends on: FND-10
Size: M

## Goal
Every module authorises through one shared, tested set of helpers that implement the API-CONTRACT role matrix, and every test can create realistic rows and an authenticated session in one line — which is what lets slice teams work independently of each other from day one.

## In scope
- `apps/api/src/access/`: `getMembership`, `requireRole`, and `load<Entity>ForUser(userId, id, minRole)` for workspace, project, route, case, preset, version, deployment — each returning the entity and the caller's role, or throwing `HttpError` per the auth legend.
- `apps/api/src/testing/`: factories (`createUser`, `createWorkspace`, `createMember`, `createProject`, `createRoute` — with its default case, `createCase`, `createPreset`, `createVersion`, `createDeployment`), `createTestSession(userId) → { cookie, sessionId }`, `testApp()` (supertest bound to a test DB).
- The shared token-hash helper `hashSessionToken(token)` (HMAC-SHA-256 keyed by `SESSION_SECRET`).

## Out of scope
Session issuance, revocation and cookie writing (AUTH-01). Any endpoint handler.

## Contract
- `load…ForUser`: entity missing **or** caller not a member → `HttpError(404,'not_found')`; member below `minRole` → `HttpError(403,'forbidden')`. Role order viewer < editor < owner. Each loader resolves the entity and the membership in **one query**.
- `createTestSession` inserts a `sessions` row with `token_hash = hashSessionToken(token)` and returns `Cookie: mockbench_session=<token>`.
- Factories accept overrides, return the inserted row, and need no other factory to have run (they create parents on demand).

## Acceptance criteria
- [x] For each loader, a table test over {owner, editor, viewer, non-member, unauthenticated-user-with-valid-id} × {minRole viewer, editor, owner} yields: allowed when role ≥ min; `403 forbidden` for a lower-role member; `404 not_found` for a non-member and for a random UUID.
- [x] A loader issues exactly one SQL query (asserted with a query counter).
- [x] A request made with `createTestSession`'s cookie passes the FND-10 session middleware seed and sees `req.auth.userId`; a tampered cookie → `401 unauthenticated`; an expired session row → `401`.
- [x] `createRoute()` leaves the route with exactly one default case; `createProject()` works with no arguments and a second call in the same workspace yields a distinct slug.
- [x] `hashSessionToken` is deterministic for a given secret and differs when the secret differs; the raw token never appears in the database after `createTestSession`.
- [x] The role-permission list in API-CONTRACT §1.3 is encoded once (`permissions.ts`) and a test fails if an endpoint's registry `auth` level is absent from it.

### Implementation notes (clarifications recorded 2026-11-08; none changes the contract)
- **`db` is an explicit first argument:** `loadProjectForUser(db, userId, id, minRole)`. `createAccess(db)` binds every loader for modules that receive `db` once at `init`. Factories follow the same rule (`createRoute(db, overrides)`; `factories(db)` binds them), and `createTestSession(db, userId?, opts)`.
- **Loaders return `{ entity, role, workspaceId }`**, plus `projectId` for every project-scoped entity, so a handler can scope follow-up queries without another lookup. `loadVersionForUser` returns version METADATA only (no `snapshot`/`baked`): a handler that needs the snapshot reads it explicitly after authorising.
- **Malformed ids** (not a UUID) are `404 not_found` with **zero** queries, so a bad id can never become a Postgres 22P02 and a 500.
- **`getMembership`/`requireRole`/`requireWorkspaceRole`** exist for endpoints addressed by a workspace id in the body or query (`projects.create`, `projects.list`, `projects.import`): no membership is 404, too low is 403.
- **`permissions.ts`** encodes the matrix as `AUTH_POLICY` (auth level to minimum role). Tests assert it has exactly the contract's levels, that every registry endpoint's level is present, and that the registry follows API-CONTRACT 1.3 (every GET needs at most viewer; role-gated writes need editor or owner). The registry already satisfies that.
- **`hashSessionToken(token, secret)`** was delivered by FND-10 (`access/session-token.ts`); this unit adds its tests and re-exports it from the `access` barrel.
- **`testApp()`** returns `{ app, config, db, pool, url, logs, f, session(), as(session?), pathFor, assertContract, drop }`. `as()` is a supertest client that sends the cookie and, on non-GET, the `X-Mockbench-Client` CSRF header. `assertContract(endpointId, res)` checks a response against the registry (success schema, empty 204 body, or the error envelope with a documented code incl. the legend's implicit 401/403/404 and the global codes). FND-10's `__tests__/helpers.ts` now reuses `logSink`/`testConfig`/the session helper from `testing/` instead of duplicating them.
- **Mutation-checked:** making a low role return 404 instead of 403 fails 23 tests; making `roleAtLeast` too lenient fails 16. (A first version of the matrix test computed its expectations with the function under test; it now uses a literal table.)

## Tests
The matrix test, query-count test, session tests, factory tests.

## Open questions
- Resolved: yes, `assertContract` and `pathFor` are on `testApp()` (see Implementation notes).
