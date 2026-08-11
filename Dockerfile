# ---------------------------------------------------------------------------
# gng storefront
#
# Builds the standalone output, so the runtime image contains only the traced
# subset of `node_modules` Next actually needs — a fraction of the full tree.
# ---------------------------------------------------------------------------

FROM node:24.13-alpine AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# BUILD-TIME configuration.
#
# Two distinct reasons these are needed here, not just at runtime:
#
#   - `NEXT_PUBLIC_*` values are inlined into the client bundle at build time. A
#     value supplied only at runtime will be `undefined` in the browser.
#   - `API_URL` is read by `next.config.ts` to derive the `next/image` remote
#     allowlist. Omit it and every product photo 400s from the optimiser.
#
# Secrets do NOT belong here — an ARG is recoverable from image history. Meta
# tracking is absent from this list entirely: it is configured from the admin
# dashboard at runtime, so neither the pixel id nor the token is a build input.
ARG API_URL
ARG IMAGE_HOST
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_WHATSAPP_NUMBER
ARG NEXT_PUBLIC_HOTLINE

# Which build this is. Stamped onto every asset and navigation so a browser
# still holding the previous build reloads instead of calling a server action
# that no longer exists — see the note in `next.config.ts`.
#
# Must CHANGE on every deploy, or the protection it buys is nil. The deploy
# passes the commit sha; the fallback only keeps a plain `docker compose build`
# working, and a build that reuses it is one no client can tell apart from the
# last.
ARG NEXT_DEPLOYMENT_ID=dev

ENV API_URL=$API_URL \
    IMAGE_HOST=$IMAGE_HOST \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_WHATSAPP_NUMBER=$NEXT_PUBLIC_WHATSAPP_NUMBER \
    NEXT_PUBLIC_HOTLINE=$NEXT_PUBLIC_HOTLINE \
    NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID

# Prerendering calls the API for the catalogue. When it is unreachable at build
# time the reads fall back to empty rather than failing the build, and the pages
# fill in on first request — see `apiRequestSafe`.
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000
# Bind all interfaces: the default localhost bind is unreachable from outside
# the container.
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache dumb-init

# `standalone` deliberately excludes `public/` and `.next/static`, on the
# assumption a CDN serves them. There is no CDN here, so both are copied in and
# the bundled server serves them itself.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# The image cache, created before dropping privileges.
#
# Those COPY layers land as root, so `.next` is root-owned and the `node` user
# cannot create anything inside it. Next.js writes optimised images to
# `.next/cache`; without it every request re-optimises from scratch and re-fetches
# the source, which on this deployment exhausted the API's rate limit and made
# every image on the shop fail — while the HTML kept rendering, so it read as an
# empty catalogue rather than as a permissions error.
RUN mkdir -p .next/cache && chown -R node:node .next

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
