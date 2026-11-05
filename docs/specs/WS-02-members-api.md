# WS-02 — Members API with last-owner protection

Status: approved
Phase: 2   Team: Workspaces
Depends on: WS-01
Size: M

## Goal
Owners can list, add by email, change the role of, and remove workspace members; any member can leave; a workspace can never be left without an owner.

## In scope
- Handlers for `members.list`, `members.add`, `members.update`, `members.remove`.
- Last-owner invariant enforced inside a transaction with a row lock, so concurrent requests cannot violate it.
- Self-removal allowed for any member.

## Out of scope
Inviting people who have no account (no invite flow; D3). Screens (WS-03/04).

## Contract
Endpoints per API-CONTRACT §3.3 (`members.*`). Tables: `workspace_members`, `users`. A `Member` carries `email` and `name` joined from `users`.

## Acceptance criteria
- [ ] `POST /workspaces/:id/members {email, role:"editor"}` as owner → `201 Member`; for an unknown email → `404 user_not_found`; for an existing member → `409 already_member`; email matching is case-insensitive.
- [ ] The same call as editor or viewer → `403`; as non-member → `404`.
- [ ] `GET …/members` as viewer returns every member with `email`, `name`, `role`, ordered by `createdAt`.
- [ ] `PATCH …/members/:memberId {role:"viewer"}` as owner → `200`; demoting the only owner → `409 last_owner` and the role is unchanged; demoting one of two owners succeeds.
- [ ] `DELETE …/members/:memberId` as owner removes anyone except the last owner (`409 last_owner`); an editor deleting **their own** membership → `204`; an editor deleting someone else's → `403`; the last owner deleting themselves → `409 last_owner`.
- [ ] Two concurrent requests that each demote/remove a *different* owner of a two-owner workspace → exactly one succeeds and the other returns `409 last_owner` (race test, 20 iterations).
- [ ] A `memberId` from another workspace in the path → `404 not_found`.

## Tests
Role matrix per endpoint; the race test with parallel requests; case-insensitive email test.

## Open questions
- Whether a removed member's open sessions should be told anything (no; they simply lose access).
