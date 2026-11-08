# PRJ-01 — Projects API

Status: done
Phase: 2   Team: Projects
Depends on: FND-11
Size: M

## Goal
Projects can be created, listed, fetched by id or slug, updated (including settings and components) and deleted, with slug rules enforced exactly as API-CONTRACT specifies.

## In scope
- Handlers for `projects.list`, `projects.create`, `projects.getBySlug`, `projects.get`, `projects.update`, `projects.delete`.
- Slug validation, reserved-slug rejection, global uniqueness, immutability; settings defaults and per-key merge; components validation against `schema-core`.
- Route/case counts and `activeVersion` in the `Project` response; cache eviction on delete via the FND-10 `onProjectDeleted` hook.

## Out of scope
Presets (PRJ-02), export/import (PRJ-06), screens, any route/case/version logic.

## Contract
Endpoints per API-CONTRACT §3.4. Tables: `projects`, `workspace_members`; reads `routes`, `response_cases`, `versions` for counts/active version. Hook: `onProjectDeleted(projectId)` provided by the Runtime team's cache (a no-op until RUN-06).

## Acceptance criteria
- [x] `POST /projects` with slug `billing-api` → `201`; a second with the same slug (even in another workspace) → `409 slug_taken` and the row count is unchanged.
- [x] Slugs `api`, `mock`, `health`, `static`, `assets`, `admin` → `422 slug_reserved`; `Billing`, `ab`, `a--b`, a 41-char slug → `422 validation_failed`; each creates no row.
- [x] Created project has default settings `{indexing:"local", mode:"deterministic", cors:"*", defaultDelayMs:0}`; `settings:{mode:"seeded"}` on create keeps the other three defaults.
- [x] `PATCH {settings:{mode:"random"}}` changes only `mode`; `{slug:"x"}` → `422` with issue code `read_only`; `{name:null}` → `422`; `{description:null}` clears it; `{}` leaves `updatedAt` unchanged.
- [x] `PATCH {components:{User:{type:"object",fields:[…]}}}` replaces the whole components object; a component with an invalid node → `422` with the schema-core issue path; removing a component still referenced by a stored case → `422` issue `component_in_use`.
- [x] `GET /projects?workspaceId=` without the parameter → `422`; as a non-member → `404`; returns `routeCount`, `caseCount`, `activeVersion` (null until deployed) and pages correctly: with 120 projects, `limit=50` yields 50, 50, 20 and `nextCursor:null` on the last.
- [x] `GET /projects/by-slug/billing-api` as a member → `200`; as a non-member or unknown slug → `404 not_found` (same body).
- [x] `DELETE` as editor → `403`; as owner → `204`, children are gone, and `onProjectDeleted` was called once with the id.
- [x] Creating as viewer → `403`; as editor → `201`.
- [x] Every response parses with the registry schema. *(Asserted with `assertContract` on every success path and on 404/409/422 paths. The `400 invalid_cursor` response is the one exception: see Drift.)*

## Tests
Role matrix, slug table tests (valid/invalid/reserved), pagination test with factories, merge/replace semantics tests, deletion hook spy.

## Implementation notes (PRJ-01)
- **Files:** `apps/api/src/modules/projects/{index,queries,components}.ts` and `projects.test.ts` (36 tests).
- **One statement per read.** `routeCount`, `caseCount` and the active version are scalar subqueries and a join in the same SELECT as the project, so a list of N projects is the same number of SQL statements as a list of 1 (asserted by a statement-count test).
- **Cursors** are base64url JSON `{t, i}` where `t` is the creation time at **microsecond** precision (formatted in SQL, because JS `Date` truncates to milliseconds and would skip or repeat rows) and `i` the id; order is `(created_at, id)` ascending. Projects created in the same instant page cleanly. Anything else is `400 invalid_cursor`.
- **`activeVersion.deployedAt`** is the latest `deployments.created_at` for the active version, falling back to the version's own `created_at` when no deployment row exists.
- **Components.** A replacement is rejected with `422 validation_failed` when (a) any component fails `validateSchema` against the whole new set (issue path is `["components", <name>, ...]`, code is schema-core's, e.g. `enum_empty`, `ref_cycle`), or (b) a stored case would be left with an `unknown_ref` (issue code `component_in_use`, path `["components", <name>]`, message names the route and case). Other ways an edit could break a stored case (for example a deeper component pushing a case over a limit) are **not** blocked here: publish validates every case anyway (RUN-01).
- **`{}` PATCH** writes nothing, so `updatedAt` does not move.
- **`projects.getBySlug`** returns the identical 404 for an unknown slug, a malformed slug and a non-member.
- **`projects.delete`** relies on ON DELETE CASCADE for children and emits `hooks.onProjectDeleted` after the delete (never for a 404/403).

## Drift
- **Contract gap (change requested, shared file):** API-CONTRACT 1.4 says a malformed cursor returns `400 invalid_cursor` for every paginated list, but only `requests.list` declares it in the registry. `projects.list` (and, by the same rule, `versions.list` and `deployments.list`) need `{ status: 400, code: 'invalid_cursor' }` in their `errors`, and the `Errors` column of their rows in API-CONTRACT 3.x. `assertContract` correctly rejects the undeclared code today, so this unit's cursor test does not assert the contract for that one response.

## Open questions
- Settings keys unknown to this version (a newer client) → rejected (strict, as the registry schema does); still to be confirmed by the owner.
