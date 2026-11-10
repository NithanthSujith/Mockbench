# Mockbench — status and how to resume

Last updated: 2026-11-10 (after merging PRs #1-#8). This file is the hand-off: read it first in a new session, then `docs/PLAN.md` for the full plan.

## Where we are

**Phase 1 (freeze) is complete and tagged `contracts-v1`** (commit `2e47a99`). All 14 FND units are `done`; CI is green on `main`. The HTTP contract (53 endpoints), the 11-table database schema, `schema-core`, the design tokens, the API/web skeletons and the Docker/LAN stack are frozen. A change to any of them goes through the main session and updates `docs/API-CONTRACT.md`, `docs/DESIGN.md` and the registry together.

**Phase 2 progress: eight units built, reviewed and MERGED to `main` (squash) on 2026-11-10; the combined `main` passes typecheck, lint, format, build and 550+ tests.** Units merged: RUN-01 (#1), AUTH-01 (#2), WS-01 (#3), BLD-01 (#4), PRJ-01 (#5), RUN-04 (#6), BLD-03 (#7), BLD-06 (#8). All their specs are `done`.

Things to remember about the merged units:
- **AUTH-01** left one shared-file change, now applied on `main`: `server.ts` starts the session sweeper at start-up and stops it on shutdown (tested: an expired session is deleted at start-up, a live one is kept).
- **RUN-04:** RUN-06 must pass `versions.label` as the 3rd argument of `compileVersion` and treat `CompileError` as a load failure that is not cached.
- **RUN-01:** RUN-02 should open its publish transaction at REPEATABLE READ (RUN-01 cannot set that itself).
- **BLD-03:** its deep-nesting test is now a real test (the `it.todo` was enabled once the shared fix landed).

Fixes made on `main` while the PRs were open: the 501-sweep and per-IP rate-limit tests use an empty module map; Docker images build on the native platform (`pnpm deploy` crashed under QEMU on arm64; arm64 Argon2 verified in the image); `invalid_cursor` declared on all paginated lists; pathologically nested request bodies answer 422 `depth_exceeded` instead of 500; the CI ownership job diffs against the CURRENT base branch (GitHub only refreshes a PR merge ref on a new push, so an old PR needs a rebase+push, not a re-run, to pick up workflow changes).

## Do these next, in order

1. **Launch the next Phase 2 wave** (one agent per unit, each in its own worktree on `team/<team>/<ID>`; see `docs/WORKFLOW.md`): AUTH-02 (endpoints, Argon2 via `@node-rs/argon2`, first-user bootstrap), WS-02 (members), PRJ-02 (presets API), BLD-02 (cases API), RUN-02 (publish + versions API; then RUN-03 deploy). They now have their dependencies on `main`.
2. Then **Phase 3** (screens and the publish loop), ending with XC-01, the first usable release. See `docs/PLAN.md` section 4 and the critical path in section 1.
3. The assistant merges PRs only when the owner says so explicitly (the permission system blocks an unrequested merge).

## Open decisions and notes (need the owner or the main session)

- **RUN-01:** a total baked-size cap per version is unspecified; the spec proposes 64 MiB with error `baked_too_large`. Not enforced yet beyond per-response limits. RUN-02 should open its publish transaction at REPEATABLE READ (RUN-01 cannot set that itself).
- **PRJ-01:** confirm that unknown keys in `settings` are rejected (strict). A `component_in_use` check only covers stored cases left with an unresolved `ref`.
- **Contract clarification done 2026-11-09:** `projects.list`, `versions.list`, `deployments.list` now declare `400 invalid_cursor` (API-CONTRACT 1.4 already promised it for all paginated lists).
- **schema-core:** `mockNodeZod` has no OpenAPI id, so api-contract works around a recursion problem when generating OpenAPI. Clean fix: give it an id inside schema-core (one line).
- **Known limitation:** `inferSchema` cannot preserve the order of integer-like keys (`"200"`), because JavaScript reorders them at parse time.
- **Node floor:** `apps/web/test-node-shim.mjs` exists only because this machine has Node 22.12 (jsdom needs 22.15+ APIs). Raising the floor in `scripts/check-node.mjs` and upgrading Node would remove it.
- **Timing-sensitive tests** can fail when the whole machine is busy (many test files in parallel, or agents sharing Postgres): FND-09 "lock is released when the holder is killed" (5 s deadline), FND-09 "bin/migrate exits within timeout + 2 s", and RUN-04 "100,000 matches in under 150 ms". All pass when run alone and in CI. If it recurs, loosen the slack or limit test parallelism.

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
| 2 Slice foundations | 14 | 8 merged: RUN-01, AUTH-01, WS-01, BLD-01, PRJ-01, RUN-04, BLD-03, BLD-06. 6 to go: AUTH-02, WS-02, PRJ-02, BLD-02, RUN-02, RUN-03 |
| 3 Screens and publish loop | 14 | 0 |
| 4 Depth | 11 | 0 |
| 5 Release | 3 | 0 |
