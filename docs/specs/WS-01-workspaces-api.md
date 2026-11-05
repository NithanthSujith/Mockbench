# WS-01 — Workspaces API

Status: approved
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
- [ ] `POST /workspaces {name:"Alps Chemicals"}` returns `201` with `slug:"alps-chemicals"`, `role:"owner"`; a second identical request returns `201` with slug `alps-chemicals-2`.
- [ ] `POST /workspaces {name:"X", slug:"alps-chemicals"}` returns `409 slug_taken` and creates no row, and `{slug:"Bad Slug"}` returns `422`.
- [ ] `GET /workspaces` returns only the caller's workspaces, each with the caller's own role, ordered by name; a user in none gets `{items:[],nextCursor:null}`.
- [ ] `GET /workspaces/:id` as non-member → `404 not_found`; as viewer → `200`.
- [ ] `PATCH /workspaces/:id {name}` as editor or viewer → `403`; as owner → `200`; `{slug:"x"}` → `422` with issue code `read_only`; `{}` → `200` with unchanged `updatedAt`.
- [ ] `DELETE /workspaces/:id` as owner with ≥1 project → `409 workspace_not_empty`, row kept; with none → `204` and its memberships are gone; as editor → `403`.
- [ ] Every endpoint is covered by a role-matrix test (owner/editor/viewer/non-member/unauthenticated) consistent with the legend.
- [ ] A response body for each endpoint parses with the registry's response schema (checked in tests via the `testApp()` helper).

## Tests
`testApp()` + factories; a role-matrix test per endpoint; slug-collision test.

## Open questions
- Whether deleting a workspace should be allowed to cascade projects behind a `?force=true` (assumed no in v1).
