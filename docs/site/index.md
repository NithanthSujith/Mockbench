# Mockbench documentation

Mockbench is a self-hosted mock API server. Your team defines routes and response shapes in a web UI, publishes a version, and anyone on the network calls the resulting endpoints over plain HTTP. There is no hosted version.

**Mockbench has no authentication on its mock URLs: anyone who can reach the port can call every published project. It is built for a trusted private network (a laptop, an office LAN) and must never be exposed to the internet.**

These pages are plain Markdown with no scripts, fonts or images loaded from anywhere, so they read the same offline.

## Contents

1. [Getting started](getting-started.md): install, first call, share it on your LAN
2. [Concepts](concepts.md): workspace, project, route, case, version
3. [Schema format and generation rules](schema-and-generation.md): how a response body is described and produced
4. [Case selection and headers](case-selection-and-headers.md): choosing a case per request, the diagnostic headers, and the errors Mockbench itself returns
5. [Environment variables](environment-variables.md): every setting, its default and meaning
6. [Backup and restore](backup-and-restore.md): the `pgdata` volume
7. [Examples](../../examples/README.md): three importable projects and sample payloads

The full design is in `docs/DESIGN.md` and the HTTP contract in `docs/API-CONTRACT.md` in the repository. Those are planning documents, not part of this guide.

## What is not here

- **A password reset command.** There is no CLI that resets a user's password. A signed-in user can change their own password through the API (`POST /api/v1/auth/password`). If you lose the only owner account, the database is the only way back in; see [Backup and restore](backup-and-restore.md) before you need it.
- **OpenAPI import.** Not yet.
