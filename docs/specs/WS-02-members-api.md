# WS-02 â€” Members API with last-owner protection

Status: done
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
Endpoints per API-CONTRACT Â§3.3 (`members.*`). Tables: `workspace_members`, `users`. A `Member` carries `email` and `name` joined from `users`.

## Acceptance criteria
- [x] `POST /workspaces/:id/members {email, role:"editor"}` as owner â†’ `201 Member`; for an unknown email â†’ `404 user_not_found`; for an existing member â†’ `409 already_member`; email matching is case-insensitive.
- [x] The same call as editor or viewer â†’ `403`; as non-member â†’ `404`.
- [x] `GET â€¦/members` as viewer returns every member with `email`, `name`, `role`, ordered by `createdAt`.
- [x] `PATCH â€¦/members/:memberId {role:"viewer"}` as owner â†’ `200`; demoting the only owner â†’ `409 last_owner` and the role is unchanged; demoting one of two owners succeeds.
- [x] `DELETE â€¦/members/:memberId` as owner removes anyone except the last owner (`409 last_owner`); an editor deleting **their own** membership â†’ `204`; an editor deleting someone else's â†’ `403`; the last owner deleting themselves â†’ `409 last_owner`.
- [x] Two concurrent requests that each demote/remove a *different* owner of a two-owner workspace â†’ exactly one succeeds and the other returns `409 last_owner` (race test, 20 iterations).
- [x] A `memberId` from another workspace in the path â†’ `404 not_found`.

## Tests
Role matrix per endpoint; the race test with parallel requests; case-insensitive email test.

## Open questions
- Whether a removed member's open sessions should be told anything (no; they simply lose access).

## Implementation notes
- Mutations lock every membership row of the workspace (SELECT ... FOR UPDATE) and authorise the caller inside that lock. In the concurrent two-owner race the loser is therefore answered 409 last_owner if it was evaluated while still an owner, but 403 (demoted by the winner) or 404 (removed by the winner) if the winner committed first; either way exactly one request succeeds and one owner remains. The race test asserts this.
