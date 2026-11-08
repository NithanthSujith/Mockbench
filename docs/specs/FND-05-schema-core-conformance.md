# FND-05 — schema-core: conformance, property tests, purity guard

Status: done
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
- `packages/schema-core/fixtures/<name>.schema.json` + `<name>.<mode>-<indexing>.golden.txt` goldens; `pnpm --filter @mockbench/schema-core test:update-goldens` (`vitest run --project node -u`) is the only way goldens change. *(Built layout: the 16 new cases live in `fixtures/corpus/` with a `manifest.json` listing each case's combinations; the two FND-03 cases stay in `fixtures/`. Goldens are `.golden.txt`, not `.json`, so Prettier never reformats them. One case, `limits-leaves-50000`, commits a digest (`sha1`, `bytes`, `leaves`) because its output is about 190 KB.)*
- `packages/schema-core/test/exports.snapshot.txt` — sorted list of public exports (kind and name). `GENERATOR_VERSION` bump required when any golden changes: `test/generator-guard.json` holds an **append-only history** of `{ generatorVersion, goldensHash }` pairs and the last entry must equal the current pair (`test/guard.ts`).
- Bundle budgets in `package.json` (`"sizeLimit"`), and `"sideEffects": false` so bundlers can tree-shake the package.

## Acceptance criteria
- [x] Corpus covers: flat object, nested objects, array of objects, nested arrays (both indexing modes), every leaf type, enum cycling, `fixed` pins incl. falsy values, `examples` pool, preset hits at each specificity, `ref` reuse (two positions → different UUIDs), numeric-like keys, root array, root primitive, a max-size schema just under every limit. *(18 schemas, 65 goldens. Coverage is asserted by machine in `corpus.test.ts`: all 15 node types used, `fixed` of `0`, `""`, `false`, `null`, preset hits at path / exact-key / glob / type tiers, 10 distinct UUIDs across 4 `ref` uses. The limit cases sit exactly at depth 10, 2,000 nodes, array count 1,000 and 50,000 leaves, not merely under them.)*
- [x] Property: for any schema produced by the arbitrary that passes `validateSchema`, `generate` twice returns identical `json`, and `JSON.parse(json)` succeeds. *(All four mode × indexing combinations, plus `random` with an injected RNG.)*
- [x] Property: for any such schema the number of leaves in the output never exceeds `LIMITS.maxLeaves`; and a schema over the limit throws `GenerationLimitError`, never returns.
- [x] Property: `validateSchema(x)` never throws for arbitrary JSON `x` (including prototype-pollution-shaped keys) and returns `ok:false` with ≥1 issue when invalid. *(`__proto__`, `constructor`, `prototype`, `toString`, `hasOwnProperty` as field keys and component names; `Object.prototype` is asserted untouched.)*
- [x] Property: validating then `JSON.stringify` then validating again preserves every unknown key. *(Also: generation ignores unknown keys — stripping them does not change the output.)*
- [x] An `esbuild` bundle of the package entry with `platform: "browser"` succeeds, with `external: []`, and its metafile contains no Node builtin; the full Vitest suite also passes under the `happy-dom` environment. *(Vitest runs two projects, `node` and `browser-env` (happy-dom), over the same test files: 281 tests × 2.)*
- [x] A scratch import of `node:crypto` inside the package fails both ESLint and the bundle test.
- [x] Minified+gzipped bundle (excluding `zod`) is ≤ the committed budget (initial budget set to measured size + 10 %). *(8,275 B measured, budget 9,100 B.)*
- [x] Changing any golden without bumping `GENERATOR_VERSION` fails CI; bumping it without changing a golden also fails.
- [x] The export snapshot test fails when an export is added or removed without updating the snapshot.

## Tests
This unit *is* tests. Cases are named after fixtures (`<name> / <mode>-<indexing>`). Files: `test/corpus.test.ts`, `properties.test.ts` (fixed seed 20261108), `purity.test.ts`, `size.test.ts`, `generator-guard.test.ts`, `exports.test.ts`, `environment.test.ts`. 562 tests pass (281 per environment) in about 12 s; the suite was 163 before this unit.

Mutation checks run before closing: breaking the boolean rule failed 15 golden tests; hand-editing one golden failed the guard and the corpus; a `node:crypto` import in the package failed the bundle, lint and snapshot tests; an extra export failed the export test.

## Open questions
- ~~Budget number (to be measured here, then frozen).~~ Set, see below.
- ~~Whether to also run the suite under a real browser (Playwright) in CI, or happy-dom only (assumed).~~ happy-dom only.
- The export snapshot parser reads `export { … } from` and `export type { … } from` statements in `src/index.ts`. A direct `export const x = …` there would not appear in the snapshot file, but the runtime-versus-parsed test fails on it. Keep `index.ts` as pure re-exports.

## Findings and changes made in this unit
**Bundle sizes (minified + gzipped, esbuild, browser platform).** This answers the open question left by FND-02 about the "95 KB" figure: it was accurate.

| What | Gzipped |
| --- | --- |
| Whole package including zod | **101,601 B** (473,927 B minified) |
| Whole package excluding zod | **8,275 B** (19,909 B minified) |
| `validateSchema` only | 2,260 B |
| `generate` only | 5,508 B |
| `inferSchema` only | 3,610 B |
| Browser preview path: `validateSchema` + `generate` + `buildPresetResolver` | **5,986 B**, no zod |
| The Zod schemas only (`mockSchemaZod`, `PresetRulesSchema`) | 94,018 B |
| For comparison, a two-field schema in classic zod, nothing else | 93,411 B |
| The same two-field schema in `zod/mini` | 4,401 B |

Committed budgets (`sizeLimit`, about measured + 10 %): excluding zod 9,100; including zod 112,000; validate-only 2,500; generate-only 6,100; preview path 6,600.

So the cost is classic Zod itself, not this package's code. The ruling to keep full Zod (ADR 0016) stands because **the browser preview path ships no Zod at all**: only code that uses `mockSchemaZod`, `fieldEntryZod`, `mockNodeZod`, `PresetRuleSchema` or `PresetRulesSchema` (the API, and the web preset editor) pays for it. That only holds with the two changes below.

**Changes outside the test files (all inside `packages/schema-core`):**
1. `package.json`: added `"sideEffects": false`. Without it bundlers cannot drop unused modules, and importing only `sha1` cost 94 KB. This field is not in the unit's declared scope: revert it if you object, and the tree-shaking tests in `size.test.ts` will say so.
2. `src/preset-schema.ts` (new): the Zod rule schemas (`MAX_PRESET_RULES`, `PresetRuleSchema`, `PresetRulesSchema`) moved out of `src/presets.ts`, which keeps the resolver and starter packs. A module with top-level `z.*` calls cannot be tree-shaken, so `buildPresetResolver` used to drag Zod into the browser. `src/index.ts` exports are unchanged (same names, same snapshot); `presets.ts` still re-exports the `PresetRule` type.
3. `src/raw.d.ts` declares the slice of Vite's `ImportMeta` the tests use; `tsconfig.json` now also includes `test/` and `vitest.config.ts`.
4. `src/generate.test.ts`: FND-03's `it.todo` is now a real assertion that both FND-03 goldens are byte-identical in whichever environment runs the file, and that the run happened in the environment it claims (`task.file.projectName`).

No generator or validator bug was found, so `GENERATOR_VERSION` stays 1; `test/generator-guard.json` records version 1 against the hash of all 65 goldens.

**Notes for later units:**
- Node-only tooling (esbuild, ESLint API) is used inside tests without `node:*` imports, so the purity lint rule applies to the tests too. Paths are resolved by string handling in `test/helpers.ts` because happy-dom's global `URL` mis-resolves `file:` bases.
- The web app should import schema-core through the entry point; with `sideEffects: false` Vite drops what the screen does not use.
