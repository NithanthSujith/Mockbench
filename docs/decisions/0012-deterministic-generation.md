# 0012 — Deterministic, legible generation by default
Status: accepted      Date: 2026-11-05

## Context
Faker-style output looks better in a screenshot and is worse to debug against; a developer reading `address.city: "city-1"` knows which field they are looking at.

## Decision
`value = f(key, type, ordinal)`. Deterministic is the default mode and is baked. `seeded` (realistic but stable) and `random` (fresh per request, unbaked) are opt-in project settings. Precedence: `fixed` › preset rule › `examples[]` › `enum.values` › per-type rule.

## Consequences
- Responses never shift under a consumer's test suite.
- Users expecting realistic data see `name-1`; the preview pane explains it in one sentence.
- The generator is a frozen public contract; changes bump `generatorVersion`.

## Revisit if
Realistic data matters more than stable data for most users.
