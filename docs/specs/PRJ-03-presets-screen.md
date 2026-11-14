# PRJ-03 — Presets screen

Status: done
Phase: 4   Team: Projects
Depends on: PRJ-02, PRJ-04
Size: M

## Goal
At `/p/$projectSlug/presets` a user manages presets — rules, enable/disable, priority, import/export as JSON, and starter packs — and sees what a rule will do before saving.

## In scope
- Presets list with enable toggle and priority; preset editor (name, rules table: match key/path/type, kind value/values/pattern).
- Import from / export to a JSON file (client-side) and "Add from template" using `STARTER_PRESETS`.
- A live sample showing the preset applied to a small sample schema via `schema-core`.

## Out of scope
Server changes. Editing a field's pinned value (BLD-10).

## Contract
Endpoints `presets.list`, `presets.create`, `presets.update`, `presets.delete`. `schema-core`: `PresetRuleSchema`, `STARTER_PRESETS`, `buildPresetResolver`, `generate`. UI route `/p/$projectSlug/presets`. Export file: `{ "name": string, "priority": number, "rules": PresetRule[] }`.

## Acceptance criteria
- [x] The list shows each preset's name, rule count, priority and an enable switch; toggling calls `presets.update` and the switch reflects the server on failure.
- [x] Adding a rule `key=currency, value=INR` and saving persists it; the live sample shows `INR` for a `currency` field.
- [x] Choosing `values` with `admin, manager, viewer` shows `admin, manager, viewer, admin` for a four-element sample array.
- [x] A rule with no output or two outputs cannot be saved and shows the field-level message; `pattern` input shows a preview for n=1 and n=12 (`ID-00001`, `ID-00012`).
- [x] Export downloads `<name>.preset.json`; importing a file with a malformed rule shows each issue with its rule index and creates nothing; importing a valid file creates a preset.
- [x] "Add from template" lists the starter packs and creates a disabled copy of the chosen one.
- [x] Viewers see the screen read-only (no save/import/delete); the specificity order (path › key › glob › type) is explained in one sentence on the page.
- [x] Rule tables and the pattern field use the mono font; no colour literals.

## Tests
Testing Library for validation and live sample; Playwright for import/export round-trip.

## Open questions
- Drag-reordering rules (assumed not needed: order is by specificity then position).
