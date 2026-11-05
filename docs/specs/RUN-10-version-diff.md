# RUN-10 — Version diff

Status: approved
Phase: 4   Team: Runtime
Depends on: RUN-02, RUN-09
Size: M

## Goal
Any two versions of a project can be compared: routes added and removed, and for shared routes which cases and which schema fields changed — computed from the two stored snapshots.

## In scope
- Handler `versions.diff` and a pure `diffSnapshots(from, to): VersionDiff` function.
- UI: "Compare" action and a diff view on the versions screen (from/to pickers, grouped changes with tokens-coloured add/remove/change markers).

## Out of scope
Diffing the draft against a version, three-way merge, restoring from a diff.

## Contract
Endpoint `versions.diff` (API-CONTRACT §3.9) and the `VersionDiff` type (§2). Identity: route = method + normalised path; case = name (case-insensitive); schema paths use `$.a.b` and `[*]`.

## Acceptance criteria
- [ ] Two identical snapshots → an empty diff (all arrays empty, `settings: []`).
- [ ] A route present only in `to` appears in `routes.added`; only in `from` in `removed`; `/users/:id` renamed `/users/:userId` is **not** a change (same normalised path).
- [ ] A case renamed `Found` → `OK` appears as one removed and one added case (stated limitation).
- [ ] Adding `address.zip` yields a schema change `{path:"$.address.zip", kind:"added", after:{type:"string"}}`; changing `pincode` from `integer` to `string` yields `kind:"changed"` with `before`/`after`; a change inside an array element is `$.orders[*].total`.
- [ ] A changed status code or `isDefault` flag appears under that case's `fields` as `{field, before, after}`; a changed `defaultDelayMs` appears under `settings`; preset and component additions/removals/changes appear by name.
- [ ] Output ordering is deterministic (routes by method+path, cases by name, schema paths in document order) — the same inputs give byte-identical JSON.
- [ ] `GET /versions/:a/diff/:b` for versions of different projects → `422 versions_different_projects`; a version the caller cannot see → `404`; viewers can call it.
- [ ] A diff of two 500-route snapshots completes in under 500 ms.
- [ ] The UI lists added routes in `good`, removed in `bad`, changed in `warn` (tokens), expands a changed case to its field and schema changes, and says "Renames show as remove + add".
- [ ] Comparing a version with itself shows "No differences".

## Tests
`diffSnapshots` table tests with fixture snapshots; handler role/error tests; Testing Library for the view.

## Open questions
- Whether to detect probable renames heuristically (assumed no for v1).
