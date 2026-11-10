# BLD-01 — Routes API

Status: done
Phase: 2   Team: Builder
Depends on: FND-11
Size: M

## Goal
Routes can be listed, created (with their first default case), read, edited, deleted and duplicated, with path grammar and collision rules enforced exactly as API-CONTRACT specifies.

## In scope
- Handlers for `routes.list`, `routes.create`, `routes.get`, `routes.update`, `routes.delete`, `routes.duplicate`.
- Path validation via `parseRoutePath`, collision detection on method + normalised path (pre-check **and** unique-violation mapping), `cases[]` summaries on every `Route`.
- Atomic creation of the default case `OK / 200 / empty-object schema`; derived path for duplicate.

## Out of scope
Cases CRUD (BLD-02), reordering (none in v1), screens (BLD-04/05).

## Contract
Endpoints per API-CONTRACT §3.6. Tables: `routes`, `response_cases` (create/copy only), `projects`. Validators from `@mockbench/api-contract` (`parseRoutePath`, `normalizePath`).

## Acceptance criteria
- [x] `POST /projects/:id/routes {method:"GET", path:"/users/:id"}` → `201` and the route has `cases:[{name:"OK",statusCode:200,isDefault:true}]`; both rows exist or neither does (kill the second insert in a test → no route row).
- [x] A second route `GET /users/:userId` (and `GET /Users/:x`) → `409 route_conflict` with `details:[{routeId:<existing>}]` and no row; `POST /users/:id` succeeds; the same path in another project succeeds.
- [x] Paths `/users/`, `//a`, `users`, `/a/:id/:id`, `/a*` → `422` with the issue code from `parseRoutePath`; method `OPTIONS` → `422`.
- [x] `PATCH {path:"/accounts/:id"}` → `200`; patching onto an existing route's path → `409 route_conflict`; `{description:null}` clears; `{method:null}` → `422`.
- [x] `GET /projects/:id/routes` returns every route ordered by creation with `cases` summaries sorted by `sortOrder`, `nextCursor:null`; 200 routes return in one response.
- [x] `DELETE /routes/:id` → `204` and its cases are gone; as viewer → `403`; non-member → `404`.
- [x] `POST /routes/:id/duplicate` with no body on `GET /users/:id` yields path `/users/:id/copy`; on `GET /invoices` yields `/invoices-copy`; calling it again yields `/invoices-copy-2`; every case is copied (schema, headers, delay) and exactly one is default.
- [x] `duplicate {path:"/other"}` copies to that path, and a colliding explicit path → `409`.
- [x] Two simultaneous creates of the same method+path → one `201`, one `409` (race test).
- [x] Every response parses with the registry schema.

## Implementation notes (BLD-01)
- Code: `apps/api/src/modules/routes/{index,service}.ts`; tests: `routes.test.ts` (35 tests, one or more per criterion plus the role matrix).
- **cases[] summaries** are one correlated subquery inside the route select, so a whole project list is ONE statement (asserted with a query counter). The outer id is qualified by hand: Drizzle renders a bare column in a single-table select as an unqualified "id", which silently binds to the inner table.
- **Race-safety:** the pre-check gives the friendly 409; the unique constraint `routes_project_method_normalized_unique` is the real guard, and its violation (23505) is mapped to the same 409 (details name the winning route). Verified with 8 rounds of simultaneous creates.
- **Clarification (strictly implied by API-CONTRACT 3.6):** on `routes.duplicate`, when only `method` is given and `path` is omitted, the source path itself is tried first (a different route because the method differs); if that is taken the derived `-copy`/`/copy` paths follow. With neither given, derivation starts at `-copy`/`/copy`. A derived path that would exceed the 200-character path limit is `422 validation_failed` (issue path `["path"]`), not a 500. The root path `/` derives `/copy`.
- **Authorisation:** `routes.list`/`create` load the project (viewer/editor), `get`/`update`/`delete`/`duplicate` load the route (viewer/editor/editor/editor) through the FND-11 loaders: non-members and unknown ids are 404, a viewer on a write is 403.

## Tests
Role matrix; path table; collision table including case-folding and param renaming; race test; transaction-rollback test.

## Open questions
- Whether `routes.create` should accept an initial case body to save a round trip (assumed no).
