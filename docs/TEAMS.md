# Mockbench — parallel work structure

Teams are **vertical slices**: each owns its backend endpoints *and* its frontend screens, so the only contract between teams is the frozen HTTP API (`docs/API-CONTRACT.md`) plus the frozen shared packages. A team never waits on a handoff from another team; it codes against the contract and stubs.

**Nothing below starts until Phase 1 is done and approved** (see `docs/PLAN.md`). Phase 1 is executed by **Core** — the main session — and is deliberately not parallel work for the slice teams.

## 1. Who can actually run at the same time

Honest version: **three teams are genuinely independent; two are staged.**

| Team | Starts | Truly independent? | What limits it |
| --- | --- | --- | --- |
| **Auth** | Day 1 of Phase 2 | **Yes** | Nothing. Owns the sessions logic outright; every other team uses a test-session helper until AUTH-01 merges |
| **Workspaces** | Day 1 | **Yes** | Needs a session to exist → uses the Phase-1 test-session helper |
| **Projects** | Day 1 | **Yes** | Same. Needs a workspace row → Phase-1 factories |
| **Builder** | Day 1 for its *front half* (routes/cases/schema APIs, headless builder store) | **Staged** | Its screens live inside the project shell, which needs `projects.getBySlug` (Projects, PRJ-01) and a working sign-in (Auth, AUTH-03) to be verified against a real server. Until then it develops against MSW fixtures |
| **Runtime** | Day 1 for its *front half* (snapshot/bake service, compiled-version matcher) | **Staged** | Publish bakes the draft that **Builder** writes (routes/cases rows) — factories stand in. The Versions screen hangs off the project shell (BLD-04). The first end-to-end loop (define → publish → deploy → `curl`) needs Builder + Runtime + Projects + Auth all merged |

Consequences, stated plainly:

- Auth + Workspaces + Projects are small (≈13 units, mostly S/M). They will finish first and then are the natural reviewers/integrators.
- **Builder is the long pole** (12 units, one of them the schema builder, the project's riskiest component). **Runtime is second.** Start both front halves on day one rather than waiting.
- Auth gates every *screen* (nothing renders behind the route guard until AUTH-03), but it does **not** gate other teams' *backend* work, because the sessions table, cookie convention and test helper are frozen in Phase 1.
- Projects gates Builder's and Runtime's *screens*, not their APIs.
- The first usable release (end of Phase 3) is an integration event owned by Core (XC-01), not by any one team.

## 2. Rules every team follows

### 2.1 Never touch (main session only)

These come back to the main session as a request, never as a drive-by edit:

- root `package.json`, root `tsconfig*.json`, `pnpm-workspace.yaml`, eslint/prettier/vitest root config, `.github/`
- `apps/api/src/db/` — the Drizzle schema and **all migrations**
- `packages/api-contract/`
- `packages/schema-core/`
- `apps/web/src/routes/` (the TanStack Router route tree) and the generated `routeTree.gen.ts`
- the Tailwind theme (`apps/web/src/styles/`) and `apps/web/src/components/ui/`
- `apps/api/src/app.ts`, `config.ts`, `http/`, `access/`, `modules/index.ts` (the wiring)
- `apps/web/src/lib/` (api client, query keys, mock-url, auth guard)
- `docker/`, `docker-compose*.yml`, `.env.example`

Why the route tree is safe to freeze: Phase 1 (FND-13) creates **every** route in DESIGN's route map as a thin file that imports a screen component from `apps/web/src/features/<area>/`. A team fills in *its own screen components*; it never adds a route file. Likewise Phase 1 (FND-10) registers **every** contract endpoint, bound to the owning module's handler (or `501 not_implemented` when the module has not filled it in); a team fills in *its module's handlers*.

### 2.2 Adding tables

A team **may** add tables for its own area later (spec must say so), defined in `apps/api/src/modules/<area>/schema.ts` with a migration. Nothing from Phase 1's schema changes without coming back to the main session. Because the migration journal is shared, a team that needs a table raises it first; the main session merges the migration to avoid journal conflicts.

### 2.3 Dependencies

A team may add a runtime dependency **only** if it is named in a spec's Contract section (those are pre-approved and pre-declared in Phase 1 where practical: argon2 implementation, CodeMirror, TanStack Virtual, dnd-kit, Zustand, Immer, MSW). `pnpm-lock.yaml` is never hand-merged: rebase, run `pnpm install`, commit the result.

### 2.4 Stubbing

The contract is the point. While a dependency is unbuilt:

- **Backend:** insert rows with the Phase-1 factories (`apps/api/src/testing/factories.ts`) and authenticate with `createTestSession()`. Unbuilt endpoints respond `501 not_implemented`; do not call another module's code.
- **Frontend:** run `pnpm --filter web dev:mock`, which serves every endpoint from MSW using the registry's `example` payloads (FND-07). Override a handler in `apps/web/src/features/<area>/__mocks__/` for richer fixtures. Never add a feature flag to production code to fake a dependency.
- A unit **may not be marked done** until each unit in its `Depends on` list is merged and its acceptance criteria that touch that dependency have been run against the real thing.

### 2.5 Definition of done (every unit)

1. Every acceptance criterion in the spec is checked off and has a test that would fail without the change.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; `docker compose up` still serves a working app.
3. No file outside the team's owned directories changed (CI path check enforces this per branch name `team/<team>/<id>`).
4. Spec `Status:` set to `done`; any drift from the spec written back into the spec; any change to DESIGN.md/API-CONTRACT.md made in the same commit and called out.
5. New out-of-scope discoveries recorded in the relevant spec's *Open questions* or as a new draft spec — not fixed here.

---

## 3. Teams

### Core (main session)

| | |
| --- | --- |
| **Specs** | FND-01 … FND-14 (Phase 1), XC-01 (e2e first-release gate), REL-01 … REL-03 |
| **Owns** | Everything in §2.1, `e2e/`, `docs/`, `examples/` |
| **Also** | Reviews and merges all slice PRs; resolves migration-journal and lockfile conflicts; receives every "I need a shared-file change" request |
| **Stubs** | n/a |
| **Done** | Phase 1 gate passed and tagged `contracts-v1`; XC-01 green in CI; release units merged |

### Auth

| | |
| --- | --- |
| **Specs** | AUTH-01, AUTH-02, AUTH-03 |
| **Owns** | `apps/api/src/modules/auth/` · `apps/web/src/features/auth/` |
| **Endpoints** | `auth.register`, `auth.login`, `auth.logout`, `auth.me`, `auth.changePassword`, `system.instance` |
| **Also owns** | The session middleware `apps/api/src/modules/auth/session-middleware.ts` (`requireSession`). Core seeds a minimal working read-path version in FND-10 so every other team can authenticate from day one; AUTH-01 hardens it and must keep its signature (`req.auth = { userId, sessionId }`) |
| **Screens** | `/login`, `/register`, the route guard (`beforeLoad`), sign-out in the account menu |
| **Stubs** | Nothing needed from other teams. Others stub *it*: they use `createTestSession()` and MSW `/auth/me` |
| **Done** | Register/login/logout/me match the contract byte-for-byte (envelope, cookie attributes incl. no `Secure`/no `Domain` by default); an unauthenticated visit to any protected route redirects to `/login` and never renders the shell; password hashing implementation builds on linux/arm64 alpine without a toolchain |

### Workspaces

| | |
| --- | --- |
| **Specs** | WS-01, WS-02, WS-03, WS-04 |
| **Owns** | `apps/api/src/modules/workspaces/` · `apps/web/src/features/workspaces/` |
| **Endpoints** | `workspaces.*`, `members.*` |
| **Screens** | Workspace switcher (topbar slot), new-workspace dialog, `/w/$wsSlug/members` |
| **Stubs** | Session → `createTestSession()`; web → MSW `/auth/me` |
| **Done** | Role matrix from API-CONTRACT §1.3 enforced and tested for every endpoint (viewer/editor/owner/non-member); `last_owner` can never be violated, including under concurrent requests; switcher hidden when the user has exactly one workspace |

### Projects

| | |
| --- | --- |
| **Specs** | PRJ-01 … PRJ-06 |
| **Owns** | `apps/api/src/modules/projects/` · `apps/api/src/modules/presets/` · `apps/web/src/features/projects/` · `apps/web/src/features/presets/` |
| **Endpoints** | `projects.*` (incl. `getBySlug`, `export`, `import`), `presets.*` |
| **Screens** | `/w/$wsSlug` project list, new-project dialog, project switcher (topbar slot), `/p/$projectSlug/settings`, `/p/$projectSlug/presets` |
| **Stubs** | Workspace + session via factories; for `import`, routes/cases via factories until Builder's tables are populated |
| **Done** | Duplicate slug → `409 slug_taken`, reserved slug → `422 slug_reserved`, neither creates a row; slug immutable; deleting a project evicts nothing it doesn't own (cache eviction goes through the Runtime-owned `cache.flush` hook defined in FND-10, not a direct import); export → import round-trips to an equal project |

### Builder

| | |
| --- | --- |
| **Specs** | BLD-01 … BLD-12 |
| **Owns** | `apps/api/src/modules/{routes,cases,schema}/` · `apps/web/src/features/{routes,schema-builder,preview}/` |
| **Endpoints** | `routes.*`, `cases.*`, `schema.infer`, `schema.preview` |
| **Screens** | Project shell + route rail (`/p/$projectSlug`), route editor (`…/routes/$routeId`, `…/cases/$caseId`), schema builder (Builder / JSON / Preview tabs), live preview, Try-it panel |
| **Stubs** | Project row → factories; `GET /projects/by-slug` → MSW until PRJ-01; Try-it's real call → MSW until RUN-05; deployed-version state → MSW |
| **Done** | Route collision rules identical to API-CONTRACT §1.7 (`/users/:id` vs `/users/:userId` → 409); exactly one default case per route always holds; the builder store round-trips builder ⇄ JSON ⇄ preview losslessly **including unknown node keys**; builder stays responsive with a 2,000-node schema (virtualised); no `fetch` in components |

### Runtime

| | |
| --- | --- |
| **Specs** | RUN-01 … RUN-13 |
| **Owns** | `apps/api/src/modules/{versions,dataplane,requests}/` · `apps/api/src/seed/` · `apps/web/src/features/{versions,logs}/` |
| **Endpoints** | `versions.*`, `deploy.create`, `deployments.list`, `cache.flush`, `requests.list`; the whole data plane `/mock/:slug/*` |
| **Screens** | `/p/$projectSlug/versions` (list, publish dialog, deploy/rollback, diff), `/p/$projectSlug/logs`, the LIVE pill data |
| **Stubs** | Draft rows (routes/cases) → factories until Builder's CRUD merges; schema bodies → `schema-core` fixtures; project shell → standalone screen harness until BLD-04 |
| **Done** | Publish is all-or-nothing and the snapshot is self-contained (editing a preset/component afterwards changes nothing already published); a version row can never be updated; data-plane hot path (steps 2–7 of API-CONTRACT §4.1) issues **zero** DB queries once warm — asserted by a test that fails on any query; every mock-server error carries `X-Mock-Error: true`; `OPTIONS` answered before matching; rollback takes effect on the next request without restart |

## 4. Branches and merging

- One spec = one branch `team/<team>/<spec-id>` (e.g. `team/builder/BLD-01`) = one PR into `main`. Agents work in their own git worktree.
- A PR touches only its team's owned directories plus its own spec file (status/criteria). CI rejects other paths.
- Core merges in dependency order. If two PRs touch the migration journal or lockfile, Core re-generates; teams do not hand-merge.
