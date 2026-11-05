# RUN-11 — Demo seed

Status: approved
Phase: 4   Team: Runtime
Depends on: RUN-03, BLD-02, PRJ-01
Size: S

## Goal
On an empty database with `SEED_DEMO=true`, the api creates a published, live `demo` project at start-up so `curl /mock/demo/users` answers within seconds of `docker compose up` — and the first person to register becomes owner of the workspace that already holds it.

## In scope
- Start-up seeding behind an advisory lock: workspace `Default` (no members), project `demo`, three routes, published and deployed through the existing services (`created_by` null).
- The hand-off rule for the first user (D3 amendment, implemented in AUTH-02): register joins an **ownerless** workspace `default` as owner instead of creating a new one.
- Idempotence: seeds only when `users` and `workspaces` are both empty.

## Out of scope
Seeding real data, extra sample projects, a "reset demo" command.

## Contract
Env `SEED_DEMO`. Seeded content: project `demo`; `GET /users` (200 "List": array of 3 `user` objects), `GET /users/:id` (cases `Found` 200 default, `Not found` 404), `POST /users` (cases `Created` 201 default, `Validation failed` 422). Uses `buildVersionPayload`, the publish and deploy transactions, `hooks.onVersionDeployed`.

## Acceptance criteria
- [ ] On an empty DB with `SEED_DEMO=true`, after start `GET /mock/demo/users` → `200` with `X-Mock-Version: v1` and a three-element list; `GET /mock/demo/users/1` → `200`; `-H 'X-Mock-Case: Not found'` → `404`.
- [ ] Starting again (or with two api replicas starting together) creates nothing new: exactly one `demo` project, one `v1`, one deployment row.
- [ ] With `SEED_DEMO=false` nothing is seeded.
- [ ] After a user registers and later deletes the demo project, restarting does **not** re-seed (users/workspaces are no longer empty).
- [ ] The first registrant becomes `owner` of workspace `default` and sees the `demo` project; a second registrant sees no workspace (D3).
- [ ] Seeding failure (e.g. DB error mid-way) leaves no half-built project (single transaction) and does not stop the server from starting; it logs one error.
- [ ] Seed content passes the same publish validation as user content (no special-casing).

## Tests
Integration tests with a fresh DB: seed, double start, flag off, first-registration adoption, failure rollback.

## Open questions
- DESIGN says "three routes — a 200 list, a 200 detail, a 404"; this spec reads that as three routes with the detail route carrying the 404 case and a POST for completeness. Confirm the intended set.
