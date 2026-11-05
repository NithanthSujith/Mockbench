# FND-07 — api-contract: every endpoint, errors, examples, shared validators

Status: approved
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
- [ ] `pnpm contract:docs --check` exits 0: every `id`/method/path/auth in API-CONTRACT.md §3 matches the registry and vice versa, and every error code in an `Errors` column appears in that endpoint's `errors`.
- [ ] Every endpoint's `example.response` parses with its own response schema, and every `example.request` with its body schema.
- [ ] `normalizePath("/Users/:id/orders/:oid")` is `/users/{}/orders/{}`, and `/users/:id` and `/users/:userId` normalise equal.
- [ ] `parseRoutePath` rejects `/users/`, `//a`, `a`, `/a b`, `/a/:1x`, `/a/:id/:id`, `/a*`, `/a?x=1`, and a 201-char path, each with a distinct issue code; accepts `/`, `/users`, `/users/me`, `/v1/users/:id/orders/:orderId`.
- [ ] `validateCaseHeaders` rejects `Content-Length`, `X-Mock-Foo`, `access-control-allow-origin`, `Proxy-Authorization`, a value containing `\n`, and 21 entries; accepts `Cache-Control`, `X-Request-Id`, `Content-Type`.
- [ ] `isReservedSlug` is true for `api`, `mock`, `health`, `static`, `assets`, `admin`; `Slug` rejects `Api`, `ab`, `a_b`, `-a`, `a--b`, a 41-char slug.
- [ ] `projects.update`'s body schema rejects an unknown key and a `slug` key (`read_only`), accepts `{}`, and accepts `description: null` but rejects `name: null`.
- [ ] `generateOpenApi(registry)` validates as OpenAPI 3.1, contains every control-plane path, and contains no `/mock` path.
- [ ] The built web bundle importing the package contains no `node:` builtin.

## Tests
Table tests for each validator; a test iterating the registry that checks examples; the drift check; one snapshot of the generated OpenAPI `paths` keys.

## Open questions
- Whether `ProjectExport` should carry a `generator` hint (excluded for stable diffs).
- Whether the OpenAPI document should expose an `x-mockbench-auth` extension for role levels (assumed yes).
