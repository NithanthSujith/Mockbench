# BLD-01 — Routes API

Status: approved
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
- [ ] `POST /projects/:id/routes {method:"GET", path:"/users/:id"}` → `201` and the route has `cases:[{name:"OK",statusCode:200,isDefault:true}]`; both rows exist or neither does (kill the second insert in a test → no route row).
- [ ] A second route `GET /users/:userId` (and `GET /Users/:x`) → `409 route_conflict` with `details:[{routeId:<existing>}]` and no row; `POST /users/:id` succeeds; the same path in another project succeeds.
- [ ] Paths `/users/`, `//a`, `users`, `/a/:id/:id`, `/a*` → `422` with the issue code from `parseRoutePath`; method `OPTIONS` → `422`.
- [ ] `PATCH {path:"/accounts/:id"}` → `200`; patching onto an existing route's path → `409 route_conflict`; `{description:null}` clears; `{method:null}` → `422`.
- [ ] `GET /projects/:id/routes` returns every route ordered by creation with `cases` summaries sorted by `sortOrder`, `nextCursor:null`; 200 routes return in one response.
- [ ] `DELETE /routes/:id` → `204` and its cases are gone; as viewer → `403`; non-member → `404`.
- [ ] `POST /routes/:id/duplicate` with no body on `GET /users/:id` yields path `/users/:id/copy`; on `GET /invoices` yields `/invoices-copy`; calling it again yields `/invoices-copy-2`; every case is copied (schema, headers, delay) and exactly one is default.
- [ ] `duplicate {path:"/other"}` copies to that path, and a colliding explicit path → `409`.
- [ ] Two simultaneous creates of the same method+path → one `201`, one `409` (race test).
- [ ] Every response parses with the registry schema.

## Tests
Role matrix; path table; collision table including case-folding and param renaming; race test; transaction-rollback test.

## Open questions
- Whether `routes.create` should accept an initial case body to save a round trip (assumed no).
