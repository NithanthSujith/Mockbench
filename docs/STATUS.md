# Mockbench — status and how to resume

Last updated: 2026-11-19 (after #54-#58; every planned unit is merged; REL-02 awaits its first tag). This file is the hand-off: read it first in a new session, then `docs/PLAN.md` for the full plan.

## Where we are

**Phase 1 (freeze) is complete and tagged `contracts-v1`.** All 14 FND units are `done`. The HTTP contract, the 11-table schema, `schema-core`, the design system and the Docker/LAN stack are frozen; a change goes through the main session and updates `docs/API-CONTRACT.md`, `docs/DESIGN.md` and the registry together. One amendment since the freeze: the data-plane error `503 mock_unavailable` (ADR 0018, #40), seven mock-error codes, still 53 endpoints.

**Phase 2 (backend foundations) is done.** All units merged (PRs #1-#13, #19, #27, #31, #37, #38).

**Phase 3 (screens and the publish loop) is done in `main`.** Merged: AUTH-03 (#14), PRJ-04 (#15), BLD-04 (#20), WS-03 (#22), RUN-09 (#23), BLD-05 (#24), WS-04 (#29), BLD-07 (#30), RUN-05 data plane (#31), PRJ-05 settings (#32), BLD-11 live preview (#34), BLD-09 JSON tab and inference (#35), RUN-07 log writer (#37), RUN-08 logs API and screen (#38), XC-01 end-to-end suite (#39). Fixes: #16 #17 #18 #21 #25 #26 #33 #36 (two attempts at a flaky BLD-07 test; the second sets the name with one change event, never type char by char in tests) and #40.

**The first usable release loop works end to end and CI proves it:** register, create a project and route, build a schema (Builder or JSON tab, with inference), preview, publish, deploy, call the mock from outside the browser, read the request log. The Playwright `e2e` job runs it against the real `docker compose` stack at `mockbench.lan.test` in about 2 minutes.

**Merged on 2026-11-14 (owner named them):** #41-#44 (RUN-11 demo seed, BLD-05 case bar fix, log filters in the URL with `zod` in `apps/web`, BLD-12 Try-it panel), then #45 control-plane rate limit 600/min (ADR 0019), #46 RUN-13 data-plane rate cap (`MOCK_RATE_LIMIT`, wired in `app.ts`), #49 RUN-10 version diff, #47 PRJ-03 presets screen and #48 BLD-10 advanced attributes and components. #41, #44 and #46 merged with a failing `ownership` check, expected because they edit main-session files. Flaky tests that needed a re-run: `bin/migrate` timing (#43) and FND-09 lock-kill (#49). Imported presets are created disabled (follow-up PR to #47). Then #51 REL-01 README/docs/examples, #52 PRJ-06 export and import, #53 BLD-08 drag reorder and virtualized rows.

**Merged on 2026-11-18 (owner named them):**
- #54: spec status sync.
- #55: ADR 0020 release rulings, which drops RUN-12 and `CACHE_FANOUT` and adds the AUTH-04 spec.
- #56: REL-03 contribution scaffolding. It adds Changesets, the `pr-checks.yml` title and changeset checks, CodeQL and `contributing-smoke`. It also fixes `pnpm dev`, which had never started the API: `server.ts` now exports `run(env)`.
- #57: the REL-02 release workflow `docker.yml`. The web image now runs as non-root (`nginx-unprivileged`). The owner merged it in the web UI, because `gh` lacks the `workflow` scope.
- #58: AUTH-04 `dist/reset-password.js`. It went in on branch `main-session/AUTH-04`, because the spec puts most of its files with the main session.

## Do these next, in order

1. **REL-02 dry run:** push `v0.1.0-rc.1`, but only with the owner's explicit go-ahead, because it publishes to GHCR and creates a GitHub prerelease. Then tick REL-02's criteria; they all need a tag. GHCR packages may start private; the owner sets them public once. The criterion allowing only `contents: read` drifts: the release job needs `contents: write`, as recorded in the spec.
2. REL-03: the owner checks that the issue forms render under *New issue*, then ticks the last criterion.
3. (In review) **RUN-14**, the total baked-size cap: 64 MiB, `422 baked_too_large`, ADR 0017 and ADR 0021. It adds an error to `versions.publish` (still 53 endpoints). Branch `main-session/RUN-14`.
4. (Done 2026-11-18) XC-01: both deferred checks are live; spec ticked, `Depends on` left as written.
5. Remaining Playwright backlog: BLD-09 infer flow, RUN-08 log polling, WS-04 members against the real API (Testing Library covers them today).
6. The permission system blocks merges the owner has not named, merges of PRs with a failing check unless named, and `--admin` merges. Force-pushes need explicit approval per branch.

## Decisions pending (owner)

- **Rate limit:** resolved 2026-11-14: control-plane default raised from 100 to 600 requests a minute per session (ADR 0019). Sign-in stays 10 a minute per IP.
- **REL-02 tag:** approval to push `v0.1.0-rc.1`.
- **RUN-11 "three routes":** merged as `GET /users`, `GET /users/:id` (with the 404 `Not found` case) and `POST /users`; the owner has not explicitly confirmed this reading.

## Decisions made

- **ADR 0020 (2026-11-18):**
  - Changesets cover anything shipped: api, web, schema-core and api-contract in one fixed group. Tests, docs and fixtures are exempt, and so is any PR with the `no-changeset` label.
  - The commit-lint check runs on the PR title only.
  - RUN-12 is dropped, because v1 is single-instance.
  - The CLI password reset became AUTH-04.

- **PRJ-03, BLD-10 and RUN-13 conventions (2026-11-14, accepted by merge):** imported presets are created disabled; preset rule values are read as JSON if they parse, otherwise as a plain string (no ADR yet); "Save as component" is copy-only and a component rename the server refuses keeps the old name too; RUN-13 logs a rate-limited request in `request_logs` only when the project is already warm in the cache.
- **ADR 0017 (2026-11-11):** last-owner race loser may get 409, 403 or 404; Argon2 stays m=19456 KiB, t=2, p=1 and the login limiter stays keyed on IP; a default `v<seq>` label that collides is a 409 `label_taken`; total baked size cap is 64 MiB (not built). Create-workspace dialog lives in `features/workspaces`. Data plane lowercases the slug before the cache lookup.
- **ADR 0018 (2026-11-12):** a version that cannot be loaded answers `503 mock_unavailable` (`project_not_published` now means only "no active version"); `OPTIONS` never needs the project to exist and reads `settings.cors` only from a warm cache; read-only builder keeps the collapse twists usable ("no edit control"); the seeded-mode preview sentence stays "Values are drawn from stable pools seeded by the key and position."; retention numbers are not exposed on `system.instance`.
- **PRJ-01 unknown keys in `settings`:** rejected by the server (`ProjectSettingsInput` is a `strictObject`). Ruled.

## Open decisions and notes

- **schema-core:** `mockNodeZod` has no OpenAPI id; clean fix is one line inside schema-core (main session only). `validateSchema` returns no node count on failure, so the preview says "more than 50,000 values" instead of a real N (needs a schema-core change).
- **Known limitation:** `inferSchema` cannot preserve the order of integer-like keys (`"200"`).
- **Node floor:** `apps/web/test-node-shim.mjs` exists only because this machine has Node 22.12 (jsdom needs 22.15+).
- **Golden-loop wording (XC-01):** UUIDs are v5 over the project id, so a new project's preview cannot equal the committed golden; the suite masks UUIDs. The preview is pretty-printed and the data plane serves compact JSON; the suite compares `JSON.stringify(JSON.parse(preview))`.
- **e2e:** `e2e/` is not covered by the root typecheck (the Playwright `.mjs` entry has no types). Playwright's request client ignores Chromium's `--host-resolver-rules`, so `e2e/support/lan.ts` shims Node's `dns.lookup`. `pnpm e2e` uses `E2E_PORT` (default 8080; use 18080 when something else holds 8080).
- **RUN-09:** the LIVE pill shows `LIVE <label>`. BLD-04 only counts routes in the rail. BLD-05 asks confirmation before deleting a case.
- **UI kit:** there is no `danger` button variant; PRJ-05 uses `ghost` with `border-bad text-bad`. Adding one touches `components/ui/` (main session).
- **WS-04:** the spec's "settings stub link" was left out (no workspace settings route). The 360 px members table is untested in a browser.
- **Timing-sensitive tests** fail under machine load and pass alone: FND-09 lock-kill, `bin/migrate` unreachable-URL timing, schema-core `purity.test.ts` ESLint spawns, `build.test.ts` timing, and when running the whole web suite in parallel several 5 s timeouts. CI is fine. Keep real-time waits in new tests under about 1 s and use `--maxWorkers=2` locally if the web suite times out.
- **Seeded edge case (RUN-03):** an active version with no `deployments` row creates one and fires the hook when re-deployed.
- **RUN-07:** `request_logs.matched_route_id/matched_case_id` are null for every mock error, including `case_not_found`. The writer is the authoritative redactor; the router's own list lacks `x-auth-token`.

## How to resume (environment gotchas)

- **Docker Desktop stops across sessions.** Start `C:\Program Files\Docker\Docker\Docker Desktop.exe`, then `docker start mockbench-test-pg` (postgres:16-alpine, user/password `mock`, host port 55432, `TEST_DATABASE_URL` defaults to `postgres://mock:mock@127.0.0.1:55432/postgres`). Without it about 150 API tests fail with a clear message.
- **GitHub CLI:** `gh` is at `C:\Program Files\GitHub CLI`, logged in as `NithanthSujith`. Its token has no `workflow` scope, so it cannot merge a PR that changes `.github/workflows/`. The owner merges those in the web UI or runs `gh auth refresh -s workflow`. The shared 5,000/hour quota was exhausted once; poll sparingly (`gh pr checks N --watch` is fine).
- **Remote:** `https://github.com/NithanthSujith/Mockbench.git`, branch `main`, tag `contracts-v1`. Squash merges, delete branch.
- **Stale CI merge ref:** a re-run of CI reuses the old merge ref. To pick up changes on `main`, merge `main` into the PR branch and push normally (no force needed), or rebase and force-push with the owner's approval.
- **Worktrees:** agents work in `.claude/worktrees/` (git-ignored). Fresh worktrees need `pnpm install --frozen-lockfile`. A usage-limit reset can delete an agent's worktree before it writes anything; the agent re-attaches one to its branch.
- **Usage limits:** the 5-hour limit hit again with 3 agents plus heavy test runs. Launch at most about 3-5 agents; resume cut-off agents by messaging them.
- **Shell quirks:** heredocs with apostrophes break the shell tool (use the file tool). `sleep` followed by another command is blocked; use `gh ... --watch` or run in the background.
- **Run the app:** `cp .env.example .env && docker compose up`, then http://localhost:8080 (or the LAN IP). UI only with fake data: `pnpm --filter @mockbench/web dev:mock`. Component gallery at `/_dev/ui` in dev.
- **PR checks (since #56):** the PR title must be a conventional commit. A change to a shipped package needs a `.changeset/*.md` (run `pnpm changeset`) or the `no-changeset` label.
- **Checks before any commit:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm contract:docs --check`. Run prettier from the repo root only.
- **No attribution lines** in commits or PRs (`.claude/settings.json`).

## Progress snapshot

| Phase | Units | Done |
| --- | --- | --- |
| 1 Freeze | 14 | 14 |
| 2 Slice foundations | 14 | 14 |
| 3 Screens and publish loop | 14 | 14 (all merged, including BLD-12 #44) |
| 4 Depth | 11 (RUN-12 dropped, ADR 0020; RUN-14 added, ADR 0021) | 10. RUN-14 in review |
| 5 Release | 4 (AUTH-04 added) | 3 done (REL-01, REL-03, AUTH-04); REL-02 merged, waiting on its first tag |
