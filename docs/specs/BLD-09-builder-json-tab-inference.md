# BLD-09 — Schema builder JSON tab and paste-JSON inference

Status: done
Phase: 3   Team: Builder
Depends on: BLD-06, BLD-05, BLD-03
Size: M

## Goal
A second editing view of the same schema — a JSON editor — plus the "paste an example" path that infers a schema, so a case's body can be authored two ways that produce the same MockSchema. This tab alone is enough for the first usable release.

## In scope
- The JSON tab: CodeMirror 6 showing the full envelope `{version, components, root}`; **parses on blur** and replaces the store when valid; shows parse errors (line/column) and validator issues (path, message) without touching the store.
- "Infer from example" mode: paste any JSON, call `inferSchema` locally, show warnings, and open the Builder tab on the result; an explicit "Inference is a starting point — check the types" notice; amber marker on `null_value` nodes.
- Tab strip `Builder | JSON` (the Preview is a separate column, BLD-11).

## Out of scope
The tree UI (BLD-07), autosave (BLD-05 owns it), server-side inference use.

## Contract
`schema-core`: `validateSchema`, `inferSchema`. Store: `replaceAll`, `toSchema`. Component `features/schema-builder/JsonTab`; mounted in `SchemaEditorSlot`.

## Acceptance criteria
- [x] Editing a value in the JSON tab and blurring updates the Builder tab and the emitted `onChange` with the new schema; switching tabs preserves unsaved JSON text until blur.
- [x] Malformed JSON on blur shows "Unexpected token … at line 4, column 7", highlights the position, keeps the previous schema in the store and blocks autosave; fixing and blurring clears the error.
- [x] Well-formed JSON that fails `validateSchema` (unknown type, duplicate key, over a limit) shows each issue as `path — message`, does not replace the store, and does not save.
- [x] A schema containing `"source": {"from":"path","name":"id"}` and an unknown key survives Builder→JSON→Builder unchanged (byte-compare of `JSON.stringify(toSchema)`).
- [x] Builder→JSON→Builder round-trip is lossless for the entire schema-core fixture corpus.
- [x] Pasting `{"role":"admin","tags":["a","b"],"meta":null}` in Infer mode produces `role:string`, `tags: array count 2 of string`, `meta:string nullable` marked amber with "Real type unknown (was null)"; the notice is visible; accepting opens the Builder tab.
- [x] Inferring a sample larger than the node limit shows the `limits_exceeded` warning and does not replace the current schema.
- [x] A 2,000-node schema loads into the JSON editor and parses on blur in under 200 ms.
- [x] The editor uses the mono font and token colours (a custom CodeMirror theme from the `t-*` tokens); no network request is made for editor assets.

## Tests
Testing Library for blur/parse/issue states; round-trip test over the shared corpus; Playwright for the infer flow in MSW mode (not added: no builder e2e harness exists yet; the infer flow is covered by Testing Library in `JsonTab.test.tsx`).

## Open questions
- Whether the JSON tab should show the envelope or only `root` (prototype shows `{version, root}`; this spec shows the envelope so `components` are editable).
