# RUN-01 — Snapshot and bake service

Status: done
Phase: 2   Team: Runtime
Depends on: FND-11, FND-04
Size: M

## Goal
A pure service, with no HTTP, that turns a project's draft into a validated, self-contained snapshot plus baked response payloads — the engine of publish.

## In scope
- `buildVersionPayload(tx, projectId)`: load project, routes, cases, **enabled** presets and project components; validate every case with `validateSchema`; assemble the `Snapshot` (API-CONTRACT §2) in `sortOrder`; bake every case unless `mode` is `random`; compute counts and byte sizes.
- A typed `PublishInvalidError` carrying one `{routeId, method, path, caseId, caseName, issues}` per offending case.

## Out of scope
The HTTP handlers, transaction/label/sequence logic (RUN-02), the cache, serving.

## Contract
```ts
buildVersionPayload(tx: Tx, projectId: string): Promise<{
  snapshot: Snapshot; baked: string | null;          // JSON text of { "<routeId>:<caseId>": "<body>" }; null in random mode
  routeCount: number; caseCount: number; snapshotBytes: number; bakedBytes: number }>
class PublishInvalidError extends Error { details: PublishIssue[] }
class EmptyProjectError extends Error {}
```
Snapshot embeds `generatorVersion`, `project.{id,slug,settings,components}`, enabled presets (rules resolved as stored). `204` cases bake to the empty string.

## Acceptance criteria
- [x] For a project with 3 routes / 5 cases, the returned snapshot validates against the registry's `Snapshot` schema and `routeCount=3`, `caseCount=5`.
- [x] Baking twice from an unchanged draft yields byte-identical `baked` text (including UUIDs).
- [x] For each baked entry, the string equals `generate(case.schema, ctx).json` compacted, computed independently in the test with the same inputs (the preview/bake equivalence the product depends on).
- [x] Disabled presets are absent from the snapshot and do not influence baked output; enabled preset rules do (a `currency → INR` rule appears in the baked body).
- [x] `mode: "random"` returns `baked: null`; `deterministic` and `seeded` return text; a `204` case's entry is `""`.
- [x] One case with an `unknown_ref` and one with `depth_exceeded` produce a `PublishInvalidError` with **two** details entries naming route, case and issue paths, and nothing is baked.
- [x] A project with no routes throws `EmptyProjectError`.
- [x] Unknown node keys (`source`, `x-vendor`) in a case schema are present, unchanged, in the snapshot.
- [x] Editing a preset or a component after the call does not alter an already-returned snapshot or baked text (self-contained: components and presets are embedded).
- [x] A schema that passes validation never makes baking throw (a leaf-limit schema is rejected at validation).
- [x] Reads happen inside the provided transaction (a row inserted concurrently after the transaction began is not seen).

## Implementation notes (RUN-01, recorded for RUN-02 and later units)
- Code: `apps/api/src/modules/versions/snapshot.ts` (service, errors, types) and `snapshot.test.ts` (20 tests against real Postgres 16). Not wired into `modules/versions/index.ts`: RUN-02 imports it from `./snapshot`.
- **One read statement.** The draft (project, routes by sortOrder, cases by sortOrder, ENABLED presets by priority desc then creation order) is loaded in a single SQL statement, so the result is internally consistent even at READ COMMITTED (no torn read if a route is committed mid-publish). `Tx` is `Pick<Db, 'execute'>`: any Drizzle transaction, or the db itself.
- **RUN-02 should open the publish transaction at REPEATABLE READ** (`db.transaction(fn, { isolationLevel: 'repeatable read' })`) so the snapshot also matches everything else read in that transaction (the criterion "a row inserted concurrently after the transaction began is not seen" is tested at that level, and the service demonstrably reads through the passed executor, not the pool). The service cannot set the level itself: it can only be set before the first query of a transaction, and RUN-02 locks the project row first.
- `PublishIssue.caseId`/`caseName` are `string | null`: a route with no cases at all (impossible via `routes.create`) is reported as one entry with null case fields and issue code `route_has_no_cases`, instead of producing an unservable version. This slightly widens the contract's "one per offending case".
- Baking failures that should be impossible after validation (e.g. an unexpected `GenerationLimitError`) are reported as `PublishInvalidError` entries with the error's code (or `bake_failed`), never as a 500.
- Settings stored partially (`{}`) are filled from `DEFAULT_PROJECT_SETTINGS` so the snapshot always holds all four keys. Stored preset rules are trusted (validated on write by PRJ-02) and not re-validated here.
- `ProjectNotFoundError` is thrown for an unknown id (a race with project deletion; RUN-02 maps it to 404).

## Tests
Service tests against the FND-09 harness; the preview/bake equivalence test; a determinism test; a snapshot-isolation test.

## Open questions
- Total baked size cap per version (DESIGN gives per-response caps only). Proposal: 64 MiB, error `baked_too_large` listing the largest cases. **Still needs a ruling; not implemented here** (only the per-response limits in schema-core apply).
