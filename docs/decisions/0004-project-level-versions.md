# 0004 — Project-level versions, not per-route
Status: accepted      Date: 2026-11-05

## Context
Users want to "pick the response version to make live". Versioning each route separately lets a consumer hit a half-upgraded API (route A on v3, route B on v1) — the exact bug a mock server exists to rule out.

## Decision
Publishing snapshots the whole project (settings, routes, cases, enabled presets, components) into one immutable `versions` row. A single pointer, `projects.active_version_id`, says which is live. Rollback is a deploy of an older version.

## Consequences
- One coherent API surface, one thing to roll back, a shareable "we are on v4".
- A one-field fix produces a new version number; labels are free text so this is cheap.
- Version diff is computed from two structured snapshots.

## Revisit if
Users actually need an independent per-route release cadence. That would rework the Versioning section and the `versions` table.
