# 0003 — DB sessions over JWT
Status: accepted      Date: 2026-11-05

## Context
Self-hosted tool, one origin, a database already present. The data plane is unauthenticated, so no component needs to verify a token without a DB hit.

## Decision
Argon2id password hashes; an opaque 32-byte session token in an httpOnly cookie; a `sessions` table storing only an HMAC of the token. No JWT.

## Consequences
- Revocable on logout and on password change; no expiry/refresh dance.
- Each control-plane request does one indexed session lookup.
- The cookie must work over plain HTTP on a LAN IP (Secure off by default, env flag to enable).

## Revisit if
The data plane ever needs to verify tokens without touching the database (for example per-project access tokens at scale).
