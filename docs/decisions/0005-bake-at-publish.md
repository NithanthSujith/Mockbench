# 0005 — Bake responses at publish
Status: accepted      Date: 2026-11-05

## Context
For a deterministic project the bytes of a response cannot differ between calls; generating them per request is waste, and a malformed schema should fail at publish, not as a 500 in someone's test run.

## Decision
Publish validates, snapshots, then generates every case's body once and stores the JSON string alongside the snapshot. The data plane serves the string. `random` mode is the exception: it is generated per request and disables baking for that project.

## Consequences
- The hot path is "look up a string, write it to the socket".
- Large responses cost generation time once, bounded by the 50,000-leaf cap.
- Baked payloads are stored as a string, not `jsonb`, so serving needs no re-serialisation (PLAN D10: the column is `text`).
- A generator change does not alter already-published versions; the snapshot records `generatorVersion`.

## Revisit if
Memory for baked payloads becomes the limit (move to lazy per-case loading), or users want realistic per-request data by default.
