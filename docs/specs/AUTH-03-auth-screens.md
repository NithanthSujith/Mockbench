# AUTH-03 — Sign-in and register screens, route guard, account menu

Status: in progress (blocked: AUTH-02 unmerged; zero-workspace route undecided)
Phase: 3   Team: Auth
Depends on: AUTH-02, FND-13
Size: M

## Goal
A person can register, sign in and sign out from the browser, and no protected screen ever renders for a signed-out user.

## In scope
- `/login` and `/register` screens per the prototype's login card; first-run copy driven by `system.instance`.
- `features/auth/session.ts` (the guard's data source), post-login redirect, 401 handling, the `<AccountMenu/>` slot (email, sign out).
- Empty state for a signed-in user with no workspaces.

## Out of scope
Change-password UI (not in v1 screens), workspace switcher (WS-03), any server code.

## Contract
- Endpoints: `system.instance`, `auth.register`, `auth.login`, `auth.logout`, `auth.me` (API-CONTRACT §3.1–3.2).
- UI routes: `/login`, `/register` (already in the FND-13 tree); search param `?redirect=<path>` (same-origin paths only).
- Exports: `getSession()` (used by the FND-13 guard), `<AccountMenu/>`.

## Acceptance criteria
- [x] Visiting `/p/anything/routes/x` signed-out redirects to `/login?redirect=%2Fp%2Fanything%2Froutes%2Fx`; the topbar/shell is **not** in the DOM at any point (asserted by a DOM probe during navigation).
- [x] After a successful sign-in the user lands on `redirect` if it is a same-origin path, else on `/w/<first workspace slug>`; an off-origin `redirect` value (`//evil.test`, `https://evil.test`) is ignored.
- [x] Wrong credentials show the `invalid_credentials` message inline under the form (not a toast), keep the typed email, clear the password.
- [x] When `setupRequired` is true `/login` shows "Create the first account" and links to `/register`; when `allowSignup` is false and `setupRequired` is false there is no register link and `/register` shows "Registration is closed on this server" and a link back; when `allowSignup` is true the hint "Set ALLOW_SIGNUP=false once your team has accounts" appears.
- [x] A `403 signup_disabled` or `409 email_taken` from register maps to an inline field/form message, not a generic error.
- [ ] A user with zero workspaces sees the empty state "You aren't in any workspace yet" with a "Create workspace" action and the text "or ask an owner to add your email".
- [x] A `401` on any API call mid-session redirects to `/login` with "Your session ended" once and clears the Query cache.
- [x] Sign out calls `auth.logout`, clears the Query cache and lands on `/login`.
- [x] Inputs have correct `autocomplete` (`username`, `current-password`, `new-password`), labels tied to inputs, and Enter submits.
- [ ] All styling uses theme tokens (lint passes); the page works at 360 px width.

## Tests
Testing Library for forms and messages; Playwright for guard/redirect/open-redirect cases against MSW mode; one test with the real API once AUTH-02 is merged.

## Open questions
- Whether the "Default workspace" name should be shown on the first-run screen (assumed no).

## Progress notes
- Built and tested against a faked `fetch` (Vitest); AUTH-02 is not merged, so nothing has run against the real API and the unit is not `done`. Playwright cases and the real-API test are still to do.
- Not ticked: the zero-workspace empty state. `NoWorkspaceState` exists but no route renders it and `getLandingPath` returns `/login` for a user with no workspace. Question for the main session: which route hosts it (a new `/welcome`-style route, or `/w/$wsSlug` handling an unknown slug), and who owns the Create workspace flow (WS-03)?
- Not ticked: 360 px check is by token/classes only (no browser run).
