# 0019 — Control-plane rate limit raised to 600 per minute
Status: accepted      Date: 2026-11-14

## Context
XC-01 found that one session driving the SPA for a minute exceeds the control plane's 100 requests per minute per session and gets `429`. The SPA polls (request log, deploy state) and refetches on navigation, so a normal user can hit the limit.

## Decision
The default of `CONTROL_RATE_LIMIT` is 600 requests per minute per session (unauthenticated requests are still keyed by client IP). Sign-in and register stay at 10 per minute per IP. The value is still overridable by env.

## Consequences
API-CONTRACT section on rate limits, DESIGN and the FND-10 spec are updated. No endpoint or shape changes. Abuse protection on a trusted LAN is not the goal of this limit; it only stops a runaway client.

## Revisit if
A legitimate session still sees `429`, or the limiter needs to distinguish polling from writes.
