# WS-01 — Workspaces API

Status: done
Phase: 2   Team: Workspaces
Depends on: FND-11
Size: M

## Goal
List, create, read, rename and delete workspaces with the role rules in API-CONTRACT §1.3.

## In scope
- Handlers for `workspaces.list`, `workspaces.create`, `workspaces.get`, `workspaces.update`, `workspaces.delete`.
- Slug derivation from `name` with numeric-suffix collision handling when no explicit slug is sent.
- `workspace_not_empty` guard on delete.

## Out of scope
Members (WS-02). Screens (WS-03, WS-04). Changing a slug.

## Contract
Endpoints per API-CONTRACT §3.3 (`workspaces.*`). Tables: `workspaces`, `workspace_members`, `projects` (count only). Creator becomes `owner` in the same transaction.

## Acceptance criteria
- [x] `POST /workspaces {name:"Alps Chemicals"}` returns `201` with `slug:"alps-chemicals"`, `role:"owner"`; a second identical request returns `201` with slug `alps-chemicals-2`.
- [x] `POST /workspaces {name:"X", slug:"alps-chemicals"}` returns `409 slug_taken` and creates no row, and `{slug:"Bad Slug"}` returns `422`.
- [x] `GET /workspaces` returns only the caller's workspaces, each with the caller's own role, ordered by name; a user in none gets `{items:[],nextCursor:null}`.
- [x] `GET /workspaces/:id` as non-member → `404 not_found`; as viewer → `200`.
- [x] `PATCH /workspaces/:id {name}` as editor or viewer → `403`; as owner → `200`; `{slug:"x"}` → `422` with issue code `read_only`; `{}` → `200` with unchanged `updatedAt`.
- [x] `DELETE /workspaces/:id` as owner with ≥1 project → `409 workspace_not_empty`, row kept; with none → `204` and its memberships are gone; as editor → `403`.
- [x] Every endpoint is covered by a role-matrix test (owner/editor/viewer/non-member/unauthenticated) consistent with the legend.
- [x] A response body for each endpoint parses with the registry's response schema (checked in tests via the `testApp()` helper).

## Tests
`testApp()` + factories; a role-matrix test per endpoint; slug-collision test.

## Implementation notes (WS-01)
- **Slug derivation** (`modules/workspaces/slug.ts`): accents folded, anything outside `a-z0-9` becomes a single hyphen, truncated to 40 characters. A name with nothing sluggable (e.g. `日本語`) becomes `workspace`; a one-character result gets `-workspace` appended so it always satisfies the 2-40 character rule. Collisions are numbered `-2`, `-3`, ... and trimmed so the suffix never pushes the slug past 40 characters.
- **Concurrent derived creates never return 409.** Reading the taken slugs and inserting are not atomic, so two requests can pick the same free slug. A lost race re-reads and retries (up to 30 times); the first try takes the first free slug, retries choose at random among the next few free ones so racers stop colliding. A test creates 16 same-named workspaces at once and expects 16 distinct 201s. Only an **explicit** slug that is taken answers `409 slug_taken`.
- **PATCH no-op:** `{}` and a rename to the identical name return `200` without writing, so `updatedAt` does not move.
- **Delete:** the project count check gives the friendly `409 workspace_not_empty`; a project created between the check and the delete is still caught through the `RESTRICT` foreign key (pg `23503`) and gets the same 409.
- **Ordering of `workspaces.list`:** case-insensitive by name, then id.
- **Shared-file dependency:** FND-10's `apps/api/src/__tests__/control-plane.test.ts` assumes the real modules bind nothing (it expects `GET /api/v1/workspaces` to be `501`). Once any module binds handlers, two tests there fail. They need to build their app with only the system module: `makeApp({ modules: { system: modules.system } })`. That file is Core-owned, so it is reported as a requested change rather than edited here; the other teams' units will hit the same thing.

## Open questions
- Whether deleting a workspace should be allowed to cascade projects behind a `?force=true` (assumed no in v1).
