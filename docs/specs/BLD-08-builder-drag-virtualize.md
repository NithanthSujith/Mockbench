# BLD-08 — Schema builder: drag-reorder and virtualisation

Status: approved
Phase: 4   Team: Builder
Depends on: BLD-07
Size: M

## Goal
Rows can be reordered and re-parented by dragging, and the tree stays responsive with schemas of up to the 2,000-node limit by rendering only visible rows.

## In scope
- Drag handle per field row using dnd-kit: reorder within a parent, move into another object by dropping on/after it, with a drop indicator and keyboard alternative (Alt+↑/↓, Alt+←/→ indent/outdent).
- TanStack Virtual over `visibleRows` once more than ~200 rows are visible, preserving focus, scroll position and row heights.

## Out of scope
Store operations (BLD-06 provides `moveNode`), new node controls, touch-gesture polish beyond dnd-kit defaults.

## Contract
Uses `moveNode` and `visibleRows` from BLD-06; extends `SchemaBuilder` internals only. Dependencies: `@dnd-kit/*`, `@tanstack/react-virtual` (pre-declared).

## Acceptance criteria
- [ ] Dragging field `c` above `a` in `{a,b,c}` yields order `c,a,b` in the emitted schema; dragging a field into a sibling object appends it there and updates indentation.
- [ ] Dropping a node onto its own descendant is visibly refused (indicator turns `bad`) and the schema is unchanged.
- [ ] The `[ item ]` row of an array has no drag handle and cannot be moved or removed; a drag cannot detach an array's item node.
- [ ] Keyboard: focused row + `Alt+ArrowDown` moves it down one sibling; `Alt+ArrowRight` nests it into the previous sibling if that is an object; each move is announced via an `aria-live` region ("moved city after pincode").
- [ ] With a 2,000-node schema all expanded, the DOM contains at most 60 row elements and scrolling the full list keeps frame time under 16 ms p95 in a Playwright trace; typing in a key input has no visible lag (input-to-paint under 50 ms).
- [ ] Below 200 visible rows virtualisation is not used (all rows in the DOM) — asserted by DOM count at 199 vs 201 rows.
- [ ] Collapsing a node with 500 descendants removes them from the DOM in one frame; scroll position is retained.
- [ ] Undo after a drag restores the previous order in one step.

## Tests
Testing Library + dnd-kit test utilities for reorder/keyboard; Playwright perf test with a generated 2,000-node schema.

## Open questions
- Whether multi-select drag is wanted (assumed no).
