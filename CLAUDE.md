# Mockbench — standing rules

Self-hosted mock API server. Teams run it on a laptop or one box on the office LAN, define routes and response shapes in a web UI, publish a version, and anyone on the network calls the endpoints over plain HTTP. **There is no hosted version and never will be.**

These rules are inherited by every session and every subagent. They are pulled from `docs/DESIGN.md`; if one conflicts with DESIGN.md, stop and ask.

## Read first (in this order, nothing else unless the spec says so)

1. The spec you were handed: `docs/specs/<ID>-*.md`
2. The **Contract** section of each spec in its `Depends on`
3. This file, `docs/API-CONTRACT.md`, and only the relevant part of `docs/DESIGN.md`
4. `docs/WORKFLOW.md` (how to operate), `docs/TEAMS.md` (what you may touch)

Source of truth: `docs/DESIGN.md` (product + architecture) and `docs/API-CONTRACT.md` (HTTP surface, frozen after Phase 1). Visual reference: `design-reference/prototype.html` — tokens, type, layout and component vocabulary only. **Never port its JavaScript.**

## Stack (decided — do not relitigate; see `docs/decisions/`)

| Layer      | Choice                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Runtime    | Node 22 LTS, TypeScript 5.x, ESM everywhere                                                    |
| HTTP       | **Express 5 on plain Node.** Never NestJS, never Fastify, never a framework layered on Express |
| Database   | PostgreSQL 16, Drizzle ORM, SQL migrations checked in                                          |
| Validation | Zod 4 (ADR 0016), defined once in shared packages                                              |
| Auth       | Argon2id + opaque session token in an httpOnly cookie, `sessions` table. No JWT                |
| Frontend   | React 19, Vite, TanStack Router / Query / Table / Form, Tailwind, shadcn/ui                    |
| Logging    | pino, JSON to stdout. No log files                                                             |
| Packages   | pnpm workspaces. Tests: Vitest                                                                 |
| License    | MIT                                                                                            |

No Redis. No message broker. No ORM other than Drizzle. No second HTTP framework. A new runtime dependency needs a line in the spec's Contract section.

## Structural rules

- **Two planes, one process.** Control plane `/api/v1/*` (authenticated, rich validation, writes DB) and data plane `/mock/:slug/*` (unauthenticated, read-only, answers from an in-process cache, touches the DB not at all on the hot path). Separate Express routers, separate middleware stacks, separate error handlers, separate logging. Control-plane code never imports data-plane code and vice versa; shared code lives in `packages/*` or `apps/api/src/{db,http,access}`.
- **schema-core purity.** `packages/schema-core` (MockSchema types, Zod validator, generator, presets engine, inference) is imported by the API _and_ the browser. It must contain **no Node APIs** (`node:*`, `Buffer`, `process`, `fs`, `crypto` module, `crypto.subtle`), no database, no HTTP. Enforced by ESLint + a browser-platform bundle test; do not weaken either. It is the project's public contract: change it only through the main session.
- **Contract-first.** The API contract lives as Zod schemas in `packages/api-contract` (an endpoint registry). The Express app wires handlers from the registry; the web client, OpenAPI document (`/api/v1/openapi.json`) and `docs/API-CONTRACT.md` are derived from or checked against it. Never hand-write a request/response type that the registry already defines.
- **Draft vs published.** `routes`/`response_cases` are the draft; editing them never changes what consumers see. Only `projects.active_version_id` does, and only a deploy changes it. Versions are immutable.
- **Generation is `f(key, type, ordinal)`**, deterministic and legible (`role-1`). Baked at publish unless the project is in `random` mode.

## Frontend rules

- **Dark mode only.** One theme. No light mode, no toggle, no `dark:` variants.
- Tokens come from the Tailwind theme extracted from the prototype. **Components reference tokens, never literal hex/rgb.** Fonts: **Archivo** for UI, **IBM Plex Mono** for every path, key, value, status code and code block. Fonts are self-hosted via npm packages — never Google Fonts or any CDN (the prototype's `<link>` to Google Fonts is a prototype shortcut).
- All server access goes through the typed client in `apps/web/src/lib/api`. No `fetch` in components. Server state in TanStack Query; selected case/route lives in the URL.
- The schema builder state is a normalised store (not TanStack Form). Preview calls `schema-core` locally.

## LAN-only threat model (hard requirements)

- Trusted private network. No telemetry, no analytics, no update checks, **no outbound network calls at runtime**, no CDN assets, no remote fonts, no external fetch of `$ref`s or URLs.
- The data plane has no authentication by design. Never imply the app is safe to expose to the internet.
- Containers bind `0.0.0.0`. The compose port mapping exposes the host interface. Postgres is never published.
- **The frontend never hardcodes `localhost` / `127.0.0.1`.** All API calls are relative (`/api/v1/...`). The mock base URL shown anywhere in the UI is derived from `window.location` at runtime (`apps/web/src/lib/mock-url.ts`), never baked at build time.
- Session cookie: `HttpOnly; SameSite=Lax; Path=/`, **no `Domain`**, `Secure` **off** by default (plain HTTP on a LAN IP must work), on only when `COOKIE_SECURE=true`.
- Data plane answers `OPTIONS` **before** route matching with permissive CORS (unless the project's CORS setting is `off`).
- **A LAN IP over HTTP is not a secure context.** `crypto.subtle`, `crypto.randomUUID`, `navigator.clipboard` and service workers are unavailable. Browser code must not depend on them without a fallback; `schema-core` ships its own synchronous SHA-1 for UUID v5.
- One stateful volume: `pgdata`. Logs to stdout. SPA baked into its image.

## Conventions

- JSON field names are camelCase; DB columns snake_case. IDs are UUID v7 strings. Timestamps are ISO-8601 UTC.
- Errors: always the envelope `{ error, message, details }` via the shared `HttpError` helper; never hand-build an error response.
- Zod validation at the edge of every handler, from the registry. Unknown keys in request bodies are rejected (422) — **except inside MockSchema nodes, where unknown keys are preserved and ignored** (reserves `source` for the future importer).
- Conventional commits (`feat(runtime): …`, `fix(builder): …`). One spec = one branch = one PR: `team/<team>/<spec-id>`.
- Tests: Vitest. Name the cases the spec names. The generator gets disproportionate coverage (golden snapshots + property tests).

## File ownership

Every team owns specific directories exclusively (`docs/TEAMS.md`). **Never edit a shared file your team does not own. Raise it instead.** Shared, main-session-only files:

- root `package.json`, `tsconfig*`, `pnpm-workspace.yaml`, `eslint`/`prettier` config, `.github/`
- `apps/api/src/db/` (Drizzle schema + migrations)
- `packages/api-contract/`
- `packages/schema-core/`
- `apps/web/src/routes/` (TanStack Router route tree) and `routeTree.gen.ts`
- Tailwind theme (`apps/web/src/styles/`), `apps/web/src/components/ui/`
- `apps/api/src/{app.ts,config.ts,http/,access/}`, `docker/`, `docker-compose*.yml`, `.env.example`

## Workflow (full text: `docs/WORKFLOW.md`)

1. Read the spec and its dependencies' Contract sections. Nothing else.
2. Confirm the spec still matches the code; raise drift before coding.
3. Implement only what is **in scope**. Out-of-scope discoveries go into that unit's spec or a new spec — not this commit.
4. **If a design decision comes up that DESIGN.md and API-CONTRACT.md do not cover, STOP and ask.** Never decide it silently in code. Record the answer as an ADR and amend the spec. Absolute for subagents.
5. If implementation forces a change to DESIGN.md or API-CONTRACT.md, change the document in the same commit and say so.
6. Update the spec's `Status:` and tick its acceptance criteria as you go. The build stays green and the app stays runnable at the end of every unit.

## Commands (created by FND-01; do not assume they exist before it merges)

`pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm contract:docs` (regenerate API-CONTRACT.md appendix + openapi check) · `pnpm db:generate` · `pnpm db:migrate` · `docker compose up`
