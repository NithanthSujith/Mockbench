# FND-01 — Monorepo, tooling, CI skeleton

Status: done
Phase: 1   Team: Core
Depends on: none
Size: M

## Goal
A pnpm-workspace monorepo with the layout from DESIGN.md, one command each for typecheck, lint, test and build, a green `ci` workflow, and the MIT license, so every later unit has somewhere to land. The apps and packages exist as empty, buildable placeholders.

## In scope
- Workspace layout: `apps/api`, `apps/web`, `packages/schema-core`, `packages/api-contract`, `packages/tsconfig`, `docker/`, `examples/`, `e2e/`; Node 22 (`.nvmrc`, `engines`), ESM, TypeScript project references, shared tsconfig presets.
- ESLint (flat config) + Prettier + Vitest root config, including the **custom rules** below; root scripts `dev`, `build`, `typecheck`, `lint`, `test`, `contract:docs` (placeholder until FND-06).
- `.github/workflows/ci.yml` (typecheck, lint, test, build on PR and push to `main`) and the **ownership check** script; `LICENSE` (MIT), `.gitignore`, `.editorconfig`, `.env.example` skeleton.

## Out of scope
Any application, schema-core or contract code (placeholders only). Docker files (FND-14). e2e/docker/codeql workflows (XC-01, REL-02, REL-03). Choosing npm package scope beyond a placeholder.

## Contract
- Workspace names: `@mockbench/api`, `@mockbench/web`, `@mockbench/schema-core`, `@mockbench/api-contract`, `@mockbench/tsconfig`.
- Root scripts as above; each package exposes the same four scripts.
- ESLint rules (the enforcement CLAUDE.md promises):
  1. `packages/schema-core/**` and `packages/api-contract/src/**` may not import `node:*` or `fs|path|crypto|os|child_process|http|net|buffer|process`, nor reference `Buffer`/`process`.
  2. `apps/web/src/**` may not contain string literals matching `localhost` or `127.0.0.1` (the vite config is exempt).
  3. `apps/web/src/**` (except `src/styles/**`) may not contain colour literals (`#rgb[a]`, `rgb(`, `hsl(`).
  4. `apps/web/src/**` may not call `fetch` outside `src/lib/api/**`.
- `scripts/ownership.json` maps team → owned globs (derived from `docs/TEAMS.md`); `scripts/check-ownership.mjs <branch> <changed-files…>` exits non-zero when a branch `team/<team>/<id>` changes a path outside its globs or inside the shared-file list.
- Pre-declared dependencies: **amended during FND-01** - only root tooling is installed here (typescript 5, eslint 9, vitest, prettier, picomatch). Each app/package dependency from TEAMS.md 2.3 is installed by the unit that first needs it (FND-10 api, FND-12/13 web, AUTH-02 argon2 implementation, etc.), since pinning libraries before any code uses them cannot be verified. Per-app `package.json` files and `pnpm-lock.yaml` are open to every team in the ownership check; the root manifest is not.
- Node 22 is enforced by a root `preinstall` script (`scripts/check-node.mjs`), not `engine-strict`: several current dependencies require Node >=22.13 and `engine-strict` would reject the whole 22.x line below that. ESLint is pinned to 9.x for the same reason (ESLint 10 needs >=22.13).

## Acceptance criteria
- [x] `pnpm install --frozen-lockfile` succeeds from a clean clone on Node 22 and fails with a clear message on Node 20. *(Node 20 failure verified by simulating the version in the preinstall script, not on a real Node 20.)*
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` each exit 0 across all workspaces with placeholder code.
- [x] A fixture file in `packages/schema-core` importing `node:fs` makes `pnpm lint` exit non-zero (asserted by a lint-rule test).
- [x] A fixture in `apps/web/src` containing `"http://localhost:3000"`, one containing `#fff`, and one calling `fetch(` each fail lint; the same text in `apps/web/vite.config.ts` does not.
- [x] `check-ownership.mjs team/auth/AUTH-01 apps/api/src/db/schema.ts` exits 1; `… apps/api/src/modules/auth/x.ts docs/specs/AUTH-01-session-core.md` exits 0; `… team/builder/BLD-01 apps/api/src/modules/auth/x.ts` exits 1.
- [x] `ci.yml` passes `actionlint` and runs on both `pull_request` and `push` to `main`. *(actionlint v1.7.12 clean; first push run failed only because the FND-08 DB tests need Postgres, fixed by a Postgres 16 service in the workflow; run 42084017950 green. The `pull_request` trigger is configured but only the `push` path has run.)*
- [x] `LICENSE` is MIT, 2026, "Mockbench contributors".
- [x] `pnpm contract:docs` exists and prints "not implemented until FND-06" with exit 0.

## Tests
Vitest tests for `check-ownership.mjs` (the three cases above plus a non-team branch name → exit 0). ESLint `RuleTester`-style fixtures for rules 1–4.

## Open questions
- npm scope (`@mockbench/*` assumed) and whether the name is available.
- Prettier + ESLint (assumed) versus Biome.
- Exact Node 22 minor pin.
