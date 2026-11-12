# Mockbench — status and how to resume

Last updated: 2026-11-12 (after merging #24, #27, #29, #30; five PRs open). This file is the hand-off: read it first in a new session, then `docs/PLAN.md` for the full plan.

## Where we are

**Phase 1 (freeze) is complete and tagged `contracts-v1`.** All 14 FND units are `done`. The HTTP contract (53 endpoints), the 11-table schema, `schema-core`, the design system and the Docker/LAN stack are frozen; a change goes through the main session and updates `docs/API-CONTRACT.md`, `docs/DESIGN.md` and the registry together.

**Phase 2 (backend foundations) is done.** Merged to `main`: RUN-01, AUTH-01, WS-01, BLD-01, PRJ-01, RUN-04, BLD-03, BLD-06 (PRs #1-#8), then AUTH-02 (#12), WS-02 (#13), PRJ-02 (#10), BLD-02 (#11), RUN-02 (#9), RUN-03 (#19), RUN-06 version cache (#27).

**Phase 3 (screens) is under way.** Merged: AUTH-03 (#14, spec still "in progress": no Playwright guard cases, never run against the real API in a browser), PRJ-04 (#15), BLD-04 (#20), WS-03 (#22), RUN-09 (#23), BLD-05 route editor and cases (#24), WS-04 members screen (#29), BLD-07 schema builder tree (#30). Small fixes: #16 #17 #18 #21 #25 #26.

**`main` is red until #33 merges.** After #30 the BLD-07 test "renaming a key ... after the debounce" waited about 3.3 s of real time and hit the 5 s CI limit, and its leftover state failed 11 other tests in `SchemaBuilder.test.tsx`. #33 shortens it (400 ms debounce, 700 ms settle, 20 s timeout). It is my own PR and the owner must name it before it is merged.

**Open PRs, all built and reviewed by agents, none merged. The assistant merges only when the owner names the PR:**
- **#33** fix for the red `main` (see above). Merge first.
- **#31 RUN-05 data-plane handler.** `ANY /mock/:slug/*` per API-CONTRACT 4, with a no-op `requestLog.record` seam for RUN-07. I fixed two stale 501-stub assertions in main-session files on its branch: `scripts/lan-smoke.sh` and `e2e/lan.spec.ts` now expect `OPTIONS` to answer 204 with `Access-Control-Allow-Origin: *` and `Access-Control-Max-Age: 600`. It also edits two FND-10 stub tests in `apps/api/src/__tests__/`, so `ownership` fails as expected.
- **#32 PRJ-05 project settings screen.** Touches `apps/web/playwright.config.ts` (one line), so `ownership` fails as expected. Saving writes the project into `qk.project(id).detail`, which the BLD-11 preview reads.
- **#34 BLD-11 live preview.** `ResponsePreview` in `features/preview/`, generated locally through schema-core with a 150 ms debounce. Also edits `RouteEditorScreen.tsx` to keep an in-progress draft schema. Edits `slots.tsx` (PreviewSlot).
- **#35 BLD-09 JSON tab and inference.** `Builder | JSON` strip, "Infer from example", CodeMirror from existing dependencies, no new packages. Edits `slots.tsx` (SchemaEditorSlot), so expect a small merge conflict with #34.

What does NOT exist yet on `main`: the data plane (`/mock/:slug/*` still answers 501 until #31), request logging (RUN-07/08), settings screen (#32), live preview (#34), JSON tab (#35), presets/export screens. A published API cannot be called from outside until #31 merges.

## Do these next, in order

1. Owner says which PRs to merge. Suggested order: **#33, #31, #32, #34, #35**. After each, merge `main` into the next branch (a plain push, no force) and wait for CI. Resolve the `slots.tsx` conflict between #34 and #35.
2. **RUN-07** request-log writer (needs #31), then **RUN-08** logs API and screen. `versionId` is `null` in the log entry because `CompiledVersion` carries only the label: add the id to `CompiledVersion` or the cache.
3. **XC-01** first usable release (needs BLD-09, BLD-11, RUN-05 merged), then PRJ-06+ (presets, export). See `docs/PLAN.md` section 4.
4. Write a spec for the total baked-size cap (64 MiB, `baked_too_large`, ADR 0017). Not implemented.
5. Add the Playwright cases that units skipped (`e2e/` is main-session owned): AUTH-03 guard/redirect, BLD-05 URL sync and collision, BLD-09 infer flow, RUN-09 publish -> deploy -> rollback, and one end-to-end pass: define route, publish, call it.
6. The permission system blocks merges the owner has not named, merges of PRs with a failing check unless named, and `--admin` merges. Force-pushes need explicit approval per branch.

## Decisions pending (owner)

- **RUN-05 load failures:** a `VersionLoadError` returns `503 project_not_published` with a "could not be loaded right now" message, so a database outage reads as "not published". Add a dedicated code such as `mock_unavailable`? That is a contract amendment (API-CONTRACT, DESIGN, registry together).
- **RUN-05 `OPTIONS` with `cors: "off"`:** answered with a warm-cache lookup only to read the CORS setting. `OPTIONS` never requires the project to exist or be published. Record as an ADR?
- **BLD-07 read-only mode:** every edit control is disabled but the collapse twists stay usable. The spec says "no control is enabled". Disable the twists too?
- **BLD-11 seeded-mode copy:** the agent wrote "Values are drawn from stable pools seeded by the key and position." Keep or replace?
- **PRJ-01 unknown keys in `settings`:** the server already rejects them (`ProjectSettingsInput` is a `strictObject`). Record as ruled.

## Decisions made (ADR 0017, 2026-11-11)

Last-owner race loser may get 409, 403 or 404; Argon2 stays m=19456 KiB, t=2, p=1 and the login limiter stays keyed on IP; a default `v<seq>` label that collides is a 409 `label_taken`; total baked size cap is 64 MiB (not built). Create-workspace dialog lives in `features/workspaces` (WS-03). Data plane lowercases the slug before the cache lookup.

## Open decisions and notes

- **schema-core:** `mockNodeZod` has no OpenAPI id; clean fix is one line inside schema-core (main session only). `validateSchema` returns no node count on failure, so the preview says "more than 50,000 values" instead of a real N (needs a schema-core change).
- **Known limitation:** `inferSchema` cannot preserve the order of integer-like keys (`"200"`).
- **Node floor:** `apps/web/test-node-shim.mjs` exists only because this machine has Node 22.12 (jsdom needs 22.15+).
- **RUN-09:** the LIVE pill shows `LIVE <label>`, so a custom label displays instead of `vN`. BLD-04 only counts routes in the rail. BLD-05 asks confirmation before deleting a case.
- **UI kit:** there is no `danger` button variant; PRJ-05 uses `ghost` with `border-bad text-bad`. Adding one touches `components/ui/` (main session).
- **WS-04:** the spec's "settings stub link" was left out (no workspace settings route exists). The 360 px layout of the members table is untested in a browser.
- **Timing-sensitive tests** can fail under machine load: FND-09 lock-kill, `bin/migrate` timeout, schema-core `purity.test.ts` ESLint spawns, and `build.test.ts` timing. Keep real-time waits in new tests under about 1 s (CI limit 5 s). The RUN-04 match budget was raised to 300 ms (#16).
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
| 2 Slice foundations | 14 | all merged |
| 3 Screens and publish loop | 14 | merged: AUTH-03, PRJ-04, BLD-04, WS-03, RUN-09, BLD-05, WS-04, BLD-07. Open PRs: RUN-05 (#31), PRJ-05 (#32), BLD-11 (#34), BLD-09 (#35). Not started: RUN-07, RUN-08, XC-01 and the rest |
| 4 Depth | 11 | 0 |
| 5 Release | 3 | 0 |
