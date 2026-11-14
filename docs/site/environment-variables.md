# Environment variables

Mockbench is configured through `.env` in the repository root. `docker compose` reads it, passes the variables below to the containers, and the API validates them at start-up: a bad value stops the API with a message naming the variable.

```sh
cp .env.example .env
```

After editing `.env`, run `docker compose up -d` again so the containers pick up the change.

**Mockbench has no authentication on its mock URLs and must stay on a trusted private network.** Several of the settings below exist to keep the editor side tidy on a shared LAN; none of them makes the mock URLs safe for the internet.

## Settings you will use

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Host port that serves both the editor and the mock endpoints. Read by `docker compose`, not by the API. |
| `POSTGRES_PASSWORD` | `mock` | Password of the `mock` database user. The database is never published outside the compose network, so the default is fine on a single machine. Change it before first start if you change anything about that. It is applied only when the database volume is first created; changing it afterwards does not change the existing database. |
| `SESSION_SECRET` | none (required) | Secret that keys the hash of session tokens. `.env.example` ships a placeholder so the quickstart works; the API then starts but logs a warning. Set your own long random value before sharing the instance. Compose refuses to start when it is empty. Changing it signs everyone out. |
| `COOKIE_SECURE` | `false` | Adds `Secure` to the session cookie. Leave `false` on plain HTTP (a LAN IP over HTTP must work); set `true` only when you serve the app over HTTPS. |
| `ALLOW_SIGNUP` | `true` | Whether anyone who can reach the app can register. Set `false` once your team has accounts. While no user exists yet, registration is open regardless. |
| `SEED_DEMO` | `true` | On an empty database, creates and publishes a `demo` project so there is something to call at once. Has no effect once any user or workspace exists. |
| `LOG_LEVEL` | `info` | API log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Logs are JSON on stdout (`docker compose logs api`). |
| `LOG_RETENTION_DAYS` | `7` | Request-log rows older than this many days are pruned. |
| `LOG_RETENTION_ROWS` | `1000` | At most this many request-log rows are kept per project; older rows are pruned. Together with the days setting, whichever keeps less wins. |
| `MOCK_RATE_LIMIT` | unset | Requests per minute per client IP on the mock endpoints. Unset or empty means unlimited. Over the limit a caller gets `429 rate_limited` with a `Retry-After` header. |
| `SESSION_TTL_DAYS` | `30` | How long a sign-in lasts. |
| `MOCK_CACHE_MAX_MB` | `256` | Size bound, in megabytes, of the in-memory cache of deployed versions that the mock endpoints answer from. |

## Settings for unusual setups

| Variable | Default | Meaning |
| --- | --- | --- |
| `CACHE_FANOUT` | `true` | Reserved for sharing cache invalidation between several API containers. It is read and validated, but nothing uses it yet. |
| `TRUST_PROXY` | `1` | How many proxy hops in front of the API to trust when working out the client IP. The compose file fixes it at `1` (the web container). Only relevant when you run the API outside compose. |
| `CONTROL_RATE_LIMIT` | `600` | Editor/API requests per minute per session (per client IP when not signed in). The compose file does not pass this variable through, so it has an effect only when you run the API outside compose or edit `docker-compose.yml`. |
| `LOGIN_RATE_LIMIT` | `10` | Sign-in and registration attempts per minute per client IP. Not passed through by the compose file either. |
| `NODE_ENV` | `production` | `production`, `development` or `test`. The images set the production behaviour; you do not need to set it. |
| `HOST` | `0.0.0.0` | Bind address of the API inside its container. The compose file sets it; never use a loopback address in a container. |
| `API_PORT` | `3000` | Port of the API inside the compose network. The compose file sets it and the web container proxies to it. |
| `DATABASE_URL` | none (required) | PostgreSQL connection string. The compose file builds it from `POSTGRES_PASSWORD`; set it yourself only when running the API outside compose. |

Variables not listed here are ignored.
