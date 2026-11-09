# BLD-06 — Schema builder store (headless)

Status: done
Phase: 2   Team: Builder
Depends on: FND-02
Size: M

## Goal
A UI-independent, fully tested state engine for the schema builder: a normalised node store with every editing operation, undo/redo, and lossless conversion to and from MockSchema — the part DESIGN says to design before any UI.

## In scope
- State shape `{ rootId, nodes: Record<NodeId,{id,type,key,parentId,childIds,attrs,extras}>, expanded: Set<NodeId> }` (`extras` holds unknown keys so they survive); `fromSchema`, `toSchema`, `visibleRows(state)` (flat list with depth and kind).
- Operations: `setKey`, `setType` (with `previewTypeChange` returning how many descendants would be discarded), `addField`, `removeNode`, `moveNode(id, newParentId, index)`, `setAttr`, `toggleExpanded`, `replaceAll`.
- Undo/redo as a bounded stack (100) of whole-state snapshots (Immer structural sharing); a Zustand store wrapper exposing the above.

## Out of scope
Any React component (BLD-07+), drag-and-drop gestures (BLD-08), persistence, the JSON tab.

## Contract
Exports from `apps/web/src/features/schema-builder/store/`: `createBuilderStore(initial: MockSchema)`, the operation functions (pure), `fromSchema`, `toSchema`, `visibleRows`, `previewTypeChange`. Depends only on `@mockbench/schema-core` types and validator.

## Acceptance criteria
- [x] For every fixture in schema-core's corpus, `toSchema(fromSchema(x))` is deeply equal to `x` — including unknown node keys (`source`, `x-vendor`), field order, numeric-like keys, root arrays, and falsy `fixed` values (`0`, `""`, `false`, `null`).
- [x] `setType` from `object` to `string` on a node with 3 children: `previewTypeChange` reports 3 discarded; applying it removes all three descendants from `nodes` (no orphans: every id in `nodes` is reachable from `rootId`).
- [x] `setType` to `array` creates exactly one item node (type `string`); to `object` creates one default field `field_a`; to `enum` sets `values: ["one","two","three"]` when none exist; switching back preserves nothing it cannot represent and reports that.
- [x] `moveNode` within one parent is a splice of `childIds` (indices before/after as expected, 6-case table); moving a node into its own descendant is rejected and leaves state unchanged; moving across parents updates both `childIds` and the node's `parentId`.
- [x] `removeNode` on an object removes the entire subtree; the root cannot be removed.
- [x] `setKey` to a key that already exists in the same object is applied but `visibleRows` marks both rows `duplicateKey: true`; `toSchema` of such a state still returns the structure (validation reports `duplicate_key` elsewhere).
- [x] After 5 mixed operations, 5 undos restore a state deeply equal to the initial; redo re-applies; a new operation after an undo clears the redo stack; the stack never exceeds 100 entries.
- [x] With a 2,000-node schema, `setKey` and `moveNode` each complete in under 20 ms (measured over 50 runs, median) and snapshots share structure (a `setKey` creates O(depth) new objects).
- [x] `visibleRows` hides descendants of collapsed nodes and renders an array's single item as a row of kind `item` at depth+1.
- [x] `ref` nodes keep `name`; a node's unknown keys appear in `extras` and are not editable via `setAttr`.

## Tests
Vitest only. Round-trip over the shared corpus; operation tables; undo/redo; perf budget test.

## Open questions
- Undo granularity for text input (assumed: a burst of key edits on one node within 500 ms coalesces into one entry).

## Implementation notes (2026-11-09)

Files: `apps/web/src/features/schema-builder/store/{types,json,convert,ops,rows,store,index}.ts` plus `*.test.ts` (85 tests: `convert` 27, `ops` 30, `rows` 6, `store` 16, `perf` 6). Verified by deliberately breaking six behaviours (move into a descendant, setType leaving descendants, unbounded history, dropping unknown keys, falsy attributes treated as absent, no coalescing): each made tests fail.

**Drift from the spec (none changes the contract):**
- **State carries the envelope.** `BuilderState` is `{ rootId, nodes, expanded, nextId, envelope }`. `envelope` holds `version`, the schema's `components` (opaque here; managed by BLD-10) and any unknown top-level keys, so `toSchema(fromSchema(x))` is lossless for the whole document, not only the root.
- **Byte-identical, not just deep-equal.** Nodes remember their original property order (`order`), and field entries remember theirs (`entryOrder`, `entryExtras`), so `JSON.stringify(toSchema(fromSchema(x)))` equals `JSON.stringify(x)` for every corpus fixture. BLD-09's "Builder -> JSON -> Builder is byte-identical" criterion can rely on this.
- **`expanded` is a `Set`** (as in the spec). Containers start expanded; `setType` to a container expands it; `addField` and `moveNode` expand the target parent.
- **`toggleExpanded` is not an undo step** (UI state). Undo/redo keep the user's current expand/collapse choices for nodes that are containers on both sides, and containers that were not containers in the state being left start expanded.
- **Ids are `n<counter>`** minted from `state.nextId`, so every operation is pure and deterministic.
- **`addField` returns `{ state, id }`** (the only operation that returns more than a state). Its default key is `new_field`, then `new_field_2`, ... so adding twice does not create a duplicate.
- **Rejected edits return the same state object**, which is how the store knows not to add history. Rejected: setKey on the root or an array item; removeNode on the root or an array item (an array always keeps exactly one item: change its type instead); moveNode of the root, an array item, into a non-object, into itself or its own subtree; setAttr of an unknown/structural/unknown-extra key or an attribute that does not apply to the node's type.
- **`moveNode(id, newParentId, index)`**: `index` is the node's final position among the target's fields after it is taken out of its old place, clamped to the valid range; a move to where it already is returns the same state.
- **`setAttr`** applies only to the known attributes (`nullable`, `description`, `fixed`, `examples`, `min`, `max`, `values`, `count`, `name`), by key presence (`0`, `""`, `false`, `null` are real values; `undefined` removes). `min`/`max` apply to number/integer, `values` to enum, `count` to array, `name` to ref.
- **`setType`** drops attributes that mean nothing for the new type (`previewTypeChange` lists them in `discardedAttrs`); universal attributes (`nullable`, `description`, `fixed`, `examples`) survive.
- **`visibleRows`** does not include the root as a row; the root's children are depth 0. A collapsed root is not a thing (the root has no toggle). A root array shows its item at depth 0.
- **Store shape:** `createBuilderStore(initial, { clock?, historyLimit?, coalesceMs? })` returns a vanilla Zustand store (`zustand/vanilla`), no React. State: `state` (present), `past`, `future`, `canUndo`, `canRedo`; actions `setKey`, `setType` (returns the discard/create report, or null), `addField` (returns the id, or null), `removeNode`, `moveNode`, `setAttr`, `replaceAll`, `toggleExpanded`, `undo`, `redo`, plus `toSchema()` and `rows()`. Edits that change nothing return false/null and add no history.
- **Coalescing:** consecutive `setKey` calls on the same node less than 500 ms apart (measured from the previous keystroke, by an injectable clock) are one undo step; any other edit, another node, or an undo/redo ends the burst. This resolves the spec's open question as assumed.
- **One repair on load:** an array with no `items` gets a string item (an array always has exactly one item node); everything else about invalid input is left as is for the validator to report.

**Performance (2,000-node schema, 1,999 sibling fields):** setKey and moveNode each far under the 20 ms median budget on the test machine (budget asserted in `perf.test.ts`); a setKey changes exactly one node object, and `expanded` and `envelope` keep their identity.

## Questions for the owner
- None blocking. For BLD-07: `rows()` does not return the root; read `state.nodes[state.rootId]` for the root's type.
