# WS-03 — Workspace switcher and new-workspace dialog

Status: done
Phase: 3   Team: Workspaces
Depends on: WS-01, AUTH-03
Size: S

## Goal
The topbar workspace dropdown lets a user move between workspaces and create a new one; it disappears when it is pointless.

## In scope
- `<WorkspaceSwitcher/>` (the FND-13 slot) built from `DropdownMenu`, fed by `auth.me`/`workspaces.list`.
- New-workspace dialog (name, derived slug shown, slug editable before submit).

## Out of scope
The members screen (WS-04). Project switcher (PRJ-04).

## Contract
Endpoints `workspaces.list`, `workspaces.create`. UI: the topbar slot; navigates to `/w/$wsSlug`.

## Acceptance criteria
- [x] With exactly one workspace the switcher renders as a plain label with no dropdown caret and no "New workspace" item reachable by keyboard; with two or more it renders the dropdown (prototype layout: label, workspaces with a tick on the current one, separator, "+ New workspace").
- [x] Choosing another workspace navigates to `/w/<slug>` and the current-workspace tick moves.
- [x] The dialog derives the slug live from the name (`Alps Chemicals` → `alps-chemicals`), lets the user edit it, and on `409 slug_taken` shows the error under the slug field and keeps the dialog open.
- [x] A successful create closes the dialog, refreshes the workspace list, and navigates to the new workspace.
- [x] When the user has **zero** workspaces the slot shows a "Create workspace" button instead (the only way out of the empty state).
- [x] Escape closes the menu and returns focus to its trigger; all items are reachable by arrow keys.

## Tests
Testing Library for each state; Playwright for navigation using MSW mode.

## Open questions
- Whether the last-used workspace should be remembered in `localStorage` for the post-login landing (nice to have; assumed no).
