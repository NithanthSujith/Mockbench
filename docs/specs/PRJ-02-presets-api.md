# PRJ-02 — Presets API

Status: approved
Phase: 2   Team: Projects
Depends on: PRJ-01
Size: S

## Goal
Project-scoped data presets can be listed, created, edited and deleted, with rules validated by `schema-core`.

## In scope
Handlers for `presets.list`, `presets.create`, `presets.update`, `presets.delete`; rule validation via `PresetRuleSchema`; ordering by priority.

## Out of scope
Applying presets (generation; FND-04), the screen (PRJ-03), shipping starter packs automatically into new projects.

## Contract
Endpoints per API-CONTRACT §3.5. Table: `data_presets`. Rule shape from `@mockbench/schema-core` (`PresetRuleSchema`).

## Acceptance criteria
- [ ] `POST /projects/:id/presets {name, rules:[…]}` as editor → `201` with `isEnabled:true`, `priority:0` defaults; as viewer → `403`; non-member → `404`.
- [ ] A rule with two of `value|values|pattern`, with none, or with an empty `match` → `422` whose `details[].path` points into `rules[i]`.
- [ ] `PATCH {rules:[…]}` replaces the whole rule list; `{isEnabled:false}` leaves rules untouched; `{name:null}` → `422`.
- [ ] `GET …/presets` orders by `priority` desc then `createdAt` asc, returns all, and `nextCursor` is `null`.
- [ ] `DELETE /presets/:id` as editor → `204`; a preset id belonging to another workspace's project → `404`.
- [ ] More than 500 rules in one preset → `422` (limit documented in the schema).

## Tests
Role matrix; rule validation table; ordering test.

## Open questions
- Whether preset names must be unique per project (assumed no; import appends " (2)").
