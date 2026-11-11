# BLD-02 — Cases API

Status: done
Phase: 2   Team: Builder
Depends on: BLD-01
Size: M

## Goal
Response cases can be listed, created, read, edited, deleted and made the default, with the one-default-per-route invariant, name uniqueness, header rules and schema validation enforced.

## In scope
- Handlers for `cases.list`, `cases.create`, `cases.get`, `cases.update`, `cases.delete`, `cases.setDefault`.
- Validation: status whitelist, delay range, `validateCaseHeaders`, `schema-core` `validateSchema` with the **project's components** supplied.
- Atomic default switching; `case_name_taken` and `case_is_default` mapping.

## Out of scope
Screens (BLD-05+), duplicate-case endpoint (not in the contract), reordering.

## Contract
Endpoints per API-CONTRACT §3.7. Tables: `response_cases`, `routes`, `projects` (components read). Libraries: `@mockbench/schema-core`, `@mockbench/api-contract`.

## Acceptance criteria
- [x] `POST /routes/:id/cases {name:"Not found", statusCode:404}` → `201`, `isDefault:false`, schema is the empty-object envelope, `delayMs:null`.
- [x] `{name:"not found"}` on a route that already has `Not found` → `409 case_name_taken`, no row; the same name on another route succeeds.
- [x] `{isDefault:true}` on create makes it the default and the previous default `false` in the same transaction; at no point can a read see zero or two defaults (concurrent-read test).
- [x] `statusCode:418` → `422`; `delayMs:10001` → `422`; `delayMs:null` and `0` accepted and stored distinctly.
- [x] A header `Content-Length`, `X-Mock-Foo` or `Access-Control-Allow-Origin`, or a value with a newline → `422` with issue code `reserved_header` or the format code and the header name in `path`.
- [x] A `schema` over any limit or with `unknown_ref` (resolved against the project's components) → `422` with the schema-core issue code and the path into `schema`; a schema carrying unknown keys (`source`, `x-foo`) is accepted and returned unchanged.
- [x] `PATCH {schema:{…}}` replaces the schema wholesale; `{headers:{}}` clears headers; `{isDefault:true}` → `422 read_only`; `{}` is a no-op.
- [x] `POST /cases/:id/default` makes it default, demotes the previous one, returns `200`, and is idempotent when called twice.
- [x] `DELETE` of a non-default case → `204`; of the default case (including a route's only case) → `409 case_is_default`.
- [x] Viewer cannot create/edit/delete (`403`); non-member `404`; a case id from another workspace `404`.
- [x] A 600 KB schema is accepted; a 1 MiB + 1 body → `413`.

## Implementation notes (BLD-02)
- Code: `apps/api/src/modules/cases/{index,service}.ts`; tests: `cases.test.ts` (27 tests).
- **Atomicity:** create, update, delete and setDefault each take `select ... for update` on the parent route row, so default switches and creates on one route are serialised; demote-then-promote runs in one transaction (the partial unique index forbids two defaults, and readers only see committed states). Verified with a concurrent reader and a concurrent `setDefault` race test.
- **Name uniqueness:** pre-check on `lower(name)` for the friendly 409, with the unique-index violation (23505) mapped to the same `case_name_taken`.
- **Validation:** header issues are reported under `["headers", <name>]`, schema issues under `["schema", ...path]`. Refs resolve against the project's stored `components`.
- No drift from DESIGN.md or API-CONTRACT.md; no shared files changed.

## Tests
Role matrix, invariant tests (default always exactly one), header table, schema-limit table, race test for concurrent `setDefault` on two cases.

## Open questions
- Whether name matching should be Unicode-normalised (assumed: case-insensitive via `lower()` only, so `É`/`é` match per Postgres collation).
