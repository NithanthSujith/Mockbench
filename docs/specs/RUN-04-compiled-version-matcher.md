# RUN-04 — Compiled version: radix matcher and case selection

Status: approved
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
- [ ] `/users/me` matches the static route over `/users/:id`; `/users/42` matches `:id` with `params.id === "42"`.
- [ ] Backtracking: with only `GET /users/:id/orders` defined, `/users/me/orders` matches it (the static branch for `me` does not swallow the request); with both `/users/me` and `/users/:id/orders`, `/users/me/orders` still matches the second.
- [ ] `/Users/42/`, `/users/42` and `/users/42?x=1` all match the same route; `/users//42` and `/users/42/extra` do not.
- [ ] A `HEAD` request matches the `GET` route; a `POST` to a GET-only path returns `null` (not a 405 concept here).
- [ ] Percent-encoded static segments match their decoded form; a malformed escape (`/%E0%A4%A`) returns `null` without throwing.
- [ ] `selectCase`: `caseHeader` matches by name (trimmed, case-insensitive) and by id; `caseQuery` is used only when the header is absent; `statusHeader` selects the **first by sort order** among cases with that status; with none present the default is returned.
- [ ] A present-but-unmatched selector returns `ok:false` with `available` (name, status, default) even if a later selector would have matched (no fall-through).
- [ ] `body()` returns the baked string for each case, `""` for a `204` case, and `null` when `baked` was `null`.
- [ ] Compiling a 500-route, 1,500-case snapshot takes under 100 ms and 100,000 matches take under 150 ms on the CI runner (budget test, generous).
- [ ] `routes()` lists every `{method, path}` in the snapshot's order (used for the `route_not_found` hint).
- [ ] `bytes` ≥ the length of the baked text (so the LRU can bound memory).

## Tests
Table-driven match tests (including the backtracking cases), selection table, budget test.

## Open questions
- Whether a trailing `/` in a *defined* route path should be allowed (grammar forbids it; confirmed in API-CONTRACT §1.7).
