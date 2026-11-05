# 0006 — Header-based case selection
Status: accepted      Date: 2026-11-05

## Context
A route has several response cases (200, 404, 500). A caller must be able to pick one.

## Decision
`X-Mock-Case` header (name or id) first, then the `__case` query parameter, then `X-Mock-Status` (matches a case's status code), then the route's default. A selector that matches nothing returns `400 case_not_found` from the mock server — never a silent fall-back to the default.

## Consequences
- Explicit, works from curl and browser devtools, needs no understanding of consumer payloads.
- Matching on request body or query values is not supported in v1.
- Failing loudly means QA never loses an hour to an error path that "never fires".

## Revisit if
Body- or query-value matching is requested (planned as v1.1 in DESIGN's non-goals table).
