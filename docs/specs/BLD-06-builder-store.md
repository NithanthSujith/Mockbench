# BLD-06 — Schema builder store (headless)

Status: approved
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
- [ ] For every fixture in schema-core's corpus, `toSchema(fromSchema(x))` is deeply equal to `x` — including unknown node keys (`source`, `x-vendor`), field order, numeric-like keys, root arrays, and falsy `fixed` values (`0`, `""`, `false`, `null`).
- [ ] `setType` from `object` to `string` on a node with 3 children: `previewTypeChange` reports 3 discarded; applying it removes all three descendants from `nodes` (no orphans: every id in `nodes` is reachable from `rootId`).
- [ ] `setType` to `array` creates exactly one item node (type `string`); to `object` creates one default field `field_a`; to `enum` sets `values: ["one","two","three"]` when none exist; switching back preserves nothing it cannot represent and reports that.
- [ ] `moveNode` within one parent is a splice of `childIds` (indices before/after as expected, 6-case table); moving a node into its own descendant is rejected and leaves state unchanged; moving across parents updates both `childIds` and the node's `parentId`.
- [ ] `removeNode` on an object removes the entire subtree; the root cannot be removed.
- [ ] `setKey` to a key that already exists in the same object is applied but `visibleRows` marks both rows `duplicateKey: true`; `toSchema` of such a state still returns the structure (validation reports `duplicate_key` elsewhere).
- [ ] After 5 mixed operations, 5 undos restore a state deeply equal to the initial; redo re-applies; a new operation after an undo clears the redo stack; the stack never exceeds 100 entries.
- [ ] With a 2,000-node schema, `setKey` and `moveNode` each complete in under 20 ms (measured over 50 runs, median) and snapshots share structure (a `setKey` creates O(depth) new objects).
- [ ] `visibleRows` hides descendants of collapsed nodes and renders an array's single item as a row of kind `item` at depth+1.
- [ ] `ref` nodes keep `name`; a node's unknown keys appear in `extras` and are not editable via `setAttr`.

## Tests
Vitest only. Round-trip over the shared corpus; operation tables; undo/redo; perf budget test.

## Open questions
- Undo granularity for text input (assumed: a burst of key edits on one node within 500 ms coalesces into one entry).
