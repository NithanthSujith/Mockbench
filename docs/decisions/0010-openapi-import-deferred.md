# 0010 — OpenAPI import deferred past v1
Status: accepted      Date: 2026-11-05

## Context
Importing real-world OpenAPI specs (`oneOf`, `discriminator`, circular refs, vendor extensions) is the largest bug surface in the project, and the core loop — define, publish, call — does not need it.

## Decision
No work unit builds the importer in v1. It is recorded in DESIGN.md under "Future improvement: OpenAPI import". Two v1 constraints keep it cheap to add later: MockSchema reserves the `source` key and the validator/generator **ignore and preserve unknown keys**; and the control plane's own `/api/v1/openapi.json` (generated from Zod) stays in v1 — it is a different feature.

## Consequences
- v1 gives up Prism's "point it at your existing spec" onboarding story; DESIGN says to restore it before any public announcement.
- No migration across stored versions is needed when the importer lands.
- The route `/p/:slug/import` is not built; there are no `imports` tables or endpoints.

## Revisit if
Before the public announcement, or when users ask for it repeatedly.
