# FND-06 — api-contract: primitives, registry, OpenAPI and docs generators

Status: done
Phase: 1   Team: Core
Depends on: FND-01, FND-02
Size: M

## Goal
`packages/api-contract` has the machinery that makes the HTTP contract executable: shared Zod primitives, an endpoint-registry type, an OpenAPI 3.1 generator, and a drift checker against `docs/API-CONTRACT.md` — before any endpoint is defined.

## In scope
- Primitives: `Id`, `Timestamp`, `Slug`, `ErrorEnvelope`, `ValidationIssue`, `paginated(item)`, `PageQuery`, the global error list.
- `defineEndpoint()` and `defineRegistry()` with load-time uniqueness checks; `Handler` typing helpers keyed by endpoint id.
- `generateOpenApi(registry)` (separate entry point so the web bundle excludes it) and `pnpm contract:docs [--check]`.
- Settle **D1** (Zod 3 vs 4) by checking the OpenAPI generator library and TanStack Form integration against each, and record it as an ADR.

## Out of scope
Concrete endpoints and resource schemas (FND-07). Express wiring (FND-10). The web client (FND-13).

## Contract
```ts
defineEndpoint({ id, method, path /* '/projects/:projectId' */, auth: 'public'|'session'|'viewer'|'editor'|'owner',
  params?, query?, body?, responses: Record<number, ZodTypeAny | null>, errors: { status: number; code: string }[],
  example: { request?: unknown; response?: unknown }, tags: string[] })
defineRegistry(endpoints[]): Registry     // throws on duplicate id or duplicate method+path
type HandlerFor<E> = (ctx: Ctx, input: { params; query; body }) => Promise<Response<E>>   // typed from the endpoint
export * from './primitives'; export { generateOpenApi } from '@mockbench/api-contract/openapi'
```
Drift check (`--check`): parses the §3 tables of `docs/API-CONTRACT.md`, reading the `id`, `Endpoint` and `Auth` columns (and the `Errors` column's codes), and compares them with the registry in both directions.

## Acceptance criteria
- [x] `defineRegistry` throws at import time on two endpoints with the same `id`, and on two with the same method + normalised path. *(test/registry.test.ts: duplicate id, duplicate method+normalised path incl. case-folding and aliases)*
- [x] `ErrorEnvelope.parse({error:"x",message:"y",details:[]})` passes; omitting `details`, or `details: {}` , fails. *(test/primitives.test.ts)*
- [x] `paginated(Item).parse({items:[…],nextCursor:null})` passes and `nextCursor: 5` fails. *(test/primitives.test.ts)*
- [x] `generateOpenApi` on a two-endpoint test registry produces a document that validates against the OpenAPI 3.1 meta-schema (via `@apidevtools/swagger-parser`, a dev-dependency only) and includes the shared `ErrorEnvelope` component and the session-cookie security scheme. *(test/openapi.test.ts validates with @apidevtools/swagger-parser 13.1 for the two-endpoint registry and a 4-endpoint one with query, pagination and a 204; ErrorEnvelope is hoisted via Zod 4 `.meta({ id })`, so `extendZodWithOpenApi` is not needed)*
- [x] The web build importing `@mockbench/api-contract` contains no `node:` builtin and none of the OpenAPI generator code. *(verified by static import-graph inspection (test/purity.test.ts): the main entry reaches only `zod`; the generator is the separate `./openapi` subpath. A real browser-bundle test is not added because esbuild is not a dependency; FND-05 adds that for schema-core)*
- [x] `pnpm contract:docs --check` exits 1 with a message naming the offending id when a registry entry has no row in the doc, a doc row has no registry entry, or the Auth/method/path differ; exits 0 when equal (tested with fixture docs). *(scripts/contract-docs.test.ts: fixture docs in both directions plus the real document; also exercised end to end against a temporary registry, which named the offending ids and exited 1)*
- [x] The D1 decision and the library versions chosen are recorded in `docs/decisions/0016-zod-version.md` (created by the main session before FND-02; versions line added after this unit). *(ADR 0016 records the decision and the library family but not the exact versions; adding "zod 4.6.7, @asteasolutions/zod-to-openapi 9.1.0, @apidevtools/swagger-parser 13.1.0" is a one-line edit outside this unit's file scope.)*

## Tests
Registry uniqueness, primitive parse tables, OpenAPI document validity, doc-drift fixtures in both directions.

## Clarifications made while implementing
- **The generator is NOT re-exported from the main entry.** The Contract block's `export { generateOpenApi } from '@mockbench/api-contract/openapi'` contradicts "separate entry point so the web bundle excludes it"; the subpath export `./openapi` is added to `packages/api-contract/package.json` and the main entry stays free of it.
- **Registry paths are relative to `/api/v1`** (`/auth/login`). The drift check strips a leading `/api/v1` from doc paths. Endpoints mounted at more than one place (healthz/readyz) declare the extra relative paths in an optional `aliases` field; the doc's `GET /healthz and GET /api/v1/healthz` collapse to the same relative path, so they need no alias.
- **Registry export name:** FND-07 must export the registry as `registry` from the package main entry; the CLI loads it through Vite's SSR loader (`createViteServer` from `vitest/node`, no new dependency). With no `registry` yet, plain `pnpm contract:docs` exits 0 with a message and `--check` **fails closed** (exit 1) naming FND-07.
- **Drift normalisation** is defined at the top of `scripts/contract-docs-lib.mjs`: first `METHOD /path` per row is primary; auth = first of public|session|viewer|editor|owner; errors compared as `NNN code` pairs with the global codes and `unauthenticated`/`forbidden`/`not_found` ignored on both sides; a row whose cell count differs from its header is reported as `malformed_row`.
- **Found by the checker:** the `projects.import` row in API-CONTRACT.md section 3.11 has 5 cells under a 6-column header (it has no Response cell, e.g. `201 Project`). `--check` will report it until the doc is fixed. The doc currently has **53** endpoint ids in section 3.
- `PageQuery` defaults `limit` to 50 (Zod `.default`); `Id` is `z.uuid()` (any RFC 9562 version accepted on input).
- `HandlerContext` is an intentionally empty interface for FND-10 to extend by declaration merging. `AreaHandlers<R, Area>` provides the compile-time "a module may bind only its own area's ids" check FND-10 needs.
- Tests live in `packages/api-contract/test/` (outside `src/`, so they may use Node APIs for the purity inspection); `typecheck` also runs `tsc -p tsconfig.test.json`.

## Open questions
- ~~D1 itself~~ - resolved by ADR 0016 (Zod 4).
- ~~OpenAPI library choice~~ - resolved: `@asteasolutions/zod-to-openapi` 9.1.0 (needs Zod 4).
