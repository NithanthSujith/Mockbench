# FND-02 — schema-core: MockSchema types, validator, limits

Status: in progress
Phase: 1   Team: Core
Depends on: FND-01
Size: M

## Goal
`packages/schema-core` exports the MockSchema TypeScript types, a Zod schema for the envelope, and `validateSchema()` that enforces structure and every limit — all importable in a browser, tolerant of unknown keys, and reserving `source`.

## In scope
- Node types and attributes exactly as DESIGN § Node types; envelope `{ version: 1, components, root }`; any node type may be the root (D2).
- `validateSchema(schema, { components? })` returning ok + stats or a list of issues; `LIMITS` constants; `emptySchema()`.
- **Unknown keys are preserved and ignored** (Zod `passthrough`), and `source` is accepted as any JSON and never interpreted.

## Out of scope
Generation (FND-03), presets and inference (FND-04), any API or UI. Interpreting `source`.

## Contract
Exports from `@mockbench/schema-core`:
```ts
type NodeType = 'string'|'number'|'integer'|'boolean'|'null'|'email'|'uuid'|'url'|'phone'|'date'|'datetime'|'enum'|'object'|'array'|'ref'
type MockNode = { type: NodeType; nullable?: boolean; description?: string; fixed?: Json; examples?: Json[]; source?: unknown
  min?: number; max?: number            // number, integer
  values?: (string|number|boolean)[]    // enum
  fields?: { key: string; node: MockNode }[]   // object, ordered
  items?: MockNode; count?: number      // array; count default 3
  name?: string                         // ref
  [unknown: string]: unknown }          // preserved
type MockSchema = { version: 1; components: Record<string, MockNode>; root: MockNode }
type Issue = { path: (string|number)[]; code: IssueCode; message: string }
validateSchema(input: unknown, opts?: { components?: Record<string, MockNode> }):
  { ok: true; schema: MockSchema; stats: { depth: number; nodes: number; estimatedLeaves: number } } | { ok: false; issues: Issue[] }
const LIMITS = { maxDepth: 10, maxNodes: 2000, maxArrayCount: 1000, maxLeaves: 50000, maxKeyLength: 200, maxEnumValues: 200 }
```
Issue codes: `invalid_type`, `unsupported_schema_version`, `unknown_node_type`, `duplicate_key`, `empty_key`, `forbidden_key` (`__proto__`), `depth_exceeded`, `node_limit_exceeded`, `array_count_exceeded`, `leaf_limit_exceeded`, `unknown_ref`, `ref_cycle`, `min_greater_than_max`, `enum_empty`, `missing_items`, `missing_fields`.
Semantics: `fixed` is "present" by **key presence** (so `""`, `0`, `false`, `null` are valid pins). Depth is measured on the **expanded** tree (through `ref`s). `estimatedLeaves` multiplies array counts along every path, computed without expanding (memoised per component) so a malicious schema cannot blow up the validator. `ref` resolves against `opts.components` merged over the envelope's `components` (caller-supplied wins). Cycles through `ref` are rejected in v1.

### Clarifications made while implementing (all strictly implied by the contract)
- **Depth** = number of nodes on the longest root-to-node path of the expanded tree; the root alone is 1. A chain of 10 nodes passes, 11 fails. The authored tree is also capped at the same depth during the structural pass so the validator never recurses into hostile input.
- **`estimatedLeaves`**: leaf = 1; object = sum of its fields; array = `count x items` (default count 3); `ref` = its component's value; every container counts at least 1, and a `count: 0` array counts 1 (never `0 x Infinity = NaN`).
- **Codes for limits the issue list does not name:** an enum with more than `LIMITS.maxEnumValues` values and a key longer than `LIMITS.maxKeyLength` both report `node_limit_exceeded`.
- **Envelope strictness:** `version` and `components` (object) and `root` (object) must all be present; a missing/wrong-typed one is `invalid_type`, a numeric/other `version` other than 1 is `unsupported_schema_version`. Unknown envelope keys are preserved like node keys.
- **`opts.components`** are structurally validated too (issue paths start `["options","components",<name>]`) and do not count toward the envelope's node limit. Every merged component is analysed (cycles, depth, leaves) even if unreferenced.
- **`schema` in a success result is the input object itself**, so unknown keys and key order are byte-identical; `mockSchemaZod`/`mockNodeZod` (Zod 4 `looseObject`) cover shape only and are not used inside `validateSchema`.
- `validateSchema` never throws: any unexpected exception becomes a single `invalid_type` issue.

## Acceptance criteria
- [x] The DESIGN worked-example envelope validates and `stats.nodes` equals its authored node count.
- [x] `{ version: 2, … }` returns `unsupported_schema_version`; a node `{ type: "wat" }` returns `unknown_node_type` with the path to it.
- [x] A node carrying `"source": { "from": "path", "name": "id" }` and an unrelated unknown key `"x-vendor": 1` validates, and the returned `schema` still contains both keys byte-for-byte after `JSON.stringify` round-trip.
- [x] Two fields with the same `key` in one object → `duplicate_key`; key `""` → `empty_key`; key `__proto__` → `forbidden_key`.
- [x] A schema nested 11 deep → `depth_exceeded`; 2,001 nodes → `node_limit_exceeded`; `count: 1001` → `array_count_exceeded`.
- [x] Two nested arrays `count: 1000` each (1,000,000 leaves) → `leaf_limit_exceeded`, and validation finishes in under 50 ms.
- [x] A `ref` to an undefined name → `unknown_ref`; a component referring to itself, or A→B→A → `ref_cycle`; a `ref` that resolves via `opts.components` passes.
- [x] `integer` with `min: 5, max: 1` → `min_greater_than_max`; `enum` with `values: []` → `enum_empty`.
- [x] Root `{ type: "array", items: { type: "string" } }` validates (D2).
- [x] `fixed: null`, `fixed: 0`, `fixed: ""` each validate and are retained.
- [x] The package builds with `platform: browser` and contains no Node builtin. *(Verified ad hoc with a one-off esbuild `--platform=browser` bundle of `src/index.ts`, which succeeds, and by the ESLint purity rule. The automated bundle test is FND-05.)*

## Tests
Unit tests, one per criterion above, named after the issue code. Round-trip test over a fixture containing every node type plus unknown keys.

## Open questions
- **Resolved 2026-11-05: keep full Zod 4 (not `zod/mini`)**, recorded in ADR 0016. The ~95 KB gzipped figure was the agent's unverified measurement of the whole package; re-measure a tree-shaken bundle in FND-05 and revisit only if it is a real problem.
- Should `fixed`/`examples` values be type-checked against the node type? (Default here: no — permissive.)
- Maximum length for string `fixed` and `description` (placeholder: 10 000 / 2 000 chars).
