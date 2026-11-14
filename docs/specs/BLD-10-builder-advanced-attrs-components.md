# BLD-10 — Schema builder: advanced attributes and components

Status: done
Phase: 4   Team: Builder
Depends on: BLD-07
Size: M

## Goal
Every node attribute in MockSchema is editable in the builder — pinned value, examples, min/max, nullable, description — and `ref` nodes can point at project-level components that users can create and manage.

## In scope
- Per-row controls: pin-value toggle with a typed input per node type (the prototype's "pinned" field), an expandable attribute panel (examples list, min/max, nullable, description).
- `ref` node UI: component picker plus a "Manage components" dialog (list, add from a case's subtree "Save as component", rename, delete) persisted through `projects.update { components }`.
- Inline validation badges for `min_greater_than_max`, `unknown_ref`, `ref_cycle`.

## Out of scope
Server code (components live on `projects`, PRJ-01), `source` editing, preset editing.

## Contract
Endpoints `projects.get`, `projects.update` (the `components` field). Store ops `setAttr`, `setType('ref')`. `schema-core` validator issue codes. Component names per API-CONTRACT §1.7.

## Acceptance criteria
- [x] Pinning on an `integer` row with value `0` stores `fixed: 0`; the preview shows `0` with the pinned style; unpinning removes the `fixed` key entirely; pinning on a `boolean` row offers a true/false toggle, on `string` a text input; "Pin null" is available for any leaf.
- [x] Pinned rows show the `signal-soft` fill and `signal-line` border (tokens), identical to the prototype's pinned input.
- [x] `min: 5, max: 1` shows "min is greater than max" on the row and blocks saving; setting `nullable` stores `nullable: true`; `description` is stored and shown as a tooltip.
- [x] Examples list: adding three entries stores `examples` in order; a 3-element array cycles through them in the preview.
- [x] A `ref` row lists the project's components in a select; picking one stores `{type:"ref", name}`; the "Manage components" dialog creates a component from a selected object subtree and the project's `components` is updated with one `projects.update` call.
- [x] Deleting a component still referenced by a stored case shows the server message for `component_in_use` and keeps it; renaming a component updates referencing nodes **in the open case** and warns that other cases must be updated.
- [x] A `ref` to a name absent from the project shows a red `unknown_ref` badge; a self-referencing component shows `ref_cycle`.
- [x] Unknown node keys remain visible in a read-only "extra attributes" line and are preserved on save.
- [x] Viewers see all attributes read-only.

## Tests
Testing Library for each control and badge; round-trip test confirming `extras` survive; Playwright for component create → ref → preview in MSW mode.

## Open questions
- "Save as component" extracts and replaces the subtree with a `ref` — confirm that is wanted versus copy-only.

## Implementation notes
- "Save as component" is **copy-only**: the object stays in the case and a component is added. Replacing the subtree with a `ref` is not implemented until the question above is answered.
- Rename sends one `projects.update` with the new name and the old one removed. If the server refuses (a stored case still uses the old name, which is the usual case for the open case, whose edits are saved after a debounce), it sends a second update that keeps both names; the open case is retargeted either way and the dialog says the old name was kept.
- A schema with `min` greater than `max` is not emitted to the editor (so it is not autosaved) until the row is fixed; the builder header says so.
- The Playwright flow is not added: `e2e/` runs against the real server stack, not MSW. Covered by Testing Library tests in `Attributes.test.tsx`.
