# BLD-07 — Schema builder tree UI

Status: approved
Phase: 3   Team: Builder
Depends on: BLD-06, BLD-05
Size: M

## Goal
The Builder tab renders the store as the prototype's tree — one row per node, indented — with controls for key, type and the type-specific attribute, and add/delete, wired into the case editor.

## In scope
- `<SchemaBuilder value onChange readOnly />` rendering `visibleRows`: twist, key input (mono), type select (the 15 types), type-specific control (enum values, array count, object field count), add-field on `object`, delete on fields, `[ item ]` rows for arrays.
- Confirmation dialog when a type change would discard children (uses `previewTypeChange`).
- Inline duplicate-key warning; empty-body hint; emits `onChange(MockSchema)` debounced.

## Out of scope
Drag-reorder and virtualisation (BLD-08), pin/examples/min/max/nullable/description/ref controls (BLD-10), the JSON tab (BLD-09), preview.

## Contract
Component `features/schema-builder/SchemaBuilder`; consumes the BLD-06 store; mounted in the BLD-05 `SchemaEditorSlot`. Uses ui-kit `Input`, `Select`, `IconButton`, `Dialog`; row layout per prototype `.brow` (`auto / 1.3fr / 118px / 1.4fr / auto`).

## Acceptance criteria
- [ ] The DESIGN worked-example schema renders 16 rows with correct indentation (`address.city` at depth 2), key inputs in mono, types in the select, and `branch_list` showing `count 3` and its `[ item ]` row.
- [ ] Renaming a key updates the store and, after the debounce, calls `onChange` with the new schema; the field order is unchanged.
- [ ] Changing `address` from object to string shows "Switching to string discards 2 child fields" with Cancel/Discard; Cancel leaves the tree intact; Discard removes the children.
- [ ] "+" on an object row appends `new_field` (string) and focuses its key input; the button does not exist on non-object rows.
- [ ] Array `count` input clamps to 0–1000 and shows an inline warning above 50 ("large arrays slow the preview").
- [ ] Two sibling keys with the same name both show an amber "duplicate key" marker and the case cannot be saved until fixed (the editor shows the validator's `duplicate_key`).
- [ ] The root row for a root-array schema shows `[ item ]` rows directly; an empty object root shows "This case returns an empty body." with "+ Add field".
- [ ] Keyboard: Tab order is twist → key → type → extra → actions per row; Enter in a key input commits; Escape reverts the field; every control has an accessible name.
- [ ] In `readOnly` mode no control is enabled and nothing emits `onChange`.
- [ ] Collapsing/expanding a node persists for the session of the editor (not in the URL) and survives a case switch back.
- [ ] All colours via tokens; row hover reveals actions at full opacity, with them visible at 30 % otherwise and always visible below 860 px.

## Tests
Testing Library for each interaction; a snapshot of the rendered row structure for the worked example.

## Open questions
- Whether enum values should be edited inline as comma text (prototype) or as chips (assumed comma text for now).
