# FND-06 — api-contract: primitives, registry, OpenAPI and docs generators

Status: approved
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
- [ ] `defineRegistry` throws at import time on two endpoints with the same `id`, and on two with the same method + normalised path.
- [ ] `ErrorEnvelope.parse({error:"x",message:"y",details:[]})` passes; omitting `details`, or `details: {}` , fails.
- [ ] `paginated(Item).parse({items:[…],nextCursor:null})` passes and `nextCursor: 5` fails.
- [ ] `generateOpenApi` on a two-endpoint test registry produces a document that validates against the OpenAPI 3.1 meta-schema (via `@apidevtools/swagger-parser`, a dev-dependency only) and includes the shared `ErrorEnvelope` component and the session-cookie security scheme.
- [ ] The web build importing `@mockbench/api-contract` contains no `node:` builtin and none of the OpenAPI generator code.
- [ ] `pnpm contract:docs --check` exits 1 with a message naming the offending id when a registry entry has no row in the doc, a doc row has no registry entry, or the Auth/method/path differ; exits 0 when equal (tested with fixture docs).
- [ ] The D1 decision and the library versions chosen are recorded in `docs/decisions/0016-zod-version.md`.

## Tests
Registry uniqueness, primitive parse tables, OpenAPI document validity, doc-drift fixtures in both directions.

## Open questions
- D1 itself (see PLAN § 8).
- OpenAPI library choice (`zod-to-openapi`-style versus native JSON-Schema conversion) — decided with D1.
