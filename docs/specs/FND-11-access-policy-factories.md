# FND-11 — Access policy, test factories, test sessions

Status: approved
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
- [ ] For each loader, a table test over {owner, editor, viewer, non-member, unauthenticated-user-with-valid-id} × {minRole viewer, editor, owner} yields: allowed when role ≥ min; `403 forbidden` for a lower-role member; `404 not_found` for a non-member and for a random UUID.
- [ ] A loader issues exactly one SQL query (asserted with a query counter).
- [ ] A request made with `createTestSession`'s cookie passes the FND-10 session middleware seed and sees `req.auth.userId`; a tampered cookie → `401 unauthenticated`; an expired session row → `401`.
- [ ] `createRoute()` leaves the route with exactly one default case; `createProject()` works with no arguments and a second call in the same workspace yields a distinct slug.
- [ ] `hashSessionToken` is deterministic for a given secret and differs when the secret differs; the raw token never appears in the database after `createTestSession`.
- [ ] The role-permission list in API-CONTRACT §1.3 is encoded once (`permissions.ts`) and a test fails if an endpoint's registry `auth` level is absent from it.

## Tests
The matrix test, query-count test, session tests, factory tests.

## Open questions
- Whether `testApp()` should expose a helper to assert a response against the registry's response schema (assumed yes; lets teams verify the contract mechanically).
