# FND-13 — Web skeleton: route tree, typed client, shell, mock mode

Status: approved
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
- [ ] Visiting each route path in the contract table renders its stub inside the shell with the correct `features/<area>` stub; an unknown path renders a not-found screen inside the shell.
- [ ] `apps/web/src` contains no `localhost`/`127.0.0.1`/colour literal/raw `fetch` (FND-01 lint rules pass with real code); the only `localhost` is in `vite.config.ts`.
- [ ] A unit test with jsdom at `http://192.168.1.24:8080` shows `getMockBaseUrl('demo')` is `http://192.168.1.24:8080/mock/demo`; at `http://mockbench.office:3000` it is `http://mockbench.office:3000/mock/demo`.
- [ ] `api.projects.list({query:{workspaceId}})` issues `fetch('/api/v1/projects?workspaceId=…')` (relative URL), and a `POST` carries `X-Mockbench-Client: web`.
- [ ] `ApiError` is thrown for a `404` envelope with `code` and `details` populated; a `401` response redirects once to `/login` and does not loop.
- [ ] `pnpm --filter web dev:mock` serves every endpoint from the registry's `example` payloads with no backend running, and the shell renders against them.
- [ ] `vite preview --host 0.0.0.0` is reachable from the machine's LAN IP and the app loads (CI curls the non-loopback address).
- [ ] The route tree compiles with `routeTree.gen.ts` committed; `pnpm typecheck` fails if a route file imports from a feature directory that does not exist.
- [ ] At widths ≥1240, 860–1240 and <860 px the shell reproduces the prototype's three, two and one-column layouts (Playwright screenshots at three widths reviewed against the prototype).

## Tests
Vitest for client/`mock-url`/query keys; Playwright smoke for route rendering and layout widths; MSW-mode smoke.

## Open questions
- Whether the guard should call `auth.me` on every navigation or rely on the Query cache (assumed: cache with `staleTime`, refetch on 401).
