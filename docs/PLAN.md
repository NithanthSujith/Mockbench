# Mockbench — build plan

Status: **approved 2026-11-05; all § 8 recommendations accepted (D1–D13).** Phase 1 in progress.

56 work units, 5 phases, 6 owners (5 slice teams + Core). Every spec is in `docs/specs/<ID>-<slug>.md`, status `draft`.

## 0. How to read this

- **IDs** are `<AREA>-<NN>`: `FND` foundation (Phase 1), `AUTH`, `WS`, `PRJ`, `BLD`, `RUN` (the slice teams), `XC` cross-cutting integration, `REL` release.
- **Size** S / M / L is relative effort for one focused session, not calendar time.
- **Depends on** means: *merge-order dependency for acceptance against the real thing.* A team may start earlier against the frozen contract and stubs (`docs/TEAMS.md` §2.4) but cannot mark a unit `done` until its dependencies are merged and the relevant criteria re-run. Every unit is independently mergeable and leaves the build green and the app running.
- **Owner** is a team from `docs/TEAMS.md`. `Core` = main session.

## 1. Critical path

**To the first usable release** (DESIGN M3: define a route, publish, `curl` it):

`FND-01 → FND-02 → FND-03 → FND-04 → FND-07 → FND-10 → FND-11 → BLD-01 → BLD-02 → RUN-01 → RUN-02 → RUN-03 → RUN-04 → RUN-06 → RUN-05 → XC-01`

with the UI chain `FND-12 → FND-13 → AUTH-03 → PRJ-04 → BLD-04 → BLD-05 → BLD-09 → RUN-09` converging at XC-01.

Two observations that change how to staff it:

1. **The visual schema builder (BLD-07/08/10) is deliberately *off* the critical path.** The release gate needs only the JSON tab (BLD-09) plus preview (BLD-11). DESIGN flags the builder as the thing most likely to overrun; this ordering means an overrun delays polish, not the first release. The format is identical either way.
2. **Phase 1 itself is the longest serial stretch** (schema-core is a 4-unit chain, then the contract, then the API skeleton). That is the price of freezing three contracts before parallel work. Within Phase 1, three chains are independent and can run in parallel in the main session: *(a)* FND-02→05 schema-core, *(b)* FND-08→09 database, *(c)* FND-12 design tokens. FND-06/07 (contract) needs (a)'s types; FND-10 needs (b) and the contract.

---

## 2. Phase 1 — Freeze the contracts   *(owner: Core — not parallel slice work)*

Entire job: lock the HTTP contract, the database schema and `schema-core`, and bring up the Docker skeleton. **No feature work starts until every unit here is done and you have approved the freeze** (then tagged `contracts-v1`).

| ID | Unit | Depends on | Size | Owner |
| --- | --- | --- | --- | --- |
| FND-01 | Monorepo, tooling, CI skeleton, license | — | M | Core |
| FND-02 | schema-core: MockSchema types + Zod validator + limits | FND-01 | M | Core |
| FND-03 | schema-core: deterministic generator (ordinals, indexing, precedence, UUID v5, seeded/random) | FND-02 | L | Core |
| FND-04 | schema-core: presets engine + JSON→schema inference | FND-03 | M | Core |
| FND-05 | schema-core: golden fixtures, property tests, browser-purity guard | FND-04 | M | Core |
| FND-06 | api-contract: primitives, endpoint registry machinery, OpenAPI + docs generators | FND-01, FND-02 | M | Core |
| FND-07 | api-contract: every endpoint's Zod schemas, errors and examples; drift check vs API-CONTRACT.md | FND-06, FND-04 | L | Core |
| FND-08 | Database schema (11 tables) + migrations from empty + constraints | FND-01 | L | Core |
| FND-09 | DB runtime: client, programmatic migrator behind an advisory lock, Postgres test harness | FND-08 | S | Core |
| FND-10 | API skeleton: app factory, two planes, registry-driven wiring, envelope, validation, config, health, rate-limit scaffold, `501` stubs | FND-07, FND-09 | L | Core |
| FND-11 | Access policy (role matrix helpers), test factories, `createTestSession()` | FND-10 | M | Core |
| FND-12 | Design tokens + component vocabulary extracted from the prototype (Tailwind theme, self-hosted fonts, ui kit) | FND-01 | L | Core |
| FND-13 | Web skeleton: Vite, full route tree as stubs, Query client, typed API client, MSW, app shell with slots, `mock-url` helper | FND-07, FND-12 | L | Core |
| FND-14 | Docker + LAN skeleton: Dockerfiles, nginx, compose (+dev, +pull), `.env.example`, healthchecks, multi-arch, README LAN section | FND-10, FND-13 | L | Core |

### ══════════ END OF PHASE 1 — FREEZE GATE ══════════

You review: `docs/API-CONTRACT.md` ⇄ `packages/api-contract`, the Drizzle schema, `schema-core`'s public exports, the design tokens, and `docker compose up` on a second machine. On approval: tag `contracts-v1`; DESIGN.md amended for every ruled item in § 8. **Parallel work may begin only after this line.**

---

## 3. Phase 2 — Slice foundations: APIs and headless cores   *(parallel)*

Each slice's backend and its UI-independent core. All of these can start the same day.

| ID | Unit | Depends on | Size | Owner |
| --- | --- | --- | --- | --- |
| AUTH-01 | Session core: token issue/validate/revoke, cookie, `requireSession`, CSRF guard, session sweep | FND-11 | M | Auth |
| AUTH-02 | Register / login / logout / me / change-password / instance endpoints, Argon2id, login rate limit | AUTH-01 | M | Auth |
| WS-01 | Workspaces API (list/create/get/update/delete) | FND-11 | M | Workspaces |
| WS-02 | Members API with last-owner protection | WS-01 | M | Workspaces |
| PRJ-01 | Projects API: CRUD, by-slug, slug rules + reserved, settings/components | FND-11 | M | Projects |
| PRJ-02 | Presets API | PRJ-01 | S | Projects |
| BLD-01 | Routes API: CRUD, path grammar, collision 409, duplicate | FND-11 | M | Builder |
| BLD-02 | Cases API: CRUD, default switching, name uniqueness, schema validation | BLD-01 | M | Builder |
| BLD-03 | Stateless `schema/infer` and `schema/preview` endpoints | FND-11 | S | Builder |
| BLD-06 | Schema-builder store: normalised state, reducer ops, undo/redo, lossless (de)serialisation | FND-02 | M | Builder |
| RUN-01 | Snapshot + bake service (pure, no HTTP): validate → snapshot → bake | FND-11, FND-04 | M | Runtime |
| RUN-02 | Publish + versions API (publish, list, get, delete rules) | RUN-01 | M | Runtime |
| RUN-03 | Deploy + deployments API | RUN-02 | S | Runtime |
| RUN-04 | Compiled version: radix-tree matcher + case selection (pure) | FND-07 | M | Runtime |

## 4. Phase 3 — Screens and the publish loop   *(parallel within the staging in TEAMS.md §1)*

Ends with **XC-01: the first usable release** (DESIGN M3).

| ID | Unit | Depends on | Size | Owner |
| --- | --- | --- | --- | --- |
| AUTH-03 | Sign-in / register screens, route guard, account menu | AUTH-02, FND-13 | M | Auth |
| WS-03 | Workspace switcher + new-workspace dialog | WS-01, AUTH-03 | S | Workspaces |
| PRJ-04 | Project list screen, new-project dialog, project switcher | PRJ-01, AUTH-03 | M | Projects |
| BLD-04 | Project shell + route rail (list, filter, new route) | BLD-01, PRJ-01 | M | Builder |
| BLD-05 | Route editor: method/path/description, case tabs, case metadata, URL-synced selection | BLD-02, BLD-04 | M | Builder |
| BLD-07 | Schema builder tree UI: rows, key/type/attr controls, add/delete, expand/collapse | BLD-06, BLD-05 | M | Builder |
| BLD-09 | Schema builder JSON tab (CodeMirror) + paste-JSON inference flow | BLD-06, BLD-05, BLD-03 | M | Builder |
| BLD-11 | Live preview pane (local generate, provenance highlighting, mode explanation) | BLD-05, FND-03 | M | Builder |
| BLD-12 | Try-it panel: curl snippet from `window.location`, copy with insecure-context fallback, live Send | BLD-11, RUN-05 | M | Builder |
| RUN-06 | Version cache: slug index, byte-bounded LRU, invalidation on deploy/delete, flush | RUN-04, RUN-03 | M | Runtime |
| RUN-05 | Data-plane handler: lifecycle, CORS/OPTIONS, diagnostic headers, mock-server errors | RUN-04, RUN-06 | L | Runtime |
| RUN-07 | Request-log writer (buffered, async, redacting) + retention pruner | RUN-05 | M | Runtime |
| RUN-09 | Versions screen: list, publish dialog, deploy/rollback, LIVE pill | RUN-02, RUN-03, BLD-04 | M | Runtime |
| XC-01 | Playwright e2e of the full loop in CI against the compose stack — **first usable release gate** | AUTH-03, PRJ-04, BLD-09, BLD-11, RUN-05, RUN-09, FND-14 | M | Core |

### ══════════ FIRST USABLE RELEASE (DESIGN M3) ══════════

## 5. Phase 4 — Depth and convenience   *(parallel, no critical path)*

DESIGN M5 plus the rest of the builder.

| ID | Unit | Depends on | Size | Owner |
| --- | --- | --- | --- | --- |
| WS-04 | Members screen | WS-02, WS-03 | M | Workspaces |
| PRJ-03 | Presets screen (editor, import/export JSON, starter pack) | PRJ-02, PRJ-04 | M | Projects |
| PRJ-05 | Project settings screen (mode, indexing with live examples, CORS, delay, delete) | PRJ-01, PRJ-04 | M | Projects |
| PRJ-06 | Project export / import (API + UI) | BLD-02, PRJ-02, PRJ-04 | M | Projects |
| BLD-08 | Schema builder: drag-reorder + TanStack Virtual past ~200 rows | BLD-07 | M | Builder |
| BLD-10 | Schema builder: pin value, examples, min/max, nullable, description, `ref` + components management | BLD-07 | M | Builder |
| RUN-08 | Request-log API + screen | RUN-07, BLD-04 | M | Runtime |
| RUN-10 | Version diff (API + UI) | RUN-02, RUN-09 | M | Runtime |
| RUN-11 | Demo seed (`SEED_DEMO`) | RUN-03, BLD-02, PRJ-01 | S | Runtime |
| RUN-12 | Postgres `LISTEN`/`NOTIFY` cache fan-out — **optional, drop if single-instance (D13)** | RUN-06 | S | Runtime |
| RUN-13 | Data-plane rate cap (`MOCK_RATE_LIMIT`) | RUN-05 | S | Runtime |

## 6. Phase 5 — Release   *(DESIGN M6)*

| ID | Unit | Depends on | Size | Owner |
| --- | --- | --- | --- | --- |
| REL-01 | README (GIF, quickstart, LAN URL, firewall note), docs site, `examples/` | XC-01, RUN-11 | M | Core |
| REL-02 | GHCR multi-arch release workflow, `docker-compose.pull.yml`, e2e on tag | FND-14, XC-01 | M | Core |
| REL-03 | CONTRIBUTING, CoC, issue/PR templates, Changesets, CodeQL, good-first-issues | FND-01 | S | Core |

**Counts:** Phase 1: 14 · Phase 2: 14 · Phase 3: 14 · Phase 4: 11 · Phase 5: 3 → **56 units**. By owner: Core 18, Auth 3, Workspaces 4, Projects 6, Builder 12, Runtime 13.

---

## 7. Coverage: every DESIGN feature has a unit

| DESIGN feature | Unit(s) |
| --- | --- |
| Monorepo, CI skeleton (M0) | FND-01 |
| Compose, healthchecks, migrations + advisory lock, multi-arch, env vars (M0, brief) | FND-09, FND-14, REL-02 |
| Auth: register/login/logout/me, ALLOW_SIGNUP, sessions, login rate limit | AUTH-01, AUTH-02, AUTH-03 |
| Workspaces, members, roles, switcher | WS-01…04, FND-11 |
| Projects, slug rules, reserved slugs, settings, switcher, list | PRJ-01, PRJ-04, PRJ-05 |
| Presets (rules, specificity, patterns), shipped packs, import/export JSON | FND-04, PRJ-02, PRJ-03 |
| Routes CRUD, collision check, duplicate | BLD-01, BLD-04, BLD-05 |
| Response cases, default, status whitelist, headers, delay | BLD-02, BLD-05 |
| MockSchema, validator, limits, `source` reserved / unknown keys ignored | FND-02 |
| Generator, indexing modes, precedence, seeded/random | FND-03 |
| Inference from pasted JSON | FND-04, BLD-03, BLD-09 |
| Schema builder: store/undo, tree, JSON tab, virtualisation, advanced attrs, components | BLD-06, 07, 08, 09, 10 |
| Live preview, Try-it + curl snippet | BLD-11, BLD-12 |
| `schema/infer`, `schema/preview` | BLD-03 |
| Publish (validate/snapshot/bake), versions list/get/delete | RUN-01, RUN-02, RUN-09 |
| Deploy, rollback, deployment history | RUN-03, RUN-09 |
| Version diff | RUN-10 |
| Data plane: lifecycle, matching, case selection, headers, CORS, errors | RUN-04, RUN-05 |
| Cache, invalidation, flush, LRU, NOTIFY | RUN-06, RUN-12 |
| Request logging, retention, log screen | RUN-07, RUN-08 |
| Rate limits (control plane / login / data plane) | FND-10, AUTH-02, RUN-13 |
| Project export/import file | PRJ-06 |
| Demo seed | RUN-11 |
| `/healthz`, `/readyz`, `/api/v1/openapi.json` | FND-10 (health, openapi wiring), FND-06 (generator) |
| Frontend: route map, TanStack usage, tokens, shell | FND-12, FND-13 + each slice |
| e2e workflow | XC-01 |
| `docker` / `codeql` workflows, README, CONTRIBUTING, license | REL-01, REL-02, REL-03, FND-01 |
| OpenAPI **import**, `/p/:slug/import` | **None — deferred** (ADR 0010) |

---

## 8. Decisions needed before approving Phase 1

Phase 1 freezes things DESIGN leaves open or contradicts. Each has a recommended default that **is already written into API-CONTRACT.md and the specs**; say "accept all" or override individually. Changing any of these after the freeze costs a migration or a contract bump.

| # | Decision | Recommended | Why it must be settled now |
| --- | --- | --- | --- |
| D1 | Zod 3 (DESIGN) or Zod 4 | **Zod 4** if the OpenAPI generator and TanStack Form integrations we use support it at FND-06; else 3 | The whole contract package is Zod; switching later touches every schema. Verify at FND-06 before writing endpoints |
| D2 | May a case's root node be any type (e.g. a bare array for `GET /users`) or only `object`? | **Any node type** | Bare-array responses are common; the prototype and DESIGN example only show object roots. Affects envelope validation and the builder root row |
| D3 | Registration/membership: who gets a workspace? | First user → owner of the "Default" workspace (adopting it if the demo seed already created it ownerless). Later registrants get **none**; an owner adds them by email (`members.add`) or they create their own. Close signup with `ALLOW_SIGNUP=false` afterwards | DESIGN is silent; there is no invite flow and no admin-creates-user endpoint. This is the smallest coherent model |
| D4 | `seeded`/`random` value source: Faker or in-repo word/name pools | **In-repo pools** (extend the prototype's) with a small seeded PRNG | Faker is multi-MB in the browser bundle (schema-core ships to the browser), is not in the stack list, and its output can change across versions, breaking "seeded never changes". Pools are ~10 KB |
| D5 | `nullable` semantics and the missing `optional` | `nullable` is **documentary in v1**: generation never emits `null` for it; pin `fixed: null` to force one. Inference maps "optional" keys to `nullable: true` + a warning. `fixed` is detected by key presence (so `""`, `0`, `false`, `null` are valid pins) | DESIGN's inference rules produce nodes the generator would not reproduce (`null` → string). The prototype treats `""` as unpinned |
| D6 | Project slug immutable? | **Immutable after creation** | The slug *is* the consumer URL; a rename silently breaks every client |
| D7 | Does live behaviour read draft settings or the deployed snapshot's? | **Snapshot only.** Settings/components edits take effect at next publish; cache invalidated only on deploy/delete/flush | DESIGN says both "edits never change consumers" and "invalidate on settings change" — contradictory |
| D8 | `SESSION_SECRET` role and default | **HMAC pepper for `sessions.token_hash`.** `.env.example` ships a labelled placeholder; the API starts but logs a loud warning while it equals the placeholder | Sessions are opaque tokens, so "signs cookies" is meaningless; and `cp .env.example .env && docker compose up` must work (DESIGN's `:?` would break it with an empty value) |
| D9 | Same-origin hardening of the data plane | **`Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff` on every mock response**; plus the `X-Mockbench-Client` CSRF header on the control plane | Case headers are user-authored and mocks share the editor's origin: an `editor` can make a mock that scripts an `owner`'s session. See concern C1 |
| D10 | Schema details that DESIGN contradicts or omits (a single bundle: accept or amend) | **11th table `deployments`** (versions/deploy history is specified but has no table); `versions.baked` is **`text`** (DESIGN lists `jsonb` but says "store as a string, not jsonb"); `versions` gets `seq`, `route_count`, `case_count`, `snapshot_bytes`, `baked_bytes` and **no `updated_at`** (immutable, enforced by trigger); `projects` gets `components jsonb` and `version_seq`; `request_logs` gets `route_pattern`, `case_name`, `mock_error` and no `updated_at`; `request_logs.version_id` is `RESTRICT`; unique `(route_id, lower(name))` on cases; snapshot field `statusCode` (not `status`), plus `generatorVersion`, `project.id`, `components` | Each is a column or table; adding after the freeze needs a migration approval anyway. They are required by behaviour DESIGN already specifies |
| D11 | API additions beyond DESIGN's table (marked ⁺ in API-CONTRACT) | `system.instance`, `auth.changePassword`, `workspaces.get/update/delete`, `projects.getBySlug`, `components` on `projects.update`, route `cases[]` summaries, `/api/v1/healthz|readyz` aliases, `/w/$wsSlug/members` screen | Without them: the login screen cannot know whether signup is open; deep links `/p/<slug>` have no lookup; components have no CRUD; the members screen has no route |
| D12 | Case `delayMs` cap and nullability | **0–10 000 ms, `null` = inherit project default** | DESIGN says "the project default when the case has none" (so nullable) but gives no cap; the prototype caps at 5 000. Long delays tie up sockets |
| D13 | Single instance or replicas (DESIGN open question 2) | **Single instance in v1.** Advisory lock stays (it is a hard requirement of the brief); `LISTEN`/`NOTIFY` is RUN-12, optional | Drops one dedicated Postgres connection and the fan-out test matrix unless you need it |

DESIGN's own open questions: Q1 (project vs per-route versions) is answered by ADR 0004. Q3 (validate request bodies) is **not in v1**; the Route model does not preclude it. Q4 (request log vs diff first): both are in the plan; the log (RUN-07/08) is scheduled before the diff (RUN-10).

---

## 9. Gaps and concerns

I read DESIGN.md critically. Items are grouped by where they bite; the three I would fix before anything else are **C1, C2 and C3**.

### Top three

**C1 — Mock responses run in the same origin as the editor, with user-controlled headers.**
Mocks are served at `/mock/...` on the same host and port as the SPA, and a case can set `Content-Type` and arbitrary headers. An `editor` can publish a mock returning `text/html` that runs script in the viewing user's browser on the Mockbench origin and drives the control plane as them (httpOnly protects the cookie's value, not its use). That defeats the role model: editor → owner. On a trusted LAN the likelihood is low, but the *role system exists* and this makes it advisory. Fix is cheap: `Content-Security-Policy: sandbox` + `nosniff` on every data-plane response, forbid `access-control-*`/`x-mock-*` header overrides, require a custom header on control-plane writes (D9). SameSite=Lax does not help because other ports on the same host are same-site.

**C2 — The data model has holes that would force schema changes after the freeze.**
- DESIGN says "ten tables" but specifies a *Deployment* object, a deploy history and `GET /deployments` with **no table** (D10).
- `ref` components "live at the project level" but there is no column, and the envelope also carries its own `components` — two homes for one thing. (Proposed: `projects.components`; the envelope `components` are defaults that project components override (as FND-02 implements); both are resolved at publish and frozen into the snapshot.)
- `versions.baked` is `jsonb` in the table and "a string, not jsonb" in the prose. A `jsonb` of escaped strings must be parsed at load and defeats the purpose.
- "Every table carries `updated_at`" contradicts `versions` being immutable and append-only logs. Immutability is claimed as "no UPDATE grant" but the app uses one DB role: it needs a trigger (FND-08), not a grant.
- `request_logs.matched_route_id` as an FK would break when a route is deleted; it must be a plain column with denormalised `route_pattern`/`case_name`. Logs for unknown slugs have no `project_id`, so they cannot be logged.
- Case-name matching is case-insensitive (`__case=unauthorized` in DESIGN's own example) but nothing prevents two cases whose names differ only by case, or two cases with the same status code (ambiguous `X-Mock-Status`).
- No way to reorder routes or cases (`sort_order` columns, no endpoint). v1: creation order only.
- The hot path "resolves the project from the slug" but the cache is "keyed by project id": slug→project resolution is a DB hit per request (and per typo'd slug) unless the cache also holds a slug index with negative caching (RUN-06).

**C3 — The generator is a frozen public contract with unspecified edges.**
- JS object key order: keys like `"200"` or `"1"` reorder in a plain object, silently breaking "output key order is stable" for maps keyed by id/status. The generator must serialise from the ordered field list, not from a built object (FND-03 does).
- Root may be an array? `nullable` generates null? `optional` in inference has no home in the format? `fixed: ""` vs unset? Unspecified (D2, D5).
- UUID v5 needs SHA-1; `crypto.subtle` does not exist on `http://192.168.x.x` (insecure context), so schema-core must ship a synchronous SHA-1 — and the pointer/`projectId` inputs must be identical in the browser preview and at publish or the "exact JSON the server returns" claim fails.
- `phone` as `+91 90000 0000<n>` produces the wrong digit count past `n = 9`; `integer` clamps `n` into `[min,max]` (constant at the boundary) but `number` does not; `date` base date is unspecified. Pinned in FND-03.
- Nothing records which generator produced a version. A later fix to the generator makes the preview differ from what is deployed; the snapshot needs `generatorVersion` (D10).
- Faker in a browser bundle (D4).

### Data model and API

- **Workspaces — do they earn their complexity for one LAN tool?** My honest view: *the tables yes, the surface barely.* Workspaces cost two tables, nine endpoints, a role matrix on every handler, a switcher, a members screen and a team's worth of tests. They buy little: slugs are globally unique and the data plane ignores workspace boundaries entirely, so a workspace is an *editor-visibility* boundary only. But retrofitting multi-tenancy later is far costlier than keeping a `workspace_id` column now. Recommendation: keep the schema and authz exactly as designed (you chose workspace-scoped accounts), but ship the minimum UI — hide the switcher when a user has one workspace, no workspace analytics, and treat WS-04 (members screen) as the only non-trivial workspace screen. If you want to cut scope, cutting `workspaces.delete` and WS-04 is safe.
- **No account lifecycle.** No password reset (there is no email on a LAN box), no profile edit, no deactivate/delete user, no way to create a user other than open signup. I added `auth.changePassword`; a CLI `reset-password` script is the realistic recovery path and is not in any unit — add it before announcing (REL-01 notes it).
- **Project export.** "No ids that reference anything outside it" — so cases/routes lose identity on import and `If-Match`/diff continuity is gone. Fine for sharing; do not let anyone treat export→import as a restore of a *project* (versions and history are not exported).
- **No optimistic concurrency.** Two editors on one case silently last-write-wins; in a team tool that will happen. `If-Match` is reserved but unspecified.
- **Pagination direction.** DESIGN specifies "cursor on created_at plus id" universally, but routes/cases/presets are ordered by `sort_order`. Resolved by only paginating append-style lists; small collections return everything.
- **Slug vs id mismatch.** The API is id-based, the SPA URLs are slug-based (`/p/$projectSlug`). Added `projects.getBySlug`.
- **`cors` setting.** DESIGN's snapshot shows `"cors": "*"` but the prose says per-project on/off for testing CORS failures. Modelled as `"*" | "off"` (widen to origin lists later without breaking).

### Publish, bake, deploy

- **Publish and deploy as two calls.** The prototype's single "Publish" button means publish-then-deploy; non-atomic from the client, harmless (a version without a deploy is inert), kept as DESIGN specifies.
- **Label vs auto-number.** `v<seq>` needs a per-project counter that survives deletes (`projects.version_seq`), or deleting the latest version re-issues its label.
- **Memory.** The Risks table wants an LRU, the Cache section describes a bare `Map`. An LRU must be **byte-bounded**, not count-bounded, because one project can hold hundreds of MB of baked payloads at the 50 000-leaf cap × many cases. RUN-06.
- **`LISTEN` needs its own connection** outside the pool, with reconnect + resync; RUN-12 is not as trivial as one line (D13).
- **`random` mode** keeps the generator on the hot path and needs the project's presets/components in memory; it also means the Try-it panel can never equal the second call.
- **Version diff identity.** Routes have no stable identity across versions (ids are draft row ids). Diff keys on method + normalised path, cases on name; a *renamed* route or case therefore shows as remove + add. Acceptable; state it in the UI.

### Runtime, LAN and Docker

- **A LAN IP over HTTP is not a secure context.** Beyond `crypto.subtle` (C3): `navigator.clipboard` is unavailable (the prototype has a selection fallback — keep it), and service workers are off. CLAUDE.md records this.
- **Client IP is often lost.** On Docker Desktop (Mac/Windows) every request appears from the VM gateway, so `request_logs.ip` and the **per-IP login limit (10/min) become one shared bucket for the whole team** — three people logging in can lock out the fourth. nginx must set `X-Forwarded-For` and Express `trust proxy` must be configured (FND-10/14), and the README should say the IP column may be a gateway address on Docker Desktop. Consider keying the login limit on `email + IP`.
- **Healthcheck.** DESIGN's api healthcheck fetches `http://localhost:3000`. On Alpine, `localhost` can resolve to `::1` while Express binds IPv4 → perpetually unhealthy → `web` never starts. Use `127.0.0.1` (FND-14).
- **`drizzle-kit migrate` in the runtime image** conflicts with "copy only dist and production `node_modules`": the CLI is a dev dependency. Use the programmatic migrator (ADR 0002, FND-09).
- **`SESSION_SECRET: ${…:?}`** makes `docker compose up` fail on an empty value, contradicting the three-command quickstart (D8).
- **Argon2 on `node:alpine` arm64.** Native `argon2` can need a toolchain on musl/arm64. Pick `@node-rs/argon2` or a WASM implementation and prove the multi-arch build (AUTH-01 criterion).
- **The prototype loads fonts from Google Fonts.** That violates "no outbound calls" and breaks on an offline LAN; fonts are self-hosted via npm (FND-12).
- **Request log hygiene.** Storing request headers stores `Authorization` and `Cookie` values that consumers send to a mock. Redacted before insert (RUN-07). Per-request inserts at load need batching.
- **Unknown-slug `OPTIONS`.** To let a browser read the real 404, preflight for unknown slugs is answered permissively; with `cors: "off"` the preflight must *fail* (that is the feature). Specified in API-CONTRACT §4.4.
- **Web healthcheck / root paths.** nginx proxies only `/api` and `/mock`; `/readyz` at the web port would return the SPA. Added `/api/v1/readyz`.

### Process

- **`docs/` is both our planning docs and DESIGN's "docs site source".** User-facing docs should live under `docs/site/` (REL-01) so specs and ADRs are not published.
- **`pnpm-lock.yaml` and the Drizzle migration journal** are inevitable merge hotspots with five parallel teams; handled by Core regenerating, not by teams hand-merging (TEAMS.md §2.2–2.3).
- **Phase 1 is large (14 units) and serial in places.** That is the cost of the three freezes; the parallel groups in § 1 are the mitigation. If it feels too heavy, the one safe cut is to ship `seeded`/`random` modes as *validated settings that fall back to deterministic with a warning* in Phase 1 and implement them in a Phase-2 unit — but that makes schema-core *not* fully implemented at the freeze, contrary to your brief, so I have not done it.
- **Project name collision** (DESIGN §Working name asks to check npm/GitHub/domain): "Mockbench" is already chosen; the check has not been done by me.
