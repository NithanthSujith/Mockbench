# FND-04 — schema-core: presets engine and JSON inference

Status: approved
Phase: 1   Team: Core
Depends on: FND-03
Size: M

## Goal
`schema-core` can validate preset rules, resolve which rule applies to a field (specificity, priority, order), expand `pattern`s, and infer a MockSchema from a pasted JSON sample with visible warnings.

## In scope
- Preset rule Zod schema, `buildPresetResolver(presets)` returning the FND-03 `PresetResolver`, `applyPattern`, the two starter packs.
- `inferSchema(sample)` implementing DESIGN's five rules plus the warning list below.

## Out of scope
Any storage of presets (PRJ-02), UI (PRJ-03, BLD-09), the HTTP endpoints (BLD-03).

## Contract
```ts
PresetRuleSchema   // { match: { key?, path?, type? }, value? | values? | pattern? }  — ≥1 match field, exactly one of the three outputs
type ResolvedPreset = { priority: number; rules: PresetRule[] }
buildPresetResolver(presets: ResolvedPreset[]): PresetResolver
applyPattern(pattern: string, n: number, key: string): string       // {n}, {n:0N}, {key}
STARTER_PRESETS: { name: string; priority: number; rules: PresetRule[] }[]     // "Indian B2B (sample)" + an empty template
inferSchema(sample: unknown): { schema: MockSchema; warnings: { path: string; code: WarningCode; message: string }[] }
type WarningCode = 'null_value'|'empty_array'|'mixed_array_shapes'|'mixed_array_types'|'optional_key'|'limits_exceeded'
```
Matching: rules apply to **leaf** nodes only. `key` is a glob where `*` matches any run of characters (no other metacharacters), matched against the field key (an array item uses its array's key). `path` is `$` + `.key` segments with `[*]` for any array element, matched exactly against the node's *schema path* (not instance indices), e.g. `$.orders[*].total`. `type` is a node type.
Specificity (higher wins): `path` 100 · exact `key` 50 · glob `key` 30 · plus 10 when `type` is also given · bare `type` 10. Ties: higher preset `priority`, then the **later** rule (later within a preset; across presets, the preset with the higher priority, then later by array order).
Inference (DESIGN rules): `null` → `string` + `nullable` + `null_value`; email/UUID/ISO-date/ISO-datetime/URL-looking strings → the semantic type; whole numbers → `integer`, else `number`; arrays infer from element 0 with `count` = length (`empty_array`: `items: string`, `count: 0`); heterogeneous object elements → union of keys, keys missing from some elements get `nullable: true` + `optional_key` (D5) and `mixed_array_shapes`; elements of different primitive types → element 0's type + `mixed_array_types`; objects preserve key order; any root type is accepted; limits breaches stop inference with `limits_exceeded`.

## Acceptance criteria
- [ ] `{match:{path:"$.address.city"}}` beats `{match:{key:"city"}}` beats `{match:{key:"*ty"}}` beats `{match:{type:"string"}}` on the field `address.city` (one test each pair).
- [ ] Two equal-specificity rules → higher `priority` wins; equal priority → the later rule wins.
- [ ] `{match:{key:"*_id",type:"string"}, pattern:"ID-{n:05}"}` yields `ID-00007` at n=7 for key `user_id` of type string, and does not apply to an `integer` named `user_id`.
- [ ] `values: ["admin","manager","viewer"]` cycles by ordinal across a 4-element array → `admin,manager,viewer,admin`.
- [ ] A rule with neither `value`, `values` nor `pattern`, or with two of them, or with an empty `match`, fails `PresetRuleSchema`.
- [ ] `inferSchema` of `{"id":"8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f","n":1,"x":1.5,"d":"2026-01-02","e":"a@b.co","u":"https://x.io","z":null,"arr":[{"a":1},{"b":"x"}]}` gives `uuid, integer, number, date, email, url`, `z` as nullable `string` with `null_value`, and `arr` as `count: 2` over an object whose `a` and `b` are `nullable` with `optional_key` and `mixed_array_shapes`.
- [ ] `inferSchema([])` → root array, `items: string`, `count: 0`, `empty_array`; `inferSchema(5)` → root `integer`.
- [ ] Every output of `inferSchema` passes `validateSchema`.
- [ ] `STARTER_PRESETS` each pass `PresetRuleSchema`, and every rule in them is exercised by a generation fixture.

## Tests
Table-driven tests for specificity pairs and ties, pattern expansion, each inference rule and warning, a fuzz test that inference output always validates.

## Open questions
- Glob semantics beyond `*` (e.g. `?`, `{a,b}`) — deliberately excluded; confirm.
- Whether `type`-only rules should be allowed on `enum` nodes (this spec: yes, `enum` is a node type like any other).
