# Changesets

A PR that changes what ships (non-test, non-doc files under `apps/api`, `apps/web`, `packages/schema-core` or `packages/api-contract`) needs a changeset: run `pnpm changeset`, pick the bump, write one line for the changelog, and commit the file it creates. A PR that ships nothing user-visible can carry the `no-changeset` label instead. The four packages are one fixed version group, so a release has one version and one changelog (ADR 0020).
