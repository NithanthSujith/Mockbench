# PRJ-01 — Projects API

Status: approved
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
- [ ] `POST /projects` with slug `billing-api` → `201`; a second with the same slug (even in another workspace) → `409 slug_taken` and the row count is unchanged.
- [ ] Slugs `api`, `mock`, `health`, `static`, `assets`, `admin` → `422 slug_reserved`; `Billing`, `ab`, `a--b`, a 41-char slug → `422 validation_failed`; each creates no row.
- [ ] Created project has default settings `{indexing:"local", mode:"deterministic", cors:"*", defaultDelayMs:0}`; `settings:{mode:"seeded"}` on create keeps the other three defaults.
- [ ] `PATCH {settings:{mode:"random"}}` changes only `mode`; `{slug:"x"}` → `422` with issue code `read_only`; `{name:null}` → `422`; `{description:null}` clears it; `{}` leaves `updatedAt` unchanged.
- [ ] `PATCH {components:{User:{type:"object",fields:[…]}}}` replaces the whole components object; a component with an invalid node → `422` with the schema-core issue path; removing a component still referenced by a stored case → `422` issue `component_in_use`.
- [ ] `GET /projects?workspaceId=` without the parameter → `422`; as a non-member → `404`; returns `routeCount`, `caseCount`, `activeVersion` (null until deployed) and pages correctly: with 120 projects, `limit=50` yields 50, 50, 20 and `nextCursor:null` on the last.
- [ ] `GET /projects/by-slug/billing-api` as a member → `200`; as a non-member or unknown slug → `404 not_found` (same body).
- [ ] `DELETE` as editor → `403`; as owner → `204`, children are gone, and `onProjectDeleted` was called once with the id.
- [ ] Creating as viewer → `403`; as editor → `201`.
- [ ] Every response parses with the registry schema.

## Tests
Role matrix, slug table tests (valid/invalid/reserved), pagination test with factories, merge/replace semantics tests, deletion hook spy.

## Open questions
- Settings keys unknown to this version (a newer client) → rejected (strict) as assumed; confirm.
