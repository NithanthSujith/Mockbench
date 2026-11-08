# syntax=docker/dockerfile:1.7
# Mockbench web image: the Vite bundle baked into nginx. Build context: the repository root.
# The SPA never has a host name compiled in: it calls relative /api/v1/... URLs and derives the mock
# base URL from window.location at runtime, so one image works behind any address.

# The bundle is plain static files, so the build runs on the builder's own CPU (no QEMU emulation) even
# when the image is built for another architecture.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/check-node.mjs scripts/check-node.mjs
COPY apps/web/package.json apps/web/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/schema-core/package.json packages/schema-core/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN --mount=type=cache,id=mockbench-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@mockbench/web..." --store-dir /pnpm/store

COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @mockbench/web build

FROM nginx:alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
