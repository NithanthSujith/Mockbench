---
'@mockbench/api': minor
---

Add `dist/reset-password.js` to the api image: an operator can reset any user's password from the host with `docker compose exec api node dist/reset-password.js <email>` (AUTH-04).
