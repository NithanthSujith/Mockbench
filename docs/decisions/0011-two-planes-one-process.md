# 0011 — Two planes in one process
Status: accepted      Date: 2026-11-05

## Context
The control plane (authenticated, write-heavy, rich validation) and the data plane (unauthenticated, read-only, millisecond answers) have almost nothing in common.

## Decision
One Node process and container, two separate Express routers on one app, each with its own middleware, error handler and logging. Control-plane code never imports data-plane code and vice versa.

## Consequences
- One fewer thing to run. Splitting into two processes later is a packaging change, not a rewrite.
- They share an origin and port, which makes user-authored mock content a same-origin hazard — mitigated by `Content-Security-Policy: sandbox` and `nosniff` on every data-plane response (PLAN D9).

## Revisit if
The data plane needs independent scaling or a different network exposure than the editor.
