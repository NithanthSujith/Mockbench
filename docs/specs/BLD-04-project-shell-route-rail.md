# BLD-04 — Project shell and route rail

Status: approved
Phase: 3   Team: Builder
Depends on: BLD-01, PRJ-01
Size: M

## Goal
Opening `/p/$projectSlug` loads the project and shows the shell — rail with navigation and the filterable route list, editor area — so every project-scoped screen has its frame, and a user can create, select and delete routes.

## In scope
- The project route loader (`projects.getBySlug` into the Query cache, 404 → not-found screen) and the `ProjectShell` content: nav (Routes, Versions, Request log, Settings with counts), route filter, route list with method badges, "+ New route" dialog, route delete.
- Selecting a route navigates to `…/routes/$routeId`; landing on `/p/$slug` redirects to the first route or shows the empty state.
- Topbar slots fed from the loaded project: base URL (from `window.location`), LIVE pill input data.

## Out of scope
The route editor body (BLD-05). Versions/logs/settings screens (other teams). Reordering routes.

## Contract
Endpoints `projects.getBySlug`, `routes.list`, `routes.create`, `routes.delete`. UI routes `/p/$projectSlug` and children (tree already exists). Query keys from `lib/query-keys`. Uses `getMockBaseUrl(slug)`.

## Acceptance criteria
- [ ] Opening `/p/billing-api` for a project the user cannot see shows the not-found screen (no leak of existence) and no rail.
- [ ] The rail lists routes with the method badge in its token colour and the path in mono, truncating long paths with an ellipsis and a `title` tooltip; the current route is `aria-current`.
- [ ] Typing in "Filter routes" filters by method + path substring client-side without a request, showing "No route matches." when empty.
- [ ] "+ New route" opens a dialog with method select and path input validated with `parseRoutePath` (live message per issue); submitting a colliding route shows "A GET route with this path already exists" with a link to it; success selects the new route.
- [ ] Deleting a route asks for confirmation naming `METHOD /path`; on success the next route is selected or the empty state shown.
- [ ] A project with no routes shows an empty state "No routes yet" with the New route action (hidden for viewers).
- [ ] Viewers see the rail and can select routes but have no New/Delete controls.
- [ ] The topbar base-URL element shows `<window.location.origin>/mock/<slug>`; in MSW mode with a mapped host it never shows `localhost`.
- [ ] At <860 px the rail collapses above the editor and the list is capped to 220 px tall with scrolling (prototype behaviour).

## Tests
Testing Library for filter/dialog/permissions; Playwright for loader/not-found and collision flow in MSW mode.

## Open questions
- Whether to group routes by first path segment (not in the prototype; assumed no).
