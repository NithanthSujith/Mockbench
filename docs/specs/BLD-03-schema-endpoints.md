# BLD-03 — Stateless schema endpoints

Status: approved
Phase: 2   Team: Builder
Depends on: FND-11
Size: S

## Goal
`POST /schema/infer` and `POST /schema/preview` expose `schema-core` over HTTP for API consumers and tests, identically to what the browser computes locally.

## In scope
Handlers for `schema.infer` and `schema.preview`: thin wrappers over `inferSchema` and `generate`, with the contract's request/response shapes and size limit.

## Out of scope
Any database access, UI, caching, new inference rules.

## Contract
Endpoints per API-CONTRACT §3.8. Libraries: `@mockbench/schema-core`. No tables.

## Acceptance criteria
- [ ] `POST /schema/infer {sample:{"id":"8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f","z":null}}` → `200` with `schema.root.fields[0].node.type === "uuid"` and a `null_value` warning at `$.z`.
- [ ] A sample deeper than the depth limit → `422` with issue code `depth_exceeded`; a 1 MiB + 1 body → `413`.
- [ ] `POST /schema/preview` with the DESIGN worked-example envelope, `settings:{indexing:"local"}` and no `projectId` returns the DESIGN output byte-for-byte as `json` (2-space indent) and `generatorVersion:1`.
- [ ] The same request with `projectId` set yields different `uuid` values than without, and identical values on repeat.
- [ ] `settings:{mode:"random"}` is accepted and the response is not required to be stable.
- [ ] An invalid schema → `422` listing the validator issues; a schema over the leaf limit → `422 leaf_limit_exceeded` (never a 500 or a timeout).
- [ ] Requires a session: no cookie → `401`; any role works.
- [ ] The endpoint performs no database query (query counter = 0).

## Tests
Supertest against fixtures shared with schema-core's goldens (the response equals the golden).

## Open questions
- Whether `preview` should accept `projectId` + load the project's presets/components server-side (assumed no: stateless).
