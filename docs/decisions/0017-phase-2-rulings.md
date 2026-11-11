# 0017 — Phase 2 rulings
Status: accepted      Date: 2026-11-11

## Context
Phase 2 units raised four open questions. The owner accepted the recommended defaults.

## Decision
1. **Last-owner race (WS-02).** When two requests race to demote or remove different owners of a two-owner workspace, exactly one succeeds and one owner remains. The loser gets `409 last_owner`, `403` (demoted by the winner first) or `404` (removed by the winner first). All three are correct.
2. **Argon2 parameters (AUTH-02).** Keep `m=19456 KiB, t=2, p=1` (OWASP minimum). The parameters are encoded in each hash, so raising them later does not invalidate stored hashes. The login limiter stays keyed on IP only.
3. **Default version label (RUN-02).** The default label `v<seq>` can collide with a label the user chose earlier. That publish returns `409 label_taken` and the user supplies a label. No auto-skipping.
4. **Total baked size per version (RUN-01/02).** Cap at **64 MiB**, error `baked_too_large` listing the largest cases. Not implemented yet; a follow-up unit adds it. Per-response limits in schema-core still apply.

## Consequences
- WS-02's race criterion is amended to accept 403, 404 or 409 for the loser.
- A follow-up spec is needed for the baked-size cap.

## Revisit if
Users hit label collisions often, or a LAN deployment needs stronger password hashing.
