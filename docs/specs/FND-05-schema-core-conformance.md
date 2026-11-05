# FND-05 — schema-core: conformance, property tests, purity guard

Status: approved
Phase: 1   Team: Core
Depends on: FND-04
Size: M

## Goal
`schema-core` is provably deterministic, provably browser-safe, and its public surface is a reviewed snapshot, so that "frozen" means something: any behavioural or API change shows up as a failing test someone has to consciously update.

## In scope
- A committed corpus of ≥12 representative schemas with golden outputs for each mode and indexing combination that applies.
- Property tests (fast-check) for idempotence, valid JSON, limits, unknown-key preservation, validator totality.
- Purity guard (browser-platform bundle, no Node globals), bundle-size budget, public-export snapshot, `GENERATOR_VERSION` change-guard.

## Out of scope
New behaviour. Fixing a generator bug found here is a change to FND-03/04 made in this unit's PR, called out explicitly.

## Contract
- `packages/schema-core/fixtures/<name>.schema.json` + `<name>.<mode>-<indexing>.json` goldens; `pnpm --filter schema-core test:update-goldens` is the only way goldens change.
- `packages/schema-core/test/exports.snapshot.txt` — sorted list of public exports; `GENERATOR_VERSION` bump required when any golden changes (test compares a hash of all goldens to a constant, which must be bumped together).
- Bundle budget constant in `package.json` (`"sizeLimit"`).

## Acceptance criteria
- [ ] Corpus covers: flat object, nested objects, array of objects, nested arrays (both indexing modes), every leaf type, enum cycling, `fixed` pins incl. falsy values, `examples` pool, preset hits at each specificity, `ref` reuse (two positions → different UUIDs), numeric-like keys, root array, root primitive, a max-size schema just under every limit.
- [ ] Property: for any schema produced by the arbitrary that passes `validateSchema`, `generate` twice returns identical `json`, and `JSON.parse(json)` succeeds.
- [ ] Property: for any such schema the number of leaves in the output never exceeds `LIMITS.maxLeaves`; and a schema over the limit throws `GenerationLimitError`, never returns.
- [ ] Property: `validateSchema(x)` never throws for arbitrary JSON `x` (including prototype-pollution-shaped keys) and returns `ok:false` with ≥1 issue when invalid.
- [ ] Property: validating then `JSON.stringify` then validating again preserves every unknown key.
- [ ] An `esbuild` bundle of the package entry with `platform: "browser"` succeeds, with `external: []`, and its metafile contains no Node builtin; the full Vitest suite also passes under the `happy-dom` environment.
- [ ] A scratch import of `node:crypto` inside the package fails both ESLint and the bundle test.
- [ ] Minified+gzipped bundle (excluding `zod`) is ≤ the committed budget (initial budget set to measured size + 10 %).
- [ ] Changing any golden without bumping `GENERATOR_VERSION` fails CI; bumping it without changing a golden also fails.
- [ ] The export snapshot test fails when an export is added or removed without updating the snapshot.

## Tests
This unit *is* tests. Name cases after fixtures.

## Open questions
- Budget number (to be measured here, then frozen).
- Whether to also run the suite under a real browser (Playwright) in CI, or happy-dom only (assumed).
