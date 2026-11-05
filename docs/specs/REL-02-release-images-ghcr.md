# REL-02 — Release workflow: multi-arch images on GHCR

Status: approved
Phase: 5   Team: Core
Depends on: FND-14, XC-01
Size: M

## Goal
Tagging `v*` builds and publishes multi-arch images to GHCR and attaches a compose file that pulls them, so trying Mockbench is a download rather than a five-minute build.

## In scope
- `.github/workflows/docker.yml`: buildx for `linux/amd64` and `linux/arm64`, push `api` and `web` to GHCR with version and `latest` tags, provenance/SBOM attestations, attach `docker-compose.pull.yml` to the GitHub release.
- `docker-compose.pull.yml` referencing the published images by version.
- A post-publish smoke job that pulls the images and runs the e2e golden loop against them.

## Out of scope
Docker Hub, signing beyond GHCR attestations, auto-update mechanisms (never — no outbound calls).

## Contract
Image names `ghcr.io/<owner>/mockbench-api` and `…-web`. Tag policy: `vX.Y.Z`, `vX.Y`, `latest`. Compose pull file uses `${MOCKBENCH_VERSION:-latest}`.

## Acceptance criteria
- [ ] Pushing tag `v0.1.0` produces both images with a manifest list containing `linux/amd64` and `linux/arm64` (verified with `docker buildx imagetools inspect`).
- [ ] `docker compose -f docker-compose.pull.yml up` on a clean machine with no source checkout reaches all-healthy and `GET /api/v1/readyz` returns `200`.
- [ ] The release has `docker-compose.pull.yml` and `.env.example` attached.
- [ ] The post-publish smoke job runs the XC-01 golden loop against the pulled images and fails the workflow if it fails.
- [ ] The images run as non-root and contain no `drizzle-kit`, no source maps with absolute paths, and no `.env` files (inspection step).
- [ ] The workflow requests only `contents: read`, `packages: write`, `id-token: write`/`attestations: write` permissions, and pins third-party actions by SHA.

## Tests
A dry-run of the workflow on a prerelease tag in CI; inspection scripts.

## Open questions
- Image owner/namespace (depends on where the repository is hosted).
