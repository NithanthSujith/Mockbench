# Mockbench — status and how to resume

Last updated: 2026-11-12 (after merging PR #23). This file is the hand-off: read it first in a new session, then `docs/PLAN.md` for the full plan.

## Where we are

**Phase 1 (freeze) is complete and tagged `contracts-v1`.** All 14 FND units are `done`. The HTTP contract (53 endpoints), the 11-table schema, `schema-core`, the design system and the Docker/LAN stack are frozen; a change goes through the main session and updates `docs/API-CONTRACT.md`, `docs/DESIGN.md` and the registry together.

**Phase 2 (backend foundations) is done.** Merged to `main`: RUN-01, AUTH-01, WS-01, BLD-01, PRJ-01, RUN-04, BLD-03, BLD-06 (PRs #1-#8), then AUTH-02 (#12), WS-02 (#13), PRJ-02 (#10), BLD-02 (#11), RUN-02 (#9), RUN-03 (#19).

**Phase 3 (screens) has started.** Merged: AUTH-03 sign-in/register/welcome/create-workspace (#14, spec still "in progress": no Playwright guard cases, never run against the real API in a browser), PRJ-04 project list/new project/switcher (#15), BLD-04 project shell and route rail (#20), WS-03 workspace switcher (#22), RUN-09 versions screen with publish/deploy/rollback (#23). Small fixes: #16 #17 #18 #21 #25 #26. `/welcome` route added (#18).

**Open PRs, green apart from the expected `ownership` failure (they edit main-session files); waiting for the owner to say "merge #24 and #27":**
- **#24 BLD-05 route editor and cases.** Includes a fix to the shared `routes.test.tsx` (real route and case fixtures; `currentScreen` now picks the element ending in `Screen`/`NotFound`).
- **#27 RUN-06 version cache.** Includes the `app.ts` change: the cache is created in `app.ts` (`registerVersionCache`) and passed to `createDataPlaneRouter({ logger, cache })`; `cache.flush` emits the new `onCacheFlushRequested` hook, so the control plane never imports the data plane.

What does NOT exist yet: the data plane (`/mock/:slug/*` still answers 501 until RUN-05), request logging (RUN-07/08), the schema builder UI (BLD-07/09), live preview (BLD-11/12), members screen (WS-04), presets/settings/export screens. A published API cannot be called from outside yet.

## Do these next, in order

1. Merge #24 and #27 when the owner says so.
2. **RUN-05** data-plane handler (depends on RUN-04, RUN-06). Lowercase the slug before the cache lookup (decided), map `VersionLoadError` to 503, answer OPTIONS before matching. Then RUN-07 (log writer), RUN-08 (logs API and screen).
3. **BLD-07** schema builder tree UI, **BLD-09** JSON tab and inference, **BLD-11** live preview (they fill `SchemaEditorSlot` / `PreviewSlot` from BLD-05). Then WS-04 (members screen), PRJ-05+ (presets, settings, export), XC-01 (first usable release). See `docs/PLAN.md` section 4.
4. Write a spec for the total baked-size cap (64 MiB, `baked_too_large`, ADR 0017). Not implemented.
5. Add the Playwright cases that units skipped (`e2e/` is main-session owned): AUTH-03 guard/redirect, BLD-05 URL sync and collision, RUN-09 publish -> deploy -> rollback, and one end-to-end pass: define route, publish, call it.
6. The assistant merges PRs only when the owner says so explicitly; the permission system blocks unrequested merges and merges of PRs with a failing check unless the owner names them. Force-pushes also need explicit approval per branch.

## Decisions made (ADR 0017, 2026-11-11)

Last-owner race loser may get 409, 403 or 404; Argon2 stays m=19456 KiB, t=2, p=1 and the login limiter stays keyed on IP; a default `v<seq>` label that collides is a 409 `label_taken`; total baked size cap is 64 MiB (not built). Create-workspace dialog lives in `features/workspaces` (WS-03).

## Open decisions and notes

- **PRJ-01:** confirm unknown keys in `settings` are rejected (strict). Not yet ruled.
- **schema-core:** `mockNodeZod` has no OpenAPI id; clean fix is one line inside schema-core (main session only).
- **Known limitation:** `inferSchema` cannot preserve the order of integer-like keys (`"200"`).
- **Node floor:** `apps/web/test-node-shim.mjs` exists only because this machine has Node 22.12 (jsdom needs 22.15+).
- **RUN-09:** the LIVE pill shows `LIVE <label>`, so a custom label displays instead of `vN`. BLD-04 only counts routes in the rail (no counts for versions/logs). BLD-05 asks confirmation before deleting a case.
- **Timing-sensitive tests** can fail under machine load: FND-09 lock-kill and `bin/migrate` timeout tests. The RUN-04 match budget was raised to 300 ms (#16) after a CI run measured 166 ms.
- **Seeded edge case (RUN-03):** an active version with no `deployments` row creates one and fires the hook when re-deployed.

## How to resume (environment gotchas)

- **Docker Desktop stops across sessions.** Start `C:\Program Files\Docker\Docker\Docker Desktop.exe`, then `docker start mockbench-test-pg` (postgres:16-alpine, user/password `mock`, host port 55432, `TEST_DATABASE_URL` defaults to `postgres://mock:mock@127.0.0.1:55432/postgres`). Without it about 150 API tests fail with a clear message.
- **GitHub CLI:** `gh` is at `C:\Program Files\GitHub CLI`, logged in as `NithanthSujith`. The shared 5,000/hour quota was exhausted once; poll sparingly (`gh pr checks N --watch` is fine).
- **Remote:** `https://github.com/NithanthSujith/Mockbench.git`, branch `main`, tag `contracts-v1`. Squash merges, delete branch.
- **Stale CI merge ref:** a re-run of CI reuses the old merge ref. To pick up changes on `main`, merge `main` into the PR branch and push normally (no force needed), or rebase and force-push with the owner's approval.
- **Worktrees:** agents work in `.claude/worktrees/` (git-ignored). Fresh worktrees need `pnpm install --frozen-lockfile`. A usage-limit reset can delete an agent's worktree before it writes anything; the agent re-attaches one to its branch.
- **Usage limits:** the 5-hour limit hit again with 3 agents plus heavy test runs. Launch at most about 3-5 agents; resume cut-off agents by messaging them.
- **Shell quirks:** heredocs with apostrophes break the shell tool (use the file tool). `sleep` followed by another command is blocked; use `gh ... --watch` or run in the background.
- **Run the app:** `cp .env.example .env && docker compose up`, then http://localhost:8080 (or the LAN IP). UI only with fake data: `pnpm --filter @mockbench/web dev:mock`. Component gallery at `/_dev/ui` in dev.
- **Checks before any commit:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm contract:docs --check`. Run prettier from the repo root only.
- **No attribution lines** in commits or PRs (`.claude/settings.json`).

## Progress snapshot

| Phase | Units | Done |
| --- | --- | --- |
| 1 Freeze | 14 | 14 |
| 2 Slice foundations | 14 | all units listed above merged except RUN-06 (open PR #27) |
| 3 Screens and publish loop | 14 | merged: AUTH-03, PRJ-04, BLD-04, WS-03, RUN-09. Open PR: BLD-05 (#24). Not started: RUN-05, BLD-07, BLD-09, BLD-11, WS-04, RUN-08 and the rest |
| 4 Depth | 11 | 0 |
| 5 Release | 3 | 0 |
