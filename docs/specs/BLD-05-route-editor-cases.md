# BLD-05 — Route editor and case management

Status: in review
Phase: 3   Team: Builder
Depends on: BLD-02, BLD-04
Size: M

## Goal
At `/p/$projectSlug/routes/$routeId/cases/$caseId` a user edits a route (method, path, description) and manages its response cases — add, select, rename, set status code, delay, headers, default, delete — with the selected case held in the URL.

## In scope
- Route header (method select, path input, description, Duplicate), case tabs with status chip and default star, "+ Case" dialog, case sub-bar (status select with the 14 curated codes, delay input, headers editor, "make default", delete).
- Debounced autosave via `routes.update`/`cases.update` with saved/saving/error state; URL-synced case selection; the **mounting point** for the schema builder (Builder/JSON tabs, BLD-07/09) and preview column (BLD-11).
- Optimistic updates for case metadata with rollback.

## Out of scope
The schema editing UI itself (BLD-06/07/09), the preview (BLD-11), Try-it (BLD-12), reordering.

## Contract
Endpoints `routes.get`, `routes.update`, `routes.duplicate`, `cases.list`, `cases.create`, `cases.get`, `cases.update`, `cases.delete`, `cases.setDefault`. UI routes `…/routes/$routeId` and `…/cases/$caseId`. Slot props: `<SchemaEditorSlot caseId value onChange />`, `<PreviewSlot case route />` implemented by later units.

## Acceptance criteria
- [x] `/p/s/routes/R` (no case) redirects to `/p/s/routes/R/cases/<default case id>`; switching a tab changes the URL; reloading keeps the selected case; a case id from another route 404s into the not-found screen.
- [x] Editing the path to a colliding one shows the `route_conflict` message inline and reverts the field; a path invalid per `parseRoutePath` is flagged live and not sent.
- [x] Changing the status code to 404 updates the chip colour class (4xx) immediately (optimistic) and persists; on a server error it reverts and shows the message.
- [x] The status select offers exactly the 14 codes; delay accepts 0–10000 and an empty value sends `null` ("inherit project default" hint shown with the project default value).
- [x] The headers editor rejects reserved names (`Content-Length`, `X-Mock-*`, `Access-Control-*`) with the contract message before sending, and allows adding/removing rows.
- [x] "+ Case" creates a case with a unique default name ("New case", "New case 2") and selects it; a name colliding case-insensitively shows `case_name_taken` inline.
- [x] "Make default" moves the star; deleting the default case is disabled with the tooltip "Make another case the default first"; deleting another case selects the default case.
- [x] A `204` status shows "No response body" in place of the schema editor.
- [x] Autosave: a burst of keystrokes in the description sends one request after 600 ms of quiet; the header shows "Saving…" then "Saved".
- [x] Viewer: all inputs disabled, no autosave, tabs still switch.

## Tests
Testing Library for each control and optimistic rollback; Playwright for URL sync and collision flow in MSW mode.

## Open questions
- Whether concurrent edits by two users should surface a "changed by someone else" banner (v1 is last-write-wins; reserved for `If-Match`).
