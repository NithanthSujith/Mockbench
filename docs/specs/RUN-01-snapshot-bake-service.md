# RUN-01 — Snapshot and bake service

Status: approved
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
- [ ] For a project with 3 routes / 5 cases, the returned snapshot validates against the registry's `Snapshot` schema and `routeCount=3`, `caseCount=5`.
- [ ] Baking twice from an unchanged draft yields byte-identical `baked` text (including UUIDs).
- [ ] For each baked entry, the string equals `generate(case.schema, ctx).json` compacted, computed independently in the test with the same inputs (the preview/bake equivalence the product depends on).
- [ ] Disabled presets are absent from the snapshot and do not influence baked output; enabled preset rules do (a `currency → INR` rule appears in the baked body).
- [ ] `mode: "random"` returns `baked: null`; `deterministic` and `seeded` return text; a `204` case's entry is `""`.
- [ ] One case with an `unknown_ref` and one with `depth_exceeded` produce a `PublishInvalidError` with **two** details entries naming route, case and issue paths, and nothing is baked.
- [ ] A project with no routes throws `EmptyProjectError`.
- [ ] Unknown node keys (`source`, `x-vendor`) in a case schema are present, unchanged, in the snapshot.
- [ ] Editing a preset or a component after the call does not alter an already-returned snapshot or baked text (self-contained: components and presets are embedded).
- [ ] A schema that passes validation never makes baking throw (a leaf-limit schema is rejected at validation).
- [ ] Reads happen inside the provided transaction (a row inserted concurrently after the transaction began is not seen).

## Tests
Service tests against the FND-09 harness; the preview/bake equivalence test; a determinism test; a snapshot-isolation test.

## Open questions
- Total baked size cap per version (DESIGN gives per-response caps only). Proposal: 64 MiB, error `baked_too_large` listing the largest cases. Needs a ruling.
