# BLD-12 — Try-it panel

Status: approved
Phase: 3   Team: Builder
Depends on: BLD-11, RUN-05
Size: M

## Goal
Beside the preview, a card shows the exact `curl` command for the selected route and case — pre-filled with the address the user's browser reached the app on — lets them copy it even over plain HTTP, and sends the request from the browser to show the live response.

## In scope
- `<TryItPanel>`: curl text built from `getMockBaseUrl(slug)`, the route path with sample param values, method flag, and `-H 'X-Mock-Case: <name>'` when the case is not the default.
- Copy button with the insecure-context fallback; a Send button that calls the mock URL (relative to the current origin) and renders status, `X-Mock-*` headers, duration and body; state messaging when the project has no deployed version.

## Out of scope
Authenticated requests, request bodies/headers editing (mocks ignore bodies), history.

## Contract
`getMockBaseUrl` (FND-13). Data plane contract API-CONTRACT §4 (case selection header, diagnostic headers). `projects.get` for `activeVersion`. UI: mounted in the BLD-05 preview column.

## Acceptance criteria
- [ ] With the app loaded at `http://192.168.1.24:8080`, the snippet starts `curl -i http://192.168.1.24:8080/mock/<slug>/…`; at a mapped hostname it shows that hostname; the string `localhost` never appears unless the user actually browsed to localhost (Playwright with host mapping).
- [ ] Path params are substituted (`:id` → `42`, any other param → `7`, matching the prototype); a non-GET adds `-X <METHOD>` on a continuation line; a default case adds no case header.
- [ ] A non-default case adds `-H 'X-Mock-Case: Not found'`; a case whose name contains non-printable-ASCII or `'` uses the **case id** instead, so the command always works.
- [ ] Copy uses `navigator.clipboard.writeText` when `window.isSecureContext`; otherwise it selects the snippet text and toasts "Selected — press Ctrl/Cmd+C" (Playwright test over a non-secure origin asserts the fallback and no thrown error).
- [ ] Send performs `fetch('/mock/<slug>/…')` (relative) with the case header; shows status chip, `X-Mock-Version/Route/Case`, duration in ms and the body; a case with a 900 ms delay shows ≥900 ms; a network failure shows the error text.
- [ ] When the project has no `activeVersion`, Send is disabled with "Publish and deploy this project before the URL answers", and the footer shows that sentence; when live it shows "Any machine on the LAN can call this now."
- [ ] A mock-server error (`X-Mock-Error: true`, e.g. `case_not_found`) is labelled "Mock server error" with its `hint`, distinct from a mocked error response.
- [ ] The panel always states "Calls the deployed version, not your draft", and the response header block shows the deployed version label from `X-Mock-Version` so a stale deploy is visible.
- [ ] Layout holds at 360 px; snippet block scrolls horizontally.

## Tests
Testing Library for snippet construction (table of routes/cases) and the copy fallback; Playwright against the real stack in XC-01 for Send.

## Open questions
- Whether Send should be able to target the draft via a server-side "draft preview" endpoint (not in the contract; assumed no).
