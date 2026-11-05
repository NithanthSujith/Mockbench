# 0015 — Contract-first: a Zod endpoint registry
Status: proposed      Date: 2026-11-05

## Context
Five teams build against the HTTP surface without talking. Prose alone drifts; each team re-typing request/response shapes guarantees divergence.

## Decision
`packages/api-contract` holds a registry: for each endpoint an id, method, path, auth level, Zod schemas for params/query/body/responses/errors, and an example payload. The Express app binds handlers from it, the web client types calls from it, MSW serves its examples, `/api/v1/openapi.json` is generated from it, and `docs/API-CONTRACT.md` is checked against it in CI.

## Consequences
- One definition validates requests, types the client and documents the API.
- The registry is a shared, main-session-only file: changing it is a deliberate act.
- Unimplemented endpoints exist from day one as `501 not_implemented`, so frontends see a clear failure.

## Revisit if
The registry's indirection slows teams more than it prevents drift.
