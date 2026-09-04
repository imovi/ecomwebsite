# ---------------------------------------------------------------------------
# gng API
#
# Multi-stage so the runtime image carries no TypeScript, no dev dependencies
# and no source — just `dist/`, production `node_modules`, and the migrations
# the app needs to bring a fresh database up to date.
# ---------------------------------------------------------------------------

# Pinned to a minor rather than `24-alpine`: `sharp` ships prebuilt binaries per
# platform, and a silent base-image bump is exactly how that breaks.
FROM node:24.13-alpine AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM base AS deps
# `npm ci` needs both files and nothing else, so this layer is cached until the
# lockfile actually changes.
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Drop dev dependencies in place rather than reinstalling from scratch in the
# runtime stage — same result, one fewer network round trip.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
# Alpine's default is small; image processing with sharp benefits from headroom.
ENV NODE_OPTIONS=--max-old-space-size=512

# `dumb-init` reaps zombies and forwards signals, so SIGTERM from the
# orchestrator actually reaches Node and in-flight requests drain instead of
# being killed mid-transaction.
#
# `postgresql17-client` is here for one reason —
# the nightly database backup shells out to pg_dump from this container. The
# major version is pinned to the server's (postgres:17.2 in docker-compose.yml)
# because pg_dump refuses to dump a server newer than itself, and an
# unversioned `postgresql-client` would start doing exactly that the day Alpine
# moves on. If the database is upgraded, this line moves with it.
RUN apk add --no-cache dumb-init postgresql17-client ffmpeg

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Migrations live outside `src`, so they must be copied explicitly — the app
# reads them from the image at startup.
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json

# Local-disk uploads. Mount a volume here, or switch STORAGE_DRIVER to an object
# store — otherwise every product photo is lost on redeploy.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
VOLUME ["/app/uploads"]

# Never run as root. `node` exists in the base image already.
USER node

EXPOSE 4000

# The API's own health endpoint, so an unhealthy container is restarted rather
# than left accepting traffic it cannot serve.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
