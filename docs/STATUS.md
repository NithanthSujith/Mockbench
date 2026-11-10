# Mockbench — status and how to resume

Last updated: 2026-11-10. This file is the hand-off: read it first in a new session, then `docs/PLAN.md` for the full plan.

## Where we are

**Phase 1 (freeze) is complete and tagged `contracts-v1`** (commit `2e47a99`). All 14 FND units are `done`; CI is green on `main`. The HTTP contract (53 endpoints), the 11-table database schema, `schema-core`, the design tokens, the API/web skeletons and the Docker/LAN stack are frozen. A change to any of them goes through the main session and updates `docs/API-CONTRACT.md`, `docs/DESIGN.md` and the registry together.

**Phase 2: eight units built, eight PRs open, none merged.** Seven have every CI job green; #8 (BLD-06) was being fixed when this was written. Merging is left to the owner (the permission system blocks the assistant from merging).

| PR | Unit | Team | Branch | Notes |
| --- | --- | --- | --- | --- |
| #1 | RUN-01 snapshot + bake service | Runtime | `team/runtime/RUN-01` | 11/11 criteria, 20 tests. CI green |
| #2 | AUTH-01 session core | Auth | `team/auth/AUTH-01` | 8/8, 35 tests. CI green. Needs a `server.ts` wiring change after merge (below) |
| #3 | WS-01 workspaces API | Workspaces | `team/workspaces/WS-01` | 8/8, 32 tests. CI green |
| #4 | BLD-01 routes API | Builder | `team/builder/BLD-01` | 9/9, 35 tests. CI green |
| #5 | PRJ-01 projects API | Projects | `team/projects/PRJ-01` | 10/10, 36 tests. CI green |
| #6 | RUN-04 compiled version + matcher | Runtime | `team/runtime/RUN-04` | 11/11, 40 tests. CI green after a timing-test fix. RUN-06 must pass `versions.label` as the 3rd arg of `compileVersion` and treat `CompileError` as a non-cached load failure |
| #7 | BLD-03 stateless schema endpoints | Builder | `team/builder/BLD-03` | 8/8, 26 tests. CI green. Enable its `it.todo` for deep nesting (fixed on main) |
| #8 | BLD-06 schema builder store (headless) | Builder | `team/builder/BLD-06` | One CI job failed after the first push; the agent pushed a fix (`bdcbd7f`) and was re-checking. Verify CI before merging |

Recommended merge order: #1, #2, #3, #4, #5, #6, #7, #8 (Squash and merge). They touch disjoint directories. After merging, flip each spec's `Status:` to `done` (the PR branches leave it `in progress`/`done` per their own report; check `docs/specs/<ID>-*.md`).

Fixes made on `main` while the PRs were open (all PR branches were rebased onto them): the 501-sweep and per-IP rate-limit tests now use an empty module map (`6c1fb2f`, `1f0a948`); the Docker images build on the native platform because `pnpm deploy` crashed under QEMU on arm64 (`1f0a948`; arm64 Argon2 verified inside the image); `invalid_cursor` declared on all paginated lists (`29e0279`); pathologically nested request bodies now answer 422 `depth_exceeded` instead of 500 (`43e6892`).

## Do these next, in order

1. **Merge PRs #1 to #8** on GitHub (check #8 is green first) (or add a Bash allow rule for `gh pr merge` and ask the assistant to merge reviewed PRs).
2. **Apply the AUTH-01 wiring** in `apps/api/src/server.ts` (exact diff is in PR #2's body): import `createSessionService` and `startSessionSweeper` from `./modules/auth/sessions`, start the sweeper after `createApp`, stop it in the shutdown path before the pool closes. Main session only; not done yet because the code is not on `main`.
3. **Launch the next wave** (one agent per unit, each in its own worktree on `team/<team>/<ID>`; see `docs/WORKFLOW.md`). These need the merged PRs: AUTH-02 (after AUTH-01), WS-02 (after WS-01), PRJ-02 (after PRJ-01), BLD-02 (after BLD-01), RUN-02 (after RUN-01), then RUN-03 (after RUN-02). Then Phase 3 (screens and the publish loop), ending with XC-01, the first usable release.
4. Keep an eye on the critical path in `docs/PLAN.md` section 1.

## Open decisions and notes (need the owner or the main session)

- **RUN-01:** a total baked-size cap per version is unspecified; the spec proposes 64 MiB with error `baked_too_large`. Not enforced yet beyond per-response limits. RUN-02 should open its publish transaction at REPEATABLE READ (RUN-01 cannot set that itself).
- **PRJ-01:** confirm that unknown keys in `settings` are rejected (strict). A `component_in_use` check only covers stored cases left with an unresolved `ref`.
- **Contract clarification done 2026-11-09:** `projects.list`, `versions.list`, `deployments.list` now declare `400 invalid_cursor` (API-CONTRACT 1.4 already promised it for all paginated lists).
- **schema-core:** `mockNodeZod` has no OpenAPI id, so api-contract works around a recursion problem when generating OpenAPI. Clean fix: give it an id inside schema-core (one line).
- **Known limitation:** `inferSchema` cannot preserve the order of integer-like keys (`"200"`), because JavaScript reorders them at parse time.
- **Node floor:** `apps/web/test-node-shim.mjs` exists only because this machine has Node 22.12 (jsdom needs 22.15+ APIs). Raising the floor in `scripts/check-node.mjs` and upgrading Node would remove it.
- **FND-09 flaky test:** "lock is released when the holder is killed" has a 5-second deadline and can fail when many agents share the test Postgres. It passes alone and in CI.

## How to resume (environment gotchas)

- **Docker Desktop stops when the machine restarts.** Start it (`C:\Program Files\Docker\Docker\Docker Desktop.exe`), then `docker start mockbench-test-pg`. That container (postgres:16-alpine, user/password `mock`, host port 55432) is what the API/DB tests use via `TEST_DATABASE_URL` (default `postgres://mock:mock@127.0.0.1:55432/postgres`). Without it, about 150 API tests fail with a clear "start Postgres" message.
- **GitHub CLI:** `gh` is installed at `C:\Program Files\GitHub CLI` but is not on this shell's PATH; add it. It is logged in as `NithanthSujith`. The shared API quota (5,000/hour) was nearly exhausted once by polling: poll sparingly.
- **Git remote:** `https://github.com/NithanthSujith/Mockbench.git`, branch `main`, tag `contracts-v1`.
- **Shell quirk:** the assistant's shell tool breaks on heredocs that contain apostrophes. Write such files with the file tool, or avoid apostrophes.
- **Usage limits:** parallel agents burn the 5-hour limit quickly (hit three times). Launch at most about five at once, and resume cut-off agents by messaging them (their work is saved in `.claude/worktrees/`, git-ignored).
- **Run the app:** `pnpm --filter @mockbench/web dev:mock` (localhost only, fake data), or `docker compose up` after `cp .env.example .env` (README has the LAN steps). The real login screens arrive with AUTH-03 (Phase 3), so the UI shows stubs for now.
- **Checks before any commit:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm contract:docs --check`. Run prettier from the repo root only.

## Progress snapshot

| Phase | Units | Done |
| --- | --- | --- |
| 1 Freeze | 14 | 14 |
| 2 Slice foundations | 14 | 8 built (PRs open): RUN-01, AUTH-01, WS-01, BLD-01, PRJ-01, RUN-04, BLD-03, BLD-06. 6 to go: AUTH-02, WS-02, PRJ-02, BLD-02, RUN-02, RUN-03 |
| 3 Screens and publish loop | 14 | 0 |
| 4 Depth | 11 | 0 |
| 5 Release | 3 | 0 |
