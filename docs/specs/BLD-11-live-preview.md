# BLD-11 — Live preview pane

Status: approved
Phase: 3   Team: Builder
Depends on: BLD-05, FND-03
Size: M

## Goal
The response column shows, locally and on every edit, the exact JSON the server will bake for the selected case — with pinned and generated values visually distinguished — and says plainly why values look like `name-1`.

## In scope
- `<ResponsePreview>` in the BLD-05 `PreviewSlot`: status chip, case name, generation mode label, the JSON via `JsonView` + provenance from `generate()`, diagnostic headers block (`X-Mock-Version`, `X-Mock-Route`, `X-Mock-Case`, delay), legend.
- Debounced (150 ms) local generation using project `settings`, the project's **enabled** presets, project components and `projectId`.
- The one-sentence determinism explanation beside the mode label; mode `random` warning chip; error states (invalid schema, limit exceeded).

## Out of scope
The Try-it/curl card (BLD-12), the server `schema/preview` endpoint, a Web Worker (only if measurement shows stutter).

## Contract
`schema-core`: `generate`, `buildPresetResolver`, `validateSchema`. Endpoints read: `presets.list`, `projects.get` (settings/components). Components: `JsonView` (FND-12).

## Acceptance criteria
- [ ] Editing the schema updates the preview exactly once, 150 ms after the last change (fake-timer test); no network request is made while typing (`fetch` spy has zero calls).
- [ ] For the worked-example schema the preview text equals the committed schema-core golden byte-for-byte.
- [ ] A leaf covered by an enabled preset rule (`currency → INR`) is rendered with the pinned/fixed style; a generated leaf with the dashed signal underline; the legend explains both ("`name-1` generated from the key", "`INR` pinned or from a preset").
- [ ] The text "Values come from the key and position, so `role` becomes `role-1` — change this in project settings." appears next to the mode label in deterministic mode; in `random` mode a warning chip "Fresh on every request — not baked" replaces it.
- [ ] A `204` case shows "— 204 sends no response body —"; an invalid schema shows the validator issues instead of JSON; a schema over the leaf limit shows "Too large to preview: would generate N values (limit 50,000)" and never freezes the tab.
- [ ] With a 2,000-node schema the pane stays interactive (typing in the builder keeps input-to-paint under 100 ms).
- [ ] A contract test confirms that for the same schema, settings, presets and `projectId`, the preview `json` equals the response of `POST /schema/preview` (run against the real API once BLD-03 is merged).
- [ ] Toggling a preset on the Presets screen and returning updates the preview (cache invalidation of `presets`).
- [ ] The JSON block scrolls independently and is selectable/copyable; mono font and `t-*` colours.

## Tests
Testing Library with fake timers; the cross-check test against `schema.preview`; a perf test for the big schema.

## Open questions
- Whether to show the exact serialized form (compact) or the pretty form (assumed pretty, 2 spaces, identical content).
