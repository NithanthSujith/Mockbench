#!/bin/sh
# Mockbench api container entrypoint.
#   1. apply database migrations (dist/migrate.js: drizzle-orm programmatic migrator behind a
#      session-level Postgres advisory lock, so several api containers starting together cannot race)
#   2. start the server with exec, so node replaces this shell and receives SIGTERM directly
set -e

node dist/migrate.js
exec node dist/server.js
