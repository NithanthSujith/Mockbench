# RUN-07 — Request-log writer and retention pruner

Status: approved
Phase: 3   Team: Runtime
Depends on: RUN-05
Size: M

## Goal
Every request that reaches a known project is recorded after the response is sent — batched, bounded, redacted, and incapable of slowing or breaking a response — and old rows are pruned on a schedule.

## In scope
- `requestLog.record(entry)`: in-memory queue, batch insert (every 250 ms or 100 entries), bounded queue with drop-oldest and a counter, flush on shutdown.
- Redaction and truncation of `request_headers`/`query`/`path` before insert; `ip` from `req.ip`.
- The pruner: interval job deleting rows older than `LOG_RETENTION_DAYS` and beyond the newest `LOG_RETENTION_ROWS` per project.

## Out of scope
The API and screen (RUN-08). Unknown-slug requests are not logged.

## Contract
Table `request_logs`. Env `LOG_RETENTION_DAYS` (7), `LOG_RETENTION_ROWS` (1000). Redacted header names (value → `"[redacted]"`): `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`. Header values truncated at 1,000 chars, path at 2,000, ≤ 50 headers kept.

## Acceptance criteria
- [ ] A mock request produces exactly one `request_logs` row (within 1 s) with method, path, status, duration, `route_pattern`, `case_name`, `version_id`, `ip`; the write happens after the response is flushed (response latency with the DB paused is unchanged).
- [ ] A request carrying `Authorization: Bearer abc`, `Cookie: s=1`, `X-Api-Key: k` is stored with each value `"[redacted]"` and other headers intact; a 5,000-char header value is stored truncated to 1,000.
- [ ] A mock-server error (`route_not_found`, `case_not_found`, `project_not_published`) is stored with `mock_error` set to its code and null `matched_route_id`/`matched_case_id`.
- [ ] With the database unavailable, requests still succeed, the queue holds up to 10,000 entries, the 10,001st drops the oldest, and a single warn log reports the drop count; when the DB returns, queued entries are written.
- [ ] 1,000 requests in 1 second produce ≤ 20 insert statements (batching), all rows present.
- [ ] On `SIGTERM` pending entries are flushed before exit.
- [ ] Pruner: with `LOG_RETENTION_DAYS=7`, rows older than 7 days are deleted and newer kept; with `LOG_RETENTION_ROWS=1000` and 1,500 recent rows for project A and 10 for project B, A keeps its newest 1,000 and B keeps all 10; the job runs every 10 minutes and once at startup; an overlapping run is skipped.
- [ ] Deleting a version referenced by retained rows is blocked (FND-08 FK); once pruned it can be deleted (integration test with RUN-02).
- [ ] Unknown-slug requests create no row and no error.

## Tests
Writer tests with a controllable clock and a stalled DB; redaction table; pruner tests with seeded rows.

## Open questions
- Whether query-string values should also be redacted for keys named `token`/`key`/`password` (assumed yes for those names).
