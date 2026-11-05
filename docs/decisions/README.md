# Architecture decision records

One file per decision that a later session might be tempted to relitigate. Short: context, decision, consequences, what would make us revisit. Numbered in the order written; never renumbered. A superseded ADR stays and gets `Status: superseded by NNNN`.

New decisions arise under `docs/WORKFLOW.md` rule 5: stop, ask, record here, amend the spec.

| # | Decision | Status |
| --- | --- | --- |
| 0001 | Express 5 over Fastify | accepted |
| 0002 | Drizzle over Prisma | accepted |
| 0003 | DB sessions over JWT | accepted |
| 0004 | Project-level versions, not per-route | accepted |
| 0005 | Bake responses at publish | accepted |
| 0006 | Header-based case selection | accepted |
| 0007 | No Redis | accepted |
| 0008 | MIT license | accepted |
| 0009 | Dark mode only | accepted |
| 0010 | OpenAPI import deferred past v1 | accepted |
| 0011 | Two planes in one process | accepted |
| 0012 | Deterministic, legible generation by default | accepted |
| 0013 | PostgreSQL, not SQLite | accepted |
| 0014 | Path-prefixed mock URLs (`/mock/<slug>`) | accepted |
| 0015 | Contract-first: Zod endpoint registry | proposed (this planning session) |

Template:

    # NNNN — Title
    Status: accepted | proposed | superseded by NNNN      Date: YYYY-MM-DD
    ## Context
    ## Decision
    ## Consequences
    ## Revisit if
