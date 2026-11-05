# 0016 — Zod 4
Status: accepted      Date: 2026-11-05

## Context
DESIGN.md names "Zod 3". PLAN decision D1 left it open: use Zod 4 if the OpenAPI generator and TanStack Form integrations support it. The whole contract package and `schema-core` are Zod, so switching later would touch every schema.

## Decision
**Zod 4.** The OpenAPI generator we need (`@asteasolutions/zod-to-openapi` 9.x) declares `zod ^4.0.0` as its peer, so Zod 3 would lock us out of the maintained generator. TanStack Form validates through the Standard Schema interface, which Zod 4 implements. Pin the exact Zod version in `packages/schema-core` and `packages/api-contract`.

## Consequences
- Use Zod 4 APIs (`z.strictObject`, `z.looseObject`, `.meta()`, `z.toJSONSchema`) — do not write Zod 3 idioms.
- `docs/DESIGN.md` stack table amended from "Zod 3" to "Zod 4" in the same commit.
- MockSchema nodes use `z.looseObject` (unknown keys preserved); request bodies use `z.strictObject` (unknown keys rejected).

- Full Zod (chained API), **not** `zod/mini`, ruled 2026-11-05: authoring ergonomics and contributor familiarity outweigh bundle size on a LAN tool. FND-05 measures the real tree-shaken size.

## Revisit if
The OpenAPI generator or TanStack integrations regress on Zod 4, or FND-05 measures a browser bundle size that is a real problem.
