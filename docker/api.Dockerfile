# syntax=docker/dockerfile:1.7
# Mockbench api image. Build context: the repository root (see docker-compose.yml).
#
# Stages
#   build    install the workspace subset the api needs, bundle it with esbuild (apps/api/build.mjs:
#            workspace packages inlined, other npm packages external) and produce a PRODUCTION-ONLY
#            node_modules with `pnpm deploy --prod --legacy`
#   runtime  node:22-alpine + that node_modules + dist, running as the non-root `node` user
#
# The runtime image therefore contains no TypeScript sources, no drizzle-kit and no dev dependencies.
# Builds for linux/amd64 and linux/arm64 (nothing here needs a compiler: pure-JS dependencies only).

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# 1. Manifests only, so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/check-node.mjs scripts/check-node.mjs
COPY apps/api/package.json apps/api/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/schema-core/package.json packages/schema-core/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN --mount=type=cache,id=mockbench-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@mockbench/api..." --store-dir /pnpm/store

# 2. Sources, build, then the production-only node_modules.
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @mockbench/api build
RUN --mount=type=cache,id=mockbench-pnpm-store,target=/pnpm/store \
    pnpm --filter @mockbench/api deploy --prod --legacy --store-dir /pnpm/store /out \
    # The workspace packages are inlined into dist/*.js; their TypeScript sources are not needed at runtime.
    && rm -rf /out/node_modules/@mockbench

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=3000 \
    TRUST_PROXY=1
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --chmod=0755 docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/api-entrypoint.sh"]
