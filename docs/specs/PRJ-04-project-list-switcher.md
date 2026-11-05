# PRJ-04 — Project list, new-project dialog, project switcher

Status: approved
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
- [ ] The list pages with "Load more" when `nextCursor` is non-null; counts and the LIVE pill (`v3`) come from the response; a project with no active version shows "—".
- [ ] Typing a name derives the slug; typing `api` shows "api is reserved" before submit; `Billing` shows the format rule; submit is disabled while the slug is invalid.
- [ ] Submitting a slug already taken (`409 slug_taken`) shows "That URL slug is already used by another project on this server" under the field, keeps the dialog open and the typed values.
- [ ] The dialog states "The slug is the URL prefix and cannot be changed later" and shows the resulting `…/mock/<slug>` URL live.
- [ ] Creating a project navigates to `/p/<slug>`.
- [ ] A workspace with no projects shows an empty state with "New project"; viewers do not see "New project".
- [ ] The switcher lists the workspace's projects (name + mono slug, tick on current), "All projects" and "+ New project"; selecting navigates and updates the topbar slug label.
- [ ] Layout holds at 360 px (table scrolls inside its card).

## Tests
Testing Library for dialog validation states and role gating; Playwright for the base-URL host assertion.

## Open questions
- Page size on the list (50 assumed) and whether to add client-side search (not in the prototype).
