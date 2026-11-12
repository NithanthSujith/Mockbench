# WS-04 — Members screen

Status: done
Phase: 4   Team: Workspaces
Depends on: WS-02, WS-03
Size: M

## Goal
At `/w/$wsSlug/members` owners manage who is in the workspace and with what role; everyone else sees the list read-only.

## In scope
- The screen: members table (name, email, role, joined), role select per row, remove button, "Add member" form (email + role).
- Read-only rendering for non-owners; "Leave workspace" for any member.
- Error mapping for `user_not_found`, `already_member`, `last_owner`.

## Out of scope
Inviting unregistered people, resending invites (none exist). Workspace rename/delete UI beyond a settings stub link.

## Contract
Endpoints `members.list`, `members.add`, `members.update`, `members.remove`, `workspaces.update`, `workspaces.delete`. UI route `/w/$wsSlug/members` (already in the tree).

## Acceptance criteria
- [x] An owner sees role selects, remove buttons and the Add form; an editor or viewer sees the same table with no controls except "Leave workspace".
- [x] Adding an email that has no account shows "No account with that email — they need to register first" under the field; `already_member` shows "Already a member"; success appends the row without a full reload.
- [x] Changing the only owner's role to editor shows "A workspace needs at least one owner" and reverts the select.
- [x] Removing a member asks for confirmation naming them; on `204` the row disappears; removing yourself returns you to `/w/…` of another workspace or the empty state.
- [x] The email column is mono; role is a text label with a token-coloured badge; layout holds at 360 px (table scrolls horizontally, controls remain reachable).
- [x] Optimistic updates roll back on any error and the Query cache is invalidated for `members` and `auth.me`.

## Tests
Testing Library for permission variants and error mapping; Playwright for add → change role → remove against MSW mode and, once available, the real API.

## Open questions
- Whether to show a copyable "registration link" for the instance to hand to teammates (the LAN URL is already visible elsewhere; assumed no).

## Implementation notes
- Playwright (add, change role, remove) is not written in this unit; Testing Library covers every criterion against MSW. Real-API e2e belongs to XC-01.
- The "settings stub link" from In scope is omitted: no workspace settings route exists in the frozen route tree.
- Owners also see "Leave workspace"; removing yourself via the row button follows the same flow. After leaving, the user goes to the first remaining workspace, else /welcome.
