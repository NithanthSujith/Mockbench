# RUN-13 — Data-plane rate cap

Status: approved
Phase: 4   Team: Runtime
Depends on: RUN-05
Size: S

## Goal
An operator who exposes an instance beyond the LAN can cap data-plane traffic with one env var; unset, the data plane is unlimited and pays nothing for the feature.

## In scope
A per-client-IP fixed-window limiter (requests per minute) applied at the front of the data-plane router when `MOCK_RATE_LIMIT` is set; the `429 rate_limited` mock-server error with `Retry-After`; log entries for limited requests.

## Out of scope
Per-project limits, burst shaping, control-plane limits (FND-10).

## Contract
Env `MOCK_RATE_LIMIT` (integer requests/minute/IP; unset = off). Error per API-CONTRACT §4.5 (`rate_limited`, `X-Mock-Error: true`, `Retry-After`). Client IP from `req.ip` (`TRUST_PROXY`).

## Acceptance criteria
- [ ] With `MOCK_RATE_LIMIT=5`, requests 1–5 in a minute from one IP succeed and the 6th returns `429` with `X-Mock-Error: true`, body `error: "rate_limited"`, and a numeric `Retry-After`; a different IP is unaffected; after the window resets requests succeed again.
- [ ] `OPTIONS` preflights are not counted and not limited.
- [ ] With the variable unset, no limiter code runs on the hot path (asserted with a spy) and 10,000 requests in a minute all succeed.
- [ ] Limited requests are logged with `mock_error = 'rate_limited'` and do not consume the version cache or generator.
- [ ] Limiter memory is bounded: with 100,000 distinct IPs the map is pruned of expired windows (size stays under a documented cap).
- [ ] A non-integer or ≤0 `MOCK_RATE_LIMIT` makes startup fail naming the variable.

## Tests
Fake-timer limiter tests; spy test for the unset path; memory-bound test.

## Open questions
- Whether limiting should also apply to unknown-slug 404s (assumed yes; they are requests like any other).
