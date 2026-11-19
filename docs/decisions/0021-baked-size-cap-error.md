# 0021 — Baked-size cap: status, details, fixed limit
Status: accepted      Date: 2026-11-19

## Context
ADR 0017 caps the total baked size of a version at 64 MiB, with error `baked_too_large` listing the largest cases. It does not say:

- which HTTP status to use;
- what the error details contain;
- whether operators can change the limit.

DESIGN.md and API-CONTRACT.md don't cover these either. The unit that builds the cap is RUN-14.

## Decision
1. **Status 422.** This matches the other publish failures (`empty_project`, `publish_invalid`): the request is valid, but the draft can't be published. 413 is not used, because it signals an oversized request body.
2. **Details: the 10 largest cases, largest first.** Each entry has `{ routeId, method, path, caseId, caseName, bytes }`, the same identifying fields as a `publish_invalid` entry plus `bytes`, the UTF-8 length of that case's baked body. The message states the total and the limit in MiB.
3. **The limit is fixed at 64 MiB** (67,108,864 bytes). There is no environment variable. A project that big should use `random` mode, which bakes nothing, so the cap does not apply to it.

## Consequences
- `versions.publish` gains `422 baked_too_large` in the registry and in API-CONTRACT §3.9. This is a main-session contract amendment and does not change the endpoint count.
- The Publish dialog can show these entries with the same list it uses for `publish_invalid`.

## Revisit if
Someone has a real deterministic project over 64 MiB that `random` mode doesn't serve, or memory measurements show a different limit is needed.
