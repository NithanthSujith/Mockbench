# 0014 — Path-prefixed mock URLs
Status: accepted      Date: 2026-11-05

## Context
Subdomain-per-project routing needs wildcard DNS, which does not exist on an office LAN. One host:port must serve the editor and every project's mock.

## Decision
`http://<host>:<port>/mock/<project-slug>/<path>`. Slugs are globally unique (so the prefix is unambiguous) and immutable after creation. Reserved slugs: `api`, `mock`, `health`, `static`, `assets`, `admin`.

## Consequences
- Works from any machine with no DNS setup.
- The UI shows the base URL derived from `window.location`, never a build-time value.
- A slug change would break consumers, so slugs are immutable (PLAN D6).

## Revisit if
Per-project hostnames become practical for the target environments.
