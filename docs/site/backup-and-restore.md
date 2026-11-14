# Backup and restore

Everything Mockbench stores (accounts, workspaces, projects, routes, cases, presets, versions, deployments and the request log) is in one PostgreSQL database, kept in one Docker named volume: **`pgdata`**. Logs go to stdout and are not stored. The images hold no state.

With the default compose file the volume is named `mockbench_pgdata` (list volumes with `docker volume ls`). The database is `mockserver` and its user is `mock`. The database is not published to the host, so you reach it through the `db` container.

**Mockbench has no authentication on its mock URLs and must stay on a trusted private network.** A backup contains account records (password hashes) and every project; store it accordingly.

## Back up

Run these from the repository directory while the stack is running. This writes a consistent dump without stopping anything. The dump is created inside the container and then copied out, which avoids shell redirection quirks on Windows.

```sh
docker compose exec db sh -c 'pg_dump -U mock -Fc mockserver -f /tmp/mockbench.dump'
docker compose cp db:/tmp/mockbench.dump ./mockbench.dump
```

Keep `mockbench.dump` somewhere other than the machine that runs Mockbench. Run it on a schedule if the instance matters to your team.

Individual projects can also be exported as `*.mockbench.json` files through the API (`GET /api/v1/projects/:projectId/export`), which hold the draft and presets but not versions or the request log. That is a way to move one project, not a replacement for a database backup.

## Restore

Restore into a running stack, with the API and web stopped so nothing is writing:

```sh
docker compose stop api web
docker compose cp ./mockbench.dump db:/tmp/mockbench.dump
docker compose exec db sh -c 'pg_restore -U mock -d mockserver --clean --if-exists --no-owner /tmp/mockbench.dump'
docker compose start api web
```

`--clean` replaces the existing tables with the dump's. The API applies any newer migrations itself when it starts, so a dump from an older version restores into a newer one.

Restoring onto a brand-new machine: clone the repository, `cp .env.example .env`, run `docker compose up -d`, wait until it is healthy, then run the restore steps above. Use the same `SESSION_SECRET` as before if you want people to stay signed in; with a different one they sign in again, and nothing else is affected. After a restore, a project's deployed version is served again as soon as the API starts.

## Copy the whole volume instead

With the stack stopped, you can archive the volume's files. This is a raw copy of the database directory, so restore it only into the same major PostgreSQL version (16).

```sh
docker compose down
docker run --rm -v mockbench_pgdata:/data -v "$PWD":/backup alpine tar czf /backup/pgdata.tgz -C /data .
```

To restore it, create an empty volume, extract the archive into it the same way, and start the stack.

## Losing access

There is no command that resets a user's password, and no password-reset email. A signed-in user can change their own password. Keep a second owner in each workspace, and keep a recent backup, so that losing one account is not a lockout.
