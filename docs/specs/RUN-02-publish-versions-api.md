# RUN-02 — Publish and versions API

Status: approved
Phase: 2   Team: Runtime
Depends on: RUN-01
Size: M

## Goal
`POST /projects/:id/versions` publishes the draft as an immutable version — all or nothing — and versions can be listed, read and (under rules) deleted. Publishing never deploys.

## In scope
- Handlers for `versions.list`, `versions.publish`, `versions.get`, `versions.delete`.
- One transaction: lock the project row, increment `version_seq`, call `buildVersionPayload`, choose the label (`v<seq>` or the user's), insert, return.
- Delete rules: not the active version, not one referenced by retained request logs.

## Out of scope
Deploy (RUN-03), diff (RUN-10), screens (RUN-09), cache.

## Contract
Endpoints per API-CONTRACT §3.9 (`versions.*`). Tables: `versions`, `projects` (`version_seq`, `active_version_id`), `request_logs` (reference check by FK). Service: `buildVersionPayload` (RUN-01).

## Acceptance criteria
- [ ] First publish → `201`, `seq:1`, label `v1`, `isActive:false`, `createdBy` = caller, `routeCount`/`caseCount`/`bakedBytes` populated; the project's `active_version_id` is unchanged.
- [ ] `{label:"before-the-pricing-change", notes:"…"}` is stored as given; a duplicate label in the same project → `409 label_taken` with no row and `version_seq` not consumed; the same label in another project succeeds.
- [ ] After deleting the latest version, the next publish gets `seq` = previous max + 1 (never reuses), so labels never repeat.
- [ ] Two simultaneous publishes yield distinct `seq` values and both `201` (race test).
- [ ] A draft with one invalid case → `422 publish_invalid` with `details` naming route, case and issues; **no** version row and `version_seq` unchanged.
- [ ] A project with zero routes → `422 empty_project`.
- [ ] Label of 81 characters, or only whitespace → `422`; viewer → `403`; non-member → `404`.
- [ ] `GET versions` is ordered newest first and paginates (`limit=2` over 5 versions → 2,2,1); the list payload contains no `snapshot` or `baked` (response size assertion).
- [ ] `GET /versions/:id` returns the full `snapshot` and never `baked`.
- [ ] `DELETE` of the active version → `409 version_active`; of a version referenced by a `request_logs` row → `409 version_referenced`; otherwise `204`; as viewer → `403`.
- [ ] `UPDATE` on a version row from application code is impossible (trigger from FND-08): a raw-SQL attempt in the test fails.
- [ ] Draft changes after publishing do not change the returned snapshot of that version.

## Tests
Role matrix; concurrency and rollback tests; pagination test; immutability test.

## Open questions
- Whether publish should refuse when the draft is byte-identical to the latest version (assumed no; labels are free).
