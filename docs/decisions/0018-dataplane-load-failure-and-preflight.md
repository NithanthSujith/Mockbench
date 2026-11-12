# 0018 — Data-plane load failures, preflight and read-only builder
Status: accepted      Date: 2026-11-12

## Context
Phase 3 review of RUN-05, BLD-07, BLD-11 and RUN-08 raised questions the contract did not cover. The owner accepted the recommended defaults.

## Decision
1. **Load failure code (RUN-05).** When the cache cannot load a project's live version (database unreachable, or a snapshot that does not compile) the data plane answers `503 mock_unavailable` with `{ error, message, hint, slug }` and `X-Mock-Error: true`. `project_not_published` is kept for a project that really has no active version, so an outage is no longer reported as "not published". Nothing is cached on failure; the next request retries. The new code is in `MOCK_ERROR_CODES`, `MockErrorBody`, API-CONTRACT 4.1/4.5 and DESIGN. `request_logs.mock_error` is free text, so no migration.
2. **`OPTIONS` and `cors: "off"` (RUN-05).** `OPTIONS` is answered before the project is required to exist. For a project already in the cache the handler reads `settings.cors` so `"off"` gets the bare `204`; for an unknown slug, an unpublished project or a failed load it answers with permissive CORS so the browser can read the real error. No database query is made for `OPTIONS`.
3. **Read-only builder (BLD-07).** In read-only mode every edit control is disabled; the collapse/expand twists stay usable because collapsing changes nothing saved and lets a viewer browse a large tree. The spec wording "no control is enabled" is amended to "no edit control".
4. **Preview copy (BLD-11).** The seeded-mode sentence stays "Values are drawn from stable pools seeded by the key and position."
5. **Not done.** Retention numbers are not exposed on `system.instance`; the logs screen says "Older entries are pruned automatically." Revisit if users ask.

## Consequences
- Consumers and the request log can tell an outage (`mock_unavailable`) from an unpublished project.
- Log filters should move into the URL (route `validateSearch`) as a follow-up to RUN-08; the route tree is main-session owned.

## Revisit if
`OPTIONS` handling needs to differ per project beyond `cors`, or an operator asks to see retention settings in the UI.
