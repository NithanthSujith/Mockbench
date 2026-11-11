# RUN-04 — Compiled version: radix matcher and case selection

Status: done
Phase: 2   Team: Runtime
Depends on: FND-07
Size: M

## Goal
A pure, allocation-light module compiles a stored snapshot (+ baked text) into a structure that matches a request to a route and selects a case exactly as API-CONTRACT §4 specifies — with no database and no HTTP.

## In scope
- `compileVersion(snapshot, bakedText)`: segment tree per method, baked-body lookup, route listing, byte-size estimate for the LRU.
- `match(method, path)` with static-over-param precedence **with backtracking**, case-insensitive statics, trailing-slash and query tolerance, `HEAD`→`GET` fallback.
- `selectCase(route, { caseHeader, caseQuery, statusHeader })` per the selector order and no-fall-through rule.

## Out of scope
Express handlers, delays, headers, CORS, caching, logging (RUN-05/06/07).

## Contract
```ts
compileVersion(snapshot: Snapshot, baked: string | null): CompiledVersion
type CompiledVersion = { label: string; projectId: string; slug: string; settings: ProjectSettings; bytes: number
  match(method: string, rawPath: string): { route: CompiledRoute; params: Record<string,string> } | null
  routes(): { method: Method; path: string }[]
  selectCase(route: CompiledRoute, sel: { caseHeader?: string; caseQuery?: string; statusHeader?: string }):
    { ok: true; case: CompiledCase } | { ok: false; available: { name: string; statusCode: number; isDefault: boolean }[] }
  body(c: CompiledCase): string | null }       // null in random mode
```
Path normalisation must reuse `parseRoutePath`/`normalizePath` from `@mockbench/api-contract`.

## Acceptance criteria
- [x] `/users/me` matches the static route over `/users/:id`; `/users/42` matches `:id` with `params.id === "42"`.
- [x] Backtracking: with only `GET /users/:id/orders` defined, `/users/me/orders` matches it (the static branch for `me` does not swallow the request); with both `/users/me` and `/users/:id/orders`, `/users/me/orders` still matches the second.
- [x] `/Users/42/`, `/users/42` and `/users/42?x=1` all match the same route; `/users//42` and `/users/42/extra` do not.
- [x] A `HEAD` request matches the `GET` route; a `POST` to a GET-only path returns `null` (not a 405 concept here).
- [x] Percent-encoded static segments match their decoded form; a malformed escape (`/%E0%A4%A`) returns `null` without throwing.
- [x] `selectCase`: `caseHeader` matches by name (trimmed, case-insensitive) and by id; `caseQuery` is used only when the header is absent; `statusHeader` selects the **first by sort order** among cases with that status; with none present the default is returned.
- [x] A present-but-unmatched selector returns `ok:false` with `available` (name, status, default) even if a later selector would have matched (no fall-through).
- [x] `body()` returns the baked string for each case, `""` for a `204` case, and `null` when `baked` was `null`.
- [x] Compiling a 500-route, 1,500-case snapshot takes under 100 ms and 100,000 matches take under 300 ms (raised from 150 ms after a CI run measured 166 ms) on the CI runner (budget test, generous).
- [x] `routes()` lists every `{method, path}` in the snapshot's order (used for the `route_not_found` hint).
- [x] `bytes` ≥ the length of the baked text (so the LRU can bound memory).

## Implementation notes and drift (RUN-04)
Code: `apps/api/src/modules/dataplane/compiled-version.ts`; tests: `compiled-version.test.ts` (40 tests). Nothing is wired into the Phase-1 data-plane stub router: RUN-05 does that.
- **Signature (drift):** `compileVersion(snapshot, baked, label, options?)`. The registry `Snapshot` type has no version label (it lives on the `versions` row), so `label` is a required third parameter; RUN-06 passes `versions.label`. `options.snapshotBytes` (optional, `versions.snapshot_bytes`) is added to the `bytes` estimate.
- **Additive fields RUN-05 needs for `random` mode:** `CompiledCase.schema` (a reference into the snapshot, not a copy) and `CompiledVersion.components` / `.presets`. `CompiledCase` also carries `headers`, `delayMs`, `isDefault`; `CompiledRoute` carries `id`, `description`, `cases`, `defaultCase`.
- **Selector semantics:** a selector is *present* when it is not `undefined`, so an empty `X-Mock-Case:` header is present, matches nothing, and yields `ok:false` (fail loudly). `caseHeader`/`caseQuery` match a case **id** first (case-insensitive), then the trimmed case-insensitive **name**. A non-numeric `statusHeader` matches nothing.
- **Matching details:** `//` is an empty segment and does not match the root route. `#fragment` is stripped like `?query`. Param values are returned decoded, keep their case, and live in a plain object; a param named `__proto__` is defined as an own property so it can never reach the prototype (a null-prototype object was avoided because V8 makes those slow). Methods are matched case-insensitively; anything other than GET/POST/PUT/PATCH/DELETE (and HEAD, served by GET) matches nothing.
- **Compile errors:** `CompileError` is thrown for a snapshot RUN-01 could not have produced: a bad baked payload (not a JSON object, or no body for a non-204 case when baked), an invalid path, a route with no cases, or two routes that collide after normalisation. The cache (RUN-06) should treat it as a load failure, not cache it.
- **`bytes`:** `2 × baked length + 96 × tree nodes + 256 × routes + 512 × cases + snapshotBytes`, a deliberately generous estimate (JS strings can be two bytes per character).
- **Verified by mutation:** removing backtracking fails 2 tests; letting an unmatched selector fall through fails 3.

## Tests
Table-driven match tests (including the backtracking cases), selection table, budget test.

## Open questions
- Whether a trailing `/` in a *defined* route path should be allowed (grammar forbids it; confirmed in API-CONTRACT §1.7).
