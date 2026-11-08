# FND-07 — api-contract: every endpoint, errors, examples, shared validators

Status: done
Phase: 1   Team: Core
Depends on: FND-06, FND-04
Size: L

## Goal
Every control-plane endpoint in `docs/API-CONTRACT.md` §3 exists in the registry with its request/response Zod schemas, error codes and an example payload, and the cross-team validators (route-path grammar and normalisation, slug, headers, case name) live here once, so the contract is executable and drift is a CI failure.

## In scope
- Registry entries for all endpoints in §3 (about 60 including aliases) and the resource schemas in §2; data-plane constants (`MOCK_HEADERS`, `SELECTOR_ORDER`, mock-error body schema, `RESERVED_SLUGS`).
- Shared validators: `parseRoutePath`, `normalizePath`, `isReservedSlug`, `validateCaseHeaders`, `CASE_STATUS_CODES`.
- Example payloads (used by docs, OpenAPI and MSW), and a green `pnpm contract:docs --check` against the committed API-CONTRACT.md.

## Out of scope
Any handler, DB access, UI. Changing the contract's meaning — if the prose and the schemas disagree, the prose in API-CONTRACT.md wins and the schema is fixed.

## Contract
- Exports: every resource type as `z.infer` (`Project`, `Route`, `ResponseCase`, `Preset`, `Version`, `Snapshot`, `VersionDiff`, `RequestLogEntry`, `ProjectExport`, …), the `registry`, per-area endpoint maps (`endpoints.auth`, `endpoints.projects`, …), and the validators above.
- `parseRoutePath(path): { ok: true; segments: ({ static: string } | { param: string })[] } | { ok: false; issues }`; `normalizePath(path): string` = static segments lowercased, params → `{}` (`/Users/:id` → `/users/{}`).
- `validateCaseHeaders(h): Issue[]` with issue code `reserved_header` for the §1.7 forbidden names.

## Acceptance criteria
- [x] `pnpm contract:docs --check` exits 0: every `id`/method/path/auth in API-CONTRACT.md §3 matches the registry and vice versa, and every error code in an `Errors` column appears in that endpoint's `errors`.
- [x] Every endpoint's `example.response` parses with its own response schema, and every `example.request` with its body schema.
- [x] `normalizePath("/Users/:id/orders/:oid")` is `/users/{}/orders/{}`, and `/users/:id` and `/users/:userId` normalise equal.
- [x] `parseRoutePath` rejects `/users/`, `//a`, `a`, `/a b`, `/a/:1x`, `/a/:id/:id`, `/a*`, `/a?x=1`, and a 201-char path, each with a distinct issue code; accepts `/`, `/users`, `/users/me`, `/v1/users/:id/orders/:orderId`.
- [x] `validateCaseHeaders` rejects `Content-Length`, `X-Mock-Foo`, `access-control-allow-origin`, `Proxy-Authorization`, a value containing `\n`, and 21 entries; accepts `Cache-Control`, `X-Request-Id`, `Content-Type`.
- [x] `isReservedSlug` is true for `api`, `mock`, `health`, `static`, `assets`, `admin`; `Slug` rejects `Api`, `ab`, `a_b`, `-a`, `a--b`, a 41-char slug.
- [x] `projects.update`'s body schema rejects an unknown key and a `slug` key (`read_only`), accepts `{}`, and accepts `description: null` but rejects `name: null`.
- [x] `generateOpenApi(registry)` validates as OpenAPI 3.1, contains every control-plane path, and contains no `/mock` path.
- [x] The built web bundle importing the package contains no `node:` builtin. *(Checked by a static import-graph test of the main entry: only `zod` and the browser-safe `@mockbench/schema-core`, never `openapi.ts`; the real browser-platform bundle test arrives with FND-05.)*

## Tests
Table tests for each validator; a test iterating the registry that checks examples; the drift check; one snapshot of the generated OpenAPI `paths` keys.

## Clarifications recorded during implementation
- **Validation issue codes.** Custom Zod checks carry their machine code as `params: { code }` (`reserved_header`, `read_only`, route-path grammar codes, `invalid_case_name`, ...). `toValidationIssues(zodError)` (exported) turns a ZodError into the `{ path, code, message }` list for `details`: custom issues keep their own code, `unrecognized_keys` becomes one issue per unknown key (path ending at the key). FND-10 must use it for every 422.
- **PATCH bodies** are built with `patchBody(fields, readOnlyKeys)`: every field optional, `null` only where the field is `.nullable()`, read-only keys fail with code `read_only` (path = the key), unknown keys with `unrecognized_keys`.
- **Slug is format-only.** `Slug` / `isReservedSlug` are separate: a reserved slug passes the schema so the handler can answer `422 slug_reserved` (a distinct top-level code), not `validation_failed`.
- **`alsoAtRoot`** (new optional field on `EndpointDef`, in `registry.ts`): `system.healthz` and `system.readyz` are registered at `/healthz` and `/readyz` relative to `/api/v1` (so `/api/v1/healthz`), with `alsoAtRoot: true` meaning FND-10 also mounts them at the bare root for container healthchecks. The doc checker normalises both spellings to the same path, so no alias entry is needed.
- **Registry uniqueness** now uses the canonical `normalizePath` (was a private copy).
- **Request-body details the doc left open:** `auth.login` accepts a 1-128 char password (the 8-char policy applies to register and change-password only, so login never reveals the policy); `versions.publish` `notes` is at most 2000 chars and `label` is trimmed, 1-80; preset `priority` is an int32; `projects.getBySlug` accepts any 1-64 char slug param (a malformed slug is a 404, not a 422); `requests.list` filters are `status` (`404` or `4xx`), `method` (3-10 letters), `path` (1-200 chars), `since` (ISO datetime with offset), `mockError` (`true`|`false`); `system.openapi` returns a generic JSON object.
- **OpenAPI and recursive schemas.** schema-core's `MockNode` and preset-rule schemas are recursive (`z.lazy`/`z.json`), which the OpenAPI generator cannot expand (stack overflow). `resources.ts` therefore registers an OpenAPI `type` (and id) for schema-core's exported `mockNodeZod` and `PresetRuleSchema` instances and for a contract-level `JsonValue`, so the document names them as components and stops there. Runtime validation is unaffected. The cleaner fix is to give `mockNodeZod` an id in schema-core itself; deferred because schema-core is frozen to this unit.
- **`scripts/contract-docs.test.ts`** (FND-06) detected "no registry yet" by looking for `export const registry`; it now also recognises the re-export, so its two obsolete no-registry tests skip. They can be deleted.

## Open questions
- Whether `ProjectExport` should carry a `generator` hint (excluded for stable diffs).
- Whether the OpenAPI document should expose an `x-mockbench-auth` extension for role levels (assumed yes).
