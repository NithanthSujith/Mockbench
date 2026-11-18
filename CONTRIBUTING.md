# Contributing to Mockbench

Thanks for helping. This page gets you from a clean machine to a running dev environment in about five minutes, then explains how changes are planned, written and merged.

Mockbench is a self-hosted mock API server for a trusted LAN. There is no hosted version. Please keep that in mind: no telemetry, no outbound network calls at runtime, no CDN assets, and the mock endpoints have no authentication by design.

## Prerequisites

- **Node 22** (the exact minor is in `.nvmrc`; `nvm use` or `fnm use` picks it up).
- **pnpm** through Corepack: run `corepack enable` once. The pnpm version is pinned in `package.json`.
- **Docker** with Compose v2 (Docker Desktop on Windows and macOS).
- Git. On Windows, run the commands below in Git Bash or WSL.

## Five-minute setup

There are two ways to run Mockbench while you work on it.

### A. Postgres in Docker, apps on your machine (for development)

Hot reload for both apps. The API runs on port 3000 and the UI on Vite's port 5173, which proxies `/api` and `/mock` to the API.

<!-- contributing-smoke:start -->

```sh
pnpm install
cp .env.example .env
echo 'DATABASE_URL=postgres://mock:mock@127.0.0.1:5432/mockserver' >> .env
docker compose -f docker-compose.dev.yml up -d --wait
pnpm db:migrate
pnpm dev
```

<!-- contributing-smoke:end -->

Open <http://localhost:5173> and register; the first account owns the `default` workspace. With `SEED_DEMO=true` (the default in `.env`), `curl http://localhost:5173/mock/demo/users` answers straight away.

- Port 5432 taken? Set `DEV_DB_PORT=5433` before `docker compose ... up` and use that port in `DATABASE_URL`.
- The dev database is published on `127.0.0.1` only and lives in its own volume (`pgdata_dev`). `docker compose -f docker-compose.dev.yml down -v` wipes it.
- UI work with no backend at all: `pnpm --filter @mockbench/web dev:mock` serves the UI with fake data. The component gallery is at `/_dev/ui` in dev.

### B. Everything in Docker (to try the real build)

```sh
cp .env.example .env
docker compose up --build
```

Open <http://localhost:8080> or `http://<your LAN IP>:8080`. This is the same stack users run. Rebuild after each change.

## Running the checks

CI runs these on every PR. Run them before you push:

```sh
pnpm typecheck
pnpm lint
pnpm format:check     # pnpm format fixes it; run prettier from the repo root only
pnpm test
pnpm build
pnpm contract:docs --check
```

Most API tests need a Postgres 16 to create throwaway databases in. They read `TEST_DATABASE_URL`, which defaults to `postgres://mock:mock@127.0.0.1:55432/postgres`. One way to provide it:

```sh
docker run -d --name mockbench-test-pg -e POSTGRES_USER=mock -e POSTGRES_PASSWORD=mock -p 127.0.0.1:55432:5432 postgres:16-alpine
```

The end-to-end suite (`pnpm e2e`) builds and runs the compose stack and drives it with Playwright. It takes a few minutes; CI runs it on every PR.

If the web tests time out on a busy machine, run them with `pnpm --filter @mockbench/web exec vitest run --maxWorkers=2`.

## How work is planned: specs and ADRs

Read [`CLAUDE.md`](CLAUDE.md) first. It holds the standing rules (stack, structure, LAN threat model, conventions) and applies to people and AI agents alike.

- **`docs/DESIGN.md`** is the source of truth for product and architecture. **`docs/API-CONTRACT.md`** is the HTTP surface, generated from and checked against the Zod registry in `packages/api-contract`.
- **Specs** (`docs/specs/<ID>-*.md`) describe one unit of work each: goal, in scope, out of scope, contract, acceptance criteria. One spec is one branch and one PR. A spec's `Status:` moves `draft → approved → in progress → done`, and its criteria are ticked as they are met.
- **ADRs** (`docs/decisions/NNNN-*.md`) record decisions that DESIGN.md does not cover. If you hit such a decision, stop and ask in the issue or PR; do not decide it silently in code.
- **Ownership.** `docs/TEAMS.md` lists which directories each area owns. Some files are shared and change only with a maintainer: the root configs, `.github/`, the database schema and migrations, `packages/api-contract`, `packages/schema-core`, the route tree, the Tailwind theme and `components/ui`, and `apps/api/src/{app.ts,config.ts,http/,access/}`. If your change needs one of them, say so in the PR.

For a small fix you do not need a spec. For a new feature, open a feature issue first so the scope can be agreed and written down.

Good places to start are listed in [`docs/good-first-issues.md`](docs/good-first-issues.md).

## Commits, pull requests and changesets

- **Conventional commits.** PRs are squash-merged, so the **PR title** becomes the commit on `main` and must be a conventional commit: `feat(runtime): …`, `fix(builder): …`, `docs: …`. CI checks the title. Commits on your branch can be anything.
- **Branches:** `team/<area>/<SPEC-ID>` for spec work, anything descriptive otherwise.
- **Changesets.** If your PR changes what ships (non-test, non-doc files in `apps/api`, `apps/web`, `packages/schema-core` or `packages/api-contract`), run `pnpm changeset`, choose the bump, write one line for the changelog and commit the generated file. Maintainers add the `no-changeset` label to PRs that change nothing user-visible. CI enforces this.
- **Behaviour changes update the docs in the same PR:** the spec, and `docs/API-CONTRACT.md` or `docs/DESIGN.md` if they are affected.
- Fill in the PR template's checklist.

## Reporting bugs and security issues

Use the issue templates. Include the Mockbench version (`MOCKBENCH_VERSION` or the commit), how you run it, the steps, and what you expected versus what happened.

Do not report a security problem in a public issue. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). Remember the threat model: the data plane is unauthenticated by design and Mockbench must not be exposed to the internet, so "anyone on the LAN can call a mock" is expected behaviour.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By taking part you agree to it.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE). No CLA and no DCO sign-off are required.
