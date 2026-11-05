# 0001 — Express 5 over Fastify
Status: accepted      Date: 2026-11-05

## Context
The backend needs an HTTP layer for two workloads. The data plane writes a pre-baked string to the socket, so the framework is nowhere near the bottleneck. Mockbench is a tool people fork and modify.

## Decision
Express 5 on plain Node. Never NestJS, never Fastify, never a framework layered on Express. Express 5 specifically because it forwards async handler errors natively, which both error-handling trees rely on.

## Consequences
- Every Node developer can read and modify the server.
- We give up microseconds per request in the router; the data plane uses its own radix tree for route matching anyway.
- Fastify-isms (schema-compiled serialisation, plugins) are not available; validation is Zod at the handler edge.

## Revisit if
A benchmark shows the HTTP layer, not the handler, as the data-plane bottleneck. Fastify is close to a drop-in swap and the two-plane split survives it.
