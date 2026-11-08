# FND-04 — schema-core: presets engine and JSON inference

Status: done
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
type WarningCode = 'null_value'|'empty_array'|'mixed_array_shapes'|'mixed_array_types'|'optional_key'|'invalid_key'|'limits_exceeded'   // invalid_key added in FND-04 (see Clarifications)
PresetRulesSchema = z.array(PresetRuleSchema).max(MAX_PRESET_RULES)   // MAX_PRESET_RULES = 500; issue paths point into [i]; also exported: PresetRule, StarterPreset, InferResult, InferWarning, MAX_PRESET_RULES
Matching: rules apply to **leaf** nodes only. `key` is a glob where `*` matches any run of characters (no other metacharacters), matched against the field key (an array item uses its array's key). `path` is `$` + `.key` segments with `[*]` for any array element, matched exactly against the node's *schema path* (not instance indices), e.g. `$.orders[*].total`. `type` is a node type.
Specificity (higher wins): `path` 100 · exact `key` 50 · glob `key` 30 · plus 10 when `type` is also given · bare `type` 10. Ties: higher preset `priority`, then the **later** rule (later within a preset; across presets, the preset with the higher priority, then later by array order).
Inference (DESIGN rules): `null` → `string` + `nullable` + `null_value`; email/UUID/ISO-date/ISO-datetime/URL-looking strings → the semantic type; whole numbers → `integer`, else `number`; arrays infer from element 0 with `count` = length (`empty_array`: `items: string`, `count: 0`); heterogeneous object elements → union of keys, keys missing from some elements get `nullable: true` + `optional_key` (D5) and `mixed_array_shapes`; elements of different primitive types → element 0's type + `mixed_array_types`; objects preserve key order; any root type is accepted; limits breaches stop inference with `limits_exceeded`.

## Acceptance criteria
- [x] `{match:{path:"$.address.city"}}` beats `{match:{key:"city"}}` beats `{match:{key:"*ty"}}` beats `{match:{type:"string"}}` on the field `address.city` (one test each pair).
- [x] Two equal-specificity rules → higher `priority` wins; equal priority → the later rule wins.
- [x] `{match:{key:"*_id",type:"string"}, pattern:"ID-{n:05}"}` yields `ID-00007` at n=7 for key `user_id` of type string, and does not apply to an `integer` named `user_id`.
- [x] `values: ["admin","manager","viewer"]` cycles by ordinal across a 4-element array → `admin,manager,viewer,admin`.
- [x] A rule with neither `value`, `values` nor `pattern`, or with two of them, or with an empty `match`, fails `PresetRuleSchema`.
- [x] `inferSchema` of `{"id":"8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f","n":1,"x":1.5,"d":"2026-01-02","e":"a@b.co","u":"https://x.io","z":null,"arr":[{"a":1},{"b":"x"}]}` gives `uuid, integer, number, date, email, url`, `z` as nullable `string` with `null_value`, and `arr` as `count: 2` over an object whose `a` and `b` are `nullable` with `optional_key` and `mixed_array_shapes`.
- [x] `inferSchema([])` → root array, `items: string`, `count: 0`, `empty_array`; `inferSchema(5)` → root `integer`.
- [x] Every output of `inferSchema` passes `validateSchema`.
- [x] `STARTER_PRESETS` each pass `PresetRuleSchema`, and every rule in them is exercised by a generation fixture.

## Clarifications recorded during implementation
- **`generate()` needed no change.** It already passes `schemaPath` as `# FND-04 — schema-core: presets engine and JSON inference

Status: done
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
type WarningCode = 'null_value'|'empty_array'|'mixed_array_shapes'|'mixed_array_types'|'optional_key'|'invalid_key'|'limits_exceeded'   // invalid_key added in FND-04 (see Clarifications)
PresetRulesSchema = z.array(PresetRuleSchema).max(MAX_PRESET_RULES)   // MAX_PRESET_RULES = 500; issue paths point into [i]; also exported: PresetRule, StarterPreset, InferResult, InferWarning, MAX_PRESET_RULES
Matching: rules apply to **leaf** nodes only. `key` is a glob where `*` matches any run of characters (no other metacharacters), matched against the field key (an array item uses its array's key). `path` is `$` + `.key` segments with `[*]` for any array element, matched exactly against the node's *schema path* (not instance indices), e.g. `$.orders[*].total`. `type` is a node type.
Specificity (higher wins): `path` 100 · exact `key` 50 · glob `key` 30 · plus 10 when `type` is also given · bare `type` 10. Ties: higher preset `priority`, then the **later** rule (later within a preset; across presets, the preset with the higher priority, then later by array order).
Inference (DESIGN rules): `null` → `string` + `nullable` + `null_value`; email/UUID/ISO-date/ISO-datetime/URL-looking strings → the semantic type; whole numbers → `integer`, else `number`; arrays infer from element 0 with `count` = length (`empty_array`: `items: string`, `count: 0`); heterogeneous object elements → union of keys, keys missing from some elements get `nullable: true` + `optional_key` (D5) and `mixed_array_shapes`; elements of different primitive types → element 0's type + `mixed_array_types`; objects preserve key order; any root type is accepted; limits breaches stop inference with `limits_exceeded`.

## Acceptance criteria
- [x] `{match:{path:"$.address.city"}}` beats `{match:{key:"city"}}` beats `{match:{key:"*ty"}}` beats `{match:{type:"string"}}` on the field `address.city` (one test each pair).
- [x] Two equal-specificity rules → higher `priority` wins; equal priority → the later rule wins.
- [x] `{match:{key:"*_id",type:"string"}, pattern:"ID-{n:05}"}` yields `ID-00007` at n=7 for key `user_id` of type string, and does not apply to an `integer` named `user_id`.
- [x] `values: ["admin","manager","viewer"]` cycles by ordinal across a 4-element array → `admin,manager,viewer,admin`.
- [x] A rule with neither `value`, `values` nor `pattern`, or with two of them, or with an empty `match`, fails `PresetRuleSchema`.
- [x] `inferSchema` of `{"id":"8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f","n":1,"x":1.5,"d":"2026-01-02","e":"a@b.co","u":"https://x.io","z":null,"arr":[{"a":1},{"b":"x"}]}` gives `uuid, integer, number, date, email, url`, `z` as nullable `string` with `null_value`, and `arr` as `count: 2` over an object whose `a` and `b` are `nullable` with `optional_key` and `mixed_array_shapes`.
- [x] `inferSchema([])` → root array, `items: string`, `count: 0`, `empty_array`; `inferSchema(5)` → root `integer`.
- [x] Every output of `inferSchema` passes `validateSchema`.
- [x] `STARTER_PRESETS` each pass `PresetRuleSchema`, and every rule in them is exercised by a generation fixture.

 + `.key` segments with `[*]` per array element, and `key` as the array's key for items (`null` at the root), exactly as this spec defines. A path rule for a field inside an array therefore needs `[*]` (`$[*].address.city`); `$.address.city` only matches a non-array position.
- **Rule validation.** `match.type` accepts any `NodeType` (a rule on `object`/`array`/`ref` is valid but can never fire: only leaves are queried). `match.path` must match `# FND-04 — schema-core: presets engine and JSON inference

Status: done
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
type WarningCode = 'null_value'|'empty_array'|'mixed_array_shapes'|'mixed_array_types'|'optional_key'|'invalid_key'|'limits_exceeded'   // invalid_key added in FND-04 (see Clarifications)
PresetRulesSchema = z.array(PresetRuleSchema).max(MAX_PRESET_RULES)   // MAX_PRESET_RULES = 500; issue paths point into [i]; also exported: PresetRule, StarterPreset, InferResult, InferWarning, MAX_PRESET_RULES
Matching: rules apply to **leaf** nodes only. `key` is a glob where `*` matches any run of characters (no other metacharacters), matched against the field key (an array item uses its array's key). `path` is `$` + `.key` segments with `[*]` for any array element, matched exactly against the node's *schema path* (not instance indices), e.g. `$.orders[*].total`. `type` is a node type.
Specificity (higher wins): `path` 100 · exact `key` 50 · glob `key` 30 · plus 10 when `type` is also given · bare `type` 10. Ties: higher preset `priority`, then the **later** rule (later within a preset; across presets, the preset with the higher priority, then later by array order).
Inference (DESIGN rules): `null` → `string` + `nullable` + `null_value`; email/UUID/ISO-date/ISO-datetime/URL-looking strings → the semantic type; whole numbers → `integer`, else `number`; arrays infer from element 0 with `count` = length (`empty_array`: `items: string`, `count: 0`); heterogeneous object elements → union of keys, keys missing from some elements get `nullable: true` + `optional_key` (D5) and `mixed_array_shapes`; elements of different primitive types → element 0's type + `mixed_array_types`; objects preserve key order; any root type is accepted; limits breaches stop inference with `limits_exceeded`.

## Acceptance criteria
- [x] `{match:{path:"$.address.city"}}` beats `{match:{key:"city"}}` beats `{match:{key:"*ty"}}` beats `{match:{type:"string"}}` on the field `address.city` (one test each pair).
- [x] Two equal-specificity rules → higher `priority` wins; equal priority → the later rule wins.
- [x] `{match:{key:"*_id",type:"string"}, pattern:"ID-{n:05}"}` yields `ID-00007` at n=7 for key `user_id` of type string, and does not apply to an `integer` named `user_id`.
- [x] `values: ["admin","manager","viewer"]` cycles by ordinal across a 4-element array → `admin,manager,viewer,admin`.
- [x] A rule with neither `value`, `values` nor `pattern`, or with two of them, or with an empty `match`, fails `PresetRuleSchema`.
- [x] `inferSchema` of `{"id":"8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f","n":1,"x":1.5,"d":"2026-01-02","e":"a@b.co","u":"https://x.io","z":null,"arr":[{"a":1},{"b":"x"}]}` gives `uuid, integer, number, date, email, url`, `z` as nullable `string` with `null_value`, and `arr` as `count: 2` over an object whose `a` and `b` are `nullable` with `optional_key` and `mixed_array_shapes`.
- [x] `inferSchema([])` → root array, `items: string`, `count: 0`, `empty_array`; `inferSchema(5)` → root `integer`.
- [x] Every output of `inferSchema` passes `validateSchema`.
- [x] `STARTER_PRESETS` each pass `PresetRuleSchema`, and every rule in them is exercised by a generation fixture.

 followed by `.key` and `[*]` segments. `value` may be any JSON (`null`, `false`, `0`, `""` included); which output a rule has is decided by key presence. Rule and match objects are strict.
- **Specificity when a rule has both `path` and `key`:** both must match and the `path` score (100) applies; `type` adds 10 on top.
- **Inference additions (strictly needed so the output always validates):** a new warning `invalid_key` for keys MockSchema cannot hold (`""`, `__proto__`, over 200 chars): the field is skipped. When some samples at a position are `null` and others are not, the node takes the non-null type and is marked `nullable` with **no** `null_value` warning (the type is known). Warning paths are schema paths (`$.arr[*].a`); `mixed_array_shapes`/`mixed_array_types` are reported at the array's item path (`$.arr[*]`).
- **Limits.** The depth (10), node (2,000), array-count (1,000) and leaf (50,000) limits stop inference early (so a 50,000-deep or circular sample cannot overflow the stack); the result is the empty-object schema plus one `limits_exceeded` warning at `# FND-04 — schema-core: presets engine and JSON inference

Status: done
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
type WarningCode = 'null_value'|'empty_array'|'mixed_array_shapes'|'mixed_array_types'|'optional_key'|'invalid_key'|'limits_exceeded'   // invalid_key added in FND-04 (see Clarifications)
PresetRulesSchema = z.array(PresetRuleSchema).max(MAX_PRESET_RULES)   // MAX_PRESET_RULES = 500; issue paths point into [i]; also exported: PresetRule, StarterPreset, InferResult, InferWarning, MAX_PRESET_RULES
Matching: rules apply to **leaf** nodes only. `key` is a glob where `*` matches any run of characters (no other metacharacters), matched against the field key (an array item uses its array's key). `path` is `$` + `.key` segments with `[*]` for any array element, matched exactly against the node's *schema path* (not instance indices), e.g. `$.orders[*].total`. `type` is a node type.
Specificity (higher wins): `path` 100 · exact `key` 50 · glob `key` 30 · plus 10 when `type` is also given · bare `type` 10. Ties: higher preset `priority`, then the **later** rule (later within a preset; across presets, the preset with the higher priority, then later by array order).
Inference (DESIGN rules): `null` → `string` + `nullable` + `null_value`; email/UUID/ISO-date/ISO-datetime/URL-looking strings → the semantic type; whole numbers → `integer`, else `number`; arrays infer from element 0 with `count` = length (`empty_array`: `items: string`, `count: 0`); heterogeneous object elements → union of keys, keys missing from some elements get `nullable: true` + `optional_key` (D5) and `mixed_array_shapes`; elements of different primitive types → element 0's type + `mixed_array_types`; objects preserve key order; any root type is accepted; limits breaches stop inference with `limits_exceeded`.

## Acceptance criteria
- [x] `{match:{path:"$.address.city"}}` beats `{match:{key:"city"}}` beats `{match:{key:"*ty"}}` beats `{match:{type:"string"}}` on the field `address.city` (one test each pair).
- [x] Two equal-specificity rules → higher `priority` wins; equal priority → the later rule wins.
- [x] `{match:{key:"*_id",type:"string"}, pattern:"ID-{n:05}"}` yields `ID-00007` at n=7 for key `user_id` of type string, and does not apply to an `integer` named `user_id`.
- [x] `values: ["admin","manager","viewer"]` cycles by ordinal across a 4-element array → `admin,manager,viewer,admin`.
- [x] A rule with neither `value`, `values` nor `pattern`, or with two of them, or with an empty `match`, fails `PresetRuleSchema`.
- [x] `inferSchema` of `{"id":"8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f","n":1,"x":1.5,"d":"2026-01-02","e":"a@b.co","u":"https://x.io","z":null,"arr":[{"a":1},{"b":"x"}]}` gives `uuid, integer, number, date, email, url`, `z` as nullable `string` with `null_value`, and `arr` as `count: 2` over an object whose `a` and `b` are `nullable` with `optional_key` and `mixed_array_shapes`.
- [x] `inferSchema([])` → root array, `items: string`, `count: 0`, `empty_array`; `inferSchema(5)` → root `integer`.
- [x] Every output of `inferSchema` passes `validateSchema`.
- [x] `STARTER_PRESETS` each pass `PresetRuleSchema`, and every rule in them is exercised by a generation fixture.

, never a partial schema.
- **Known limitation:** `inferSchema` receives a parsed value, and JavaScript objects reorder integer-like keys (`"1"`, `"200"`) ahead of the rest at parse time. That order cannot be recovered; non-numeric keys keep their order. Inferring from raw JSON text would need a text-aware entry point (not in v1).

## Tests
Table-driven tests for specificity pairs and ties, pattern expansion, each inference rule and warning, a fuzz test that inference output always validates.

## Open questions
- Glob semantics beyond `*` (e.g. `?`, `{a,b}`) — deliberately excluded; confirm.
- Whether `type`-only rules should be allowed on `enum` nodes (this spec: yes, `enum` is a node type like any other).
