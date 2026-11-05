# PRJ-05 — Project settings screen

Status: approved
Phase: 4   Team: Projects
Depends on: PRJ-01, PRJ-04
Size: M

## Goal
At `/p/$projectSlug/settings` a user edits the project's name/description and settings — generation mode, array indexing, CORS, default delay — sees what each choice does, and (owners) deletes the project.

## In scope
- Settings form (TanStack Form): mode and indexing option cards with the prototype's copy, indexing sample computed by `schema-core`, CORS on/off, default delay.
- The "takes effect at next publish" notice (D7), the access/threat-model note, and a danger zone with delete (owner only, type-the-slug confirmation).

## Out of scope
Presets (PRJ-03), components management (BLD-10), slug change (immutable).

## Contract
Endpoints `projects.get`, `projects.update`, `projects.delete`. `schema-core` `generate` for the indexing example. UI route `/p/$projectSlug/settings`.

## Acceptance criteria
- [ ] Switching Array indexing between Local and Path-qualified updates the example line live: `users[2].tags → ["tags-1","tags-2"]` versus `["users-2-tags-1","users-2-tags-2"]`, computed locally with no network call.
- [ ] Choosing Random shows the one-line warning that it disables baking and makes consumer assertions flaky; Deterministic is the default selection for a new project.
- [ ] Saving sends only changed keys (`PATCH {settings:{mode:"seeded"}}`), then shows "Saved — applies from your next publish" and, if a version is live, "The live version keeps its current settings until you publish and deploy."
- [ ] Default delay accepts integers 0–10000 and rejects 10001 with a field message; CORS offers `Allow all origins (*)` and `Off — browsers will block calls (useful to test CORS failures)`.
- [ ] The "Access" panel states that mock URLs take no authentication and gives the project's base URL derived from `window.location`.
- [ ] Delete is visible only to owners; it requires typing the slug exactly; success returns to `/w/<ws>` and the project is gone from the switcher; failure leaves the dialog open with the server message.
- [ ] Viewers see all values read-only; editors can save but not delete.
- [ ] Unsaved changes prompt before navigating away.

## Tests
Testing Library for form states and role variants; Playwright for delete confirmation.

## Open questions
- Whether name edits should warn that the slug does not change with them (assumed yes, one line).
