# FND-03 — schema-core: deterministic generator

Status: done
Phase: 1   Team: Core
Depends on: FND-02
Size: L

## Goal
`generate(schema, ctx)` turns a valid MockSchema into JSON text exactly as DESIGN § Generation engine specifies: `value = f(key, type, ordinal)`, with local/path indexing, the precedence chain, deterministic UUID v5, and the `seeded`/`random` modes — pure, synchronous, browser-safe, and producing identical output in Node and the browser.

## In scope
- Ordinal and indexing rules, per-type rules, precedence (`fixed` › preset › `examples` › `enum` › type), `ref` expansion, nested-array reset vs path-qualified keys.
- **Output serialised from the ordered field list** (never from a built JS object) so numeric-like keys keep their position; per-value **provenance** map for the preview.
- Synchronous SHA-1 + UUID v5; `seeded` (seeded PRNG + in-repo word/name pools, D4) and `random` (injected RNG) modes; `GENERATOR_VERSION`; pre-generation limit check.

## Out of scope
Preset *matching* logic (FND-04 supplies `resolvedPresets`; this unit only consults an interface), inference, publishing/baking, any HTTP.

## Contract
```ts
const GENERATOR_VERSION = 1
type GenContext = { projectId: string; settings: { indexing: 'local'|'path'; mode: 'deterministic'|'seeded'|'random' }
  components?: Record<string, MockNode>; presets?: PresetResolver; random?: () => number }
type PresetResolver = (q: { key: string|null; schemaPath: string; type: NodeType }) => { value: Json } | { values: Json[] } | { pattern: string } | null   // implemented in FND-04
type Provenance = 'fixed'|'preset'|'example'|'enum'|'generated'|'random'
generate(schema: MockSchema, ctx: GenContext, opts?: { indent?: number }): { json: string; provenance: Record<string /*JSON Pointer into output*/, Provenance> }
generateValue(schema, ctx): Json          // convenience; loses key order for numeric-like keys, documented
class GenerationLimitError extends Error { code: 'leaf_limit_exceeded'|'depth_exceeded'|... }
sha1(bytes: Uint8Array): Uint8Array;  uuidv5(namespace: string, name: string): string
```
Rules (these are the frozen semantics):
- Root ordinal is 1. An array element's ordinal is its 1-based index and flows into everything beneath it **until a nested array resets it** (`local`). A node's `key` is its own field key; an array's item inherits **the array's key**; a root array's items use key `item`.
- `indexing: 'path'`: entering an array element whose item is `object`/`array` extends a prefix with `<arrayKey>-<index>-`; every leaf under it uses `prefix + key`. So `users[2].tags` → `users-2-tags-1`, `users-2-tags-2`.
- Per-type: `string` `<k>-<n>`; `email` `<k>-<n>@example.com`; `url` `https://example.com/<k>-<n>`; `integer` starts at `min` (default 1) and counts up with the ordinal, stopping at `max` (ceil of `min` / floor of `max` so it stays integral) — **ruled 2026-11-07, deviating from DESIGN's literal "n clamped"**; `number` is the same sequence plus 0.5; `boolean` `n` is odd; `enum` `values[(n-1) mod len]`; `date` = `2026-01-01` plus `n` days; `datetime` = same date at `T00:00:00+05:30`; `phone` `+91 90000 ` + `n mod 100000` zero-padded to 5; `null` `null`; `uuid` = UUIDv5(namespace `7d1c1a0e-7d8e-5a52-9b5e-3f2d6c0a4b11`, `projectId|<JSON pointer of the *output* position>|n`) — the pointer is the position in the output, so a `ref` used twice yields different UUIDs. `k` is `prefix + key` in path mode, else `key`.
- `fixed` is detected by key presence (D5). `nullable` is documentary: generation never emits `null` because of it (D5). `examples[]` cycle by `(n-1) mod len`; empty `examples` is ignored.
- `seeded`: values drawn from in-repo pools by a PRNG seeded with `hash(projectId|pointer)`; stable. `random`: same pools driven by `ctx.random ?? Math.random`; provenance `random`.
- Never mutates the input. Never throws on a schema that passed `validateSchema`, except `GenerationLimitError` (checked **before** allocating output).

## Acceptance criteria
- [x] The DESIGN worked-example envelope with `indexing: local` produces exactly the DESIGN output (`name-1`, `email-1@example.com`, `role-1`, `is_active: true`, `branch_list: ["branch_list-1","branch_list-2","branch_list-3"]`, `address: {city: "city-1", pincode: 1}`, `orders[0].total: 1.5`, `orders[1].total: 2.5`), byte-identical to a committed golden.
- [x] `{users:[{tags:[…2…]}×2]}`: `local` → `users[1].tags == ["tags-1","tags-2"]`; `path` → `["users-2-tags-1","users-2-tags-2"]`.
- [x] An object with fields `"200"`, `"1"`, `"b"` in that order serialises with the keys in that order.
- [x] `uuidv5` equals `886313e1-3b8a-5372-9b90-0c9aee199e5d` for namespace DNS (`6ba7b810-9dad-11d1-80b4-00c04fd430c8`) and name `python.org`; `sha1("abc")` equals `a9993e364706816aba3e25717850c26c9cd0d89d`. No call to `crypto.subtle` or the `crypto` module exists in the package.
- [x] `phone` at n=1, 12, 100000 → `+91 90000 00001`, `+91 90000 00012`, `+91 90000 00000`. `date` n=1 → `2026-01-02`; `datetime` n=1 → `2026-01-02T00:00:00+05:30`; `boolean` n=1 true, n=2 false. *(n=100000 is unreachable through arrays - the count cap is 1000 - so the wrap is tested on the `phoneFor` helper directly.)*
- [x] `integer` min 5 max 8 over a 10-element array → `5,6,7,8,8,8,8,8,8,8`; `enum ["a","b"]` over 3 elements → `a,b,a`. *(Rule B ruled 2026-11-07: start at `min`, count up, stop at `max`; `number` min 2 max 3 over 4 → `2.5,3,3,3`; fractional bounds keep integers integral.)*
- [x] `fixed: ""`, `fixed: 0`, `fixed: false`, `fixed: null` each win over a preset hit, `examples` and the type rule; provenance for each is `fixed`.
- [x] A preset resolver hit beats `examples`, which beats `enum`, which beats the type rule (four fixtures).
- [x] `seeded`: two calls with the same `projectId` are identical; a different `projectId` differs. `random` with `random: () => 0.5` is reproducible; with the default RNG two calls differ.
- [x] A schema with two nested `count: 1000` arrays throws `GenerationLimitError` in under 50 ms without allocating the output.
- [x] *Moved to FND-05:* byte-identical output under a browser-like environment (happy-dom) is asserted by FND-05 over these same goldens (it adds happy-dom); this unit keeps an `it.todo` marking the hand-off.
- [x] `provenance` is keyed by the JSON Pointer of each leaf in `json` and distinguishes `fixed`/`preset`/`generated`.

## Tests
Golden-file tests (inputs and expected outputs committed under `packages/schema-core/fixtures`), known-answer tests for SHA-1/UUIDv5, clamp and cycle tables, key-order test, limit test. Property tests live in FND-05.

## Implementation notes (clarifications recorded during FND-03)
- `generate()` runs `validateSchema` first (cheap; never expands the tree). Limit failures throw `GenerationLimitError` (codes `leaf_limit_exceeded`, `depth_exceeded`, `node_limit_exceeded`, `array_count_exceeded`) before any output is allocated; any other validation failure (unknown ref, ref cycle, malformed node) throws the added `SchemaInvalidError { issues }` so a bad schema can never loop.
- `applyPattern` is implemented in `src/pattern.ts` (the generator needs it) and exported from the package now; FND-04 owns its tests and the rest of the presets engine.
- Extra exports: `UUID_NAMESPACE`, `formatUuid`, `SchemaInvalidError`, types `PresetQuery`/`PresetHit`/`GenerateResult`. `phoneFor` is exported from `src/generate.ts` for tests only (not from the package index).
- The preset resolver is called for **leaf nodes only**, with the effective field key (`null` when there is none: a root primitive or the items of a root array, which still *generate* with key `item`). `schemaPath` is the use-site path (`$.home.city` for a component used at `home`).
- `fixed` on an object/array node writes the literal and records each leaf of it as `fixed`; JS reorders integer-like keys inside such a *literal*, so only generated objects are order-exact.
- `ctx.components` are merged **over** the envelope's components, identical to `validateSchema` (FND-02). PLAN § 9 C2 loosely described envelope components as "local overrides"; the implemented and tested rule is caller-supplied wins.
- `seeded`: PRNG seeded per leaf with `hash(projectId|output pointer)`; uuid is a v4-format value drawn from it. Pools are ~1.3 KB (`src/pools.ts`). `phone` stays inside the `+91 90000 xxxxx` test range in every mode.
- Mutation-checked: breaking the boolean rule, the clamp, the uuid name, or the path prefix each fails 2-4 tests.

## Open questions
- Faker versus in-repo pools for `seeded`/`random` (D4) — this spec assumes pools; if Faker is chosen, the dependency, its bundle cost and a version-pinning rule must be added here.
- Base date `2026-01-01` and the namespace UUID above are placeholders to confirm; changing them later bumps `GENERATOR_VERSION`.
