# PRJ-04 — Project list, new-project dialog, project switcher

Status: in progress
Phase: 3   Team: Projects
Depends on: PRJ-01, AUTH-03
Size: M

## Goal
At `/w/$wsSlug` a user sees the workspace's projects with their live mock URLs, creates a new one with instant slug feedback, and moves between projects from the topbar.

## In scope
- The project list screen (prototype table: name+description, base URL, routes, cases, live version, Open).
- New-project dialog: name, slug (derived, editable, reserved/format check, availability on blur), description.
- `<ProjectSwitcher/>` topbar slot; empty state for a workspace with no projects.

## Out of scope
Settings screen (PRJ-05), import (PRJ-06), project deletion UI (PRJ-05).

## Contract
Endpoints `projects.list`, `projects.create`, `projects.getBySlug`. UI route `/w/$wsSlug`; navigates to `/p/$projectSlug`. Uses `getMockBaseUrl(slug)` for the Base URL column.

## Acceptance criteria
- [ ] The Base URL column shows `http://<current host:port>/mock/<slug>` taken from `window.location` — opened at `http://192.168.1.24:8080` it shows that host, never `localhost` (Playwright with a mapped hostname).
- [x] The list pages with "Load more" when `nextCursor` is non-null; counts and the LIVE pill (`v3`) come from the response; a project with no active version shows "—".
- [x] Typing a name derives the slug; typing `api` shows "api is reserved" before submit; `Billing` shows the format rule; submit is disabled while the slug is invalid.
- [x] Submitting a slug already taken (`409 slug_taken`) shows "That URL slug is already used by another project on this server" under the field, keeps the dialog open and the typed values.
- [x] The dialog states "The slug is the URL prefix and cannot be changed later" and shows the resulting `…/mock/<slug>` URL live.
- [x] Creating a project navigates to `/p/<slug>`.
- [x] A workspace with no projects shows an empty state with "New project"; viewers do not see "New project".
- [x] The switcher lists the workspace's projects (name + mono slug, tick on current), "All projects" and "+ New project"; selecting navigates and updates the topbar slug label.
- [ ] Layout holds at 360 px (table scrolls inside its card).

## Tests
Testing Library for dialog validation states and role gating; Playwright for the base-URL host assertion.

## Open questions
- Page size on the list (50 assumed) and whether to add client-side search (not in the prototype).

## Implementation notes (2026-11-11)
- Not `done`: AUTH-03 (and AUTH-02) are not merged, so nothing was run against a real sign-in. Two criteria are unticked: the Playwright base-URL check (`e2e/` and `playwright.config.ts` are Core-owned; Vitest asserts the cell equals `getMockBaseUrl(slug)`) and the 360 px check (not run in a browser).
- "Availability on blur" has no dedicated endpoint; the dialog calls `projects.getBySlug` (200 = in use, 404 = free). A project in a workspace the caller cannot see also answers 404, so the `409 slug_taken` on submit remains the authority.
- The reserved-slug list and slug format are repeated in `features/projects/slug.ts` (web code does not import the contract runtime); `slug.test.ts` checks them against the contract.
- The switcher shows the first page (50) of the workspace's projects.
