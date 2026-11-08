# FND-13 — Web skeleton: route tree, typed client, shell, mock mode

Status: in progress
Phase: 1   Team: Core
Depends on: FND-07, FND-12
Size: L

## Goal
A Vite + React 19 app whose complete route tree, typed API client, query setup, app shell with named slots and offline mock mode already exist, so each team only fills in screen components inside its own `features/<area>/` directory and never edits a shared file.

## In scope
- Vite config (`server.host: true`, proxy `/api` and `/mock` to `API_PROXY_TARGET`), TanStack Router file-based routes for **every** path in DESIGN's route map plus `/w/$wsSlug/members` and dev-only `/_dev/ui` — each route file only imports a screen from `features/<area>/screens/` (stub components that render the screen name).
- `src/lib/`: typed API client generated from the registry, `ApiError`, query-key factory, `QueryClient` defaults, `mock-url.ts`, auth-guard `beforeLoad` calling `features/auth/session.ts`.
- App shell (`ProjectShell`, topbar with named slots: workspace switcher, project switcher, live pill, base URL, Publish, account menu; rail + editor + response columns with the prototype's responsive rules); MSW mock mode (`pnpm --filter web dev:mock`).

## Out of scope
Any real screen (each team's units). The theme (FND-12). Docker/nginx (FND-14).

## Contract
- Routes (file → screen): `/login`, `/register` → auth; `/w/$wsSlug` → projects; `/w/$wsSlug/members` → workspaces; `/p/$projectSlug` (shell) → routes; `…/routes/$routeId` and `…/cases/$caseId` → routes; `…/versions` → versions; `…/presets` → presets; `…/logs` → logs; `…/settings` → projects. `/p/$projectSlug/import` is **not** created (ADR 0010).
- `api.<area>.<operation>(input)` mirrors endpoint ids (`api.projects.list({ query })`); every request is relative (`/api/v1/…`), sends `credentials: 'same-origin'` and, on non-safe methods, `X-Mockbench-Client: web`; non-2xx → `ApiError { status, code, message, details }`; a `401` anywhere triggers one redirect to `/login`.
- `getMockBaseUrl(slug)` = `${window.location.origin}/mock/${slug}`; `getMockHost()` = `window.location.host`. No other code builds a mock URL.
- Slots: `<WorkspaceSwitcher/>` (features/workspaces), `<ProjectSwitcher/>` (features/projects), `<LivePill/>` (features/versions), `<PublishButton/>` (features/versions), `<AccountMenu/>` (features/auth) — stubs in Phase 1.
- Dependencies pre-declared: TanStack Router/Query/Table/Form/Virtual, `@dnd-kit/*`, Zustand, Immer, CodeMirror 6, MSW, `lucide-react`.

## Acceptance criteria
- [x] Visiting each route path in the contract table renders its stub inside the shell with the correct `features/<area>` stub; an unknown path renders a not-found screen inside the shell. *(unit tests render every path in a memory router; the same paths in a real browser under `dev:mock`)*
- [x] `apps/web/src` contains no `localhost`/`127.0.0.1`/colour literal/raw `fetch` (FND-01 lint rules pass with real code); the only `localhost` is in `vite.config.ts`. *(lint rules 2-4 plus `hygiene.test.ts`; only vite.config.ts holds a loopback address)*
- [x] A unit test with jsdom at `http://192.168.1.24:8080` shows `getMockBaseUrl('demo')` is `http://192.168.1.24:8080/mock/demo`; at `http://mockbench.office:3000` it is `http://mockbench.office:3000/mock/demo`. *(`lib/mock-url.test.ts` stubs `location` at both origins)*
- [x] `api.projects.list({query:{workspaceId}})` issues `fetch('/api/v1/projects?workspaceId=…')` (relative URL), and a `POST` carries `X-Mockbench-Client: web`. *(`lib/api/client.test.ts`)*
- [x] `ApiError` is thrown for a `404` envelope with `code` and `details` populated; a `401` response redirects once to `/login` and does not loop. *(`client.test.ts` and `app/routes.test.tsx`: three parallel 401s give one navigation and no loop)*
- [x] `pnpm --filter web dev:mock` serves every endpoint from the registry's `example` payloads with no backend running, and the shell renders against them. *(unit: every endpoint answered from its example through msw/node; browser: Playwright against `vite --mode mock`)*
- [x] `vite preview --host 0.0.0.0` is reachable from the machine's LAN IP and the app loads (CI curls the non-loopback address). *(Playwright loads the app from this machine's non-loopback IPv4 address; it skips only if the machine has none)*
- [x] The route tree compiles with `routeTree.gen.ts` committed; `pnpm typecheck` fails if a route file imports from a feature directory that does not exist. *(typecheck fails with TS2307 for a route importing a missing feature, verified with a throwaway route file; `app/route-tree.test.ts` fails too)*
- [ ] At widths ≥1240, 860–1240 and <860 px the shell reproduces the prototype's three, two and one-column layouts (Playwright screenshots at three widths reviewed against the prototype). *(Measured part done: computed grid track counts are asserted at 1440/1000/390 px for the editor and wide shells, the response column drops below at <=1240, no horizontal scroll, base URL on its own row at <=860. NOT ticked: the visual side-by-side with the prototype is the owner's review; screenshots are in `apps/web/gallery-screenshots/shell-{editor,wide}-{1440,1000,390}.png`.)*

## Tests
Vitest for client/`mock-url`/query keys; Playwright smoke for route rendering and layout widths; MSW-mode smoke.

## Implementation notes (FND-13)

**Built.** File-based route tree (`src/routes/`, `routeTree.gen.ts` committed) with a pathless `_authed` layout that runs the session guard before anything renders; a typed client; query setup; the shell; MSW mock mode; stub screens, slot components and loader hooks in every feature directory.

**Clarifications and additions (none contradicts DESIGN or API-CONTRACT):**
- **Generated endpoint table instead of the registry at runtime.** The client's runtime data is `src/lib/api/endpoint-table.gen.ts` (id -> method, path, success status), generated from the registry by `pnpm --filter @mockbench/web gen:endpoints` and checked for drift by a test. Types come from the registry as **type-only** imports, so production code never imports Zod. Response parsing is deliberately not done in the client (the server is the validator; the types are compile-time).
- **Route files are wiring only and cannot hold logic after the freeze**, so each calls a stub in `features/<area>/route-loaders.ts` (`projectLoader`, `routeEditorLoader`, `versionsLoader`, ...) that the owning team fills in (prefetch, `notFound()`). The guard calls only `features/auth/session.ts` (`getSession`, `getLandingPath`), which AUTH-03 owns.
- **Layout selection:** a route sets `staticData: { shell: 'editor' | 'wide' }`; `ProjectShell` uses the deepest match that sets it. Screens compose `Rail`, `Editor`, `Response`, `SoloShell` from `src/shell/columns.tsx`.
- **`/p/$projectSlug/routes/$routeId` is a layout route** rendering `RouteEditorScreen`; the `.../cases/$caseId` child has no component, so switching case never remounts the editor.
- **`/`** has no screen: it redirects to `getLandingPath(session)` or `/login`. `/login` accepts `?redirect=` (same-origin paths only, `safeRedirectTarget`) and `?reason=expired`.
- **401 handling:** `lib/api/unauthenticated.ts` fires the app handler at most once per expiry and is re-armed on reaching /login; the session probe opts out (`skipUnauthenticatedRedirect`); a 401 with another code (`invalid_credentials`) never redirects.
- **`/_dev/ui`** mounts the FND-12 gallery only when `import.meta.env.DEV`; the production bundle does not contain it. The FND-12 browser specs now run against a dev server at that URL (the `design` Playwright project) and wait for the lazy gallery.
- **Playwright has three projects:** `design` (dev server), `mock` (`vite --mode mock`), `preview` (production build + `vite preview`).
- `lib/copy.ts` (clipboard with a selection fallback for plain-HTTP origins) is shared by the top bar and available to BLD-12.
- `hygiene.test.ts` (FND-12) was aligned with lint rule 4: `fetch(` is allowed under `src/lib/api/`, and full-line comments are not scanned for hosts.
- The vite proxy keys are anchored (`^/api(/|$)`, `^/mock(/|$)`): the plain `/mock` prefix also swallowed `/mockServiceWorker.js`.

**MSW mock mode works on localhost / 127.0.0.1 only.** It needs a service worker, which browsers allow only in a secure context; a LAN IP over HTTP is not one. `dev:mock` is a development tool, not a deployment mode. The worker file is generated into `node_modules/.mockbench/mock-public` by `msw init` when `dev:mock` starts (never committed), and a production build contains no MSW code and no worker (asserted over `dist/`).

**Production bundle (gzip), `vite build`:** entry chunk **81.9 KB**, all JS **158.0 KB** (React, Router and Query plus the UI kit at about 46 KB; the dev gallery is excluded). The Zod question, measured with throwaway entries:

| Client built from | gzip |
| --- | --- |
| generated endpoint table (shipped) | **1.9 KB**, no Zod |
| registry imported at runtime, no response parsing | 39.1 KB |
| registry imported at runtime, with response parsing | 39.1 KB |

Parsing adds almost nothing once the registry is imported; the cost is the import itself (about 37 KB). A test asserts the production bundle contains no Zod, so a later feature that imports the registry or schema-core validators into the main path will show up.

**Tests added:** 113 unit tests (client, ApiError and 401, mock-url, query keys and client, copy, endpoint-table sync, MSW handlers for all 53 endpoints, route rendering, guard and redirects, route-tree and route-file checks) and 21 Playwright tests (mock mode 16, production preview 5). Totals now: web unit 178, Playwright 31.

**Raised for the main session (outside this unit's files):**
1. Add `apps/web/src/routeTree.gen.ts` to the root `.prettierignore`: the router plugin formats at 80 columns and the repo uses 100, so `prettier --check` can never pass on the generated file. (ESLint already ignores it.)
2. The Node 22.12 shim in `apps/web/test-node-shim.mjs` is still needed for jsdom (FND-12 note).

## Open questions
- **Resolved:** the guard uses the Query cache (`ensureQueryData`, `staleTime` 5 min) and refetches on a 401.
