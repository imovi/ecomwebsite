#!/usr/bin/env bash
#
# gng — deploy a code change to a server that is already running.
#
#   bash deploy/redeploy.sh
#
# Rebuilds the images, restarts the stack and applies any new migrations.
#
# USE THIS RATHER THAN `docker compose up -d --build`. The plain compose command
# leaves `DEPLOYMENT_ID` unset, which builds the storefront under the same
# identity as the last one — and an admin whose browser is holding the previous
# build then keeps calling server actions this build no longer has. It shows up
# as a sign-in page missing its "Forgot your password?" link and a password that
# will not go through, because both come from the same stale bundle.

set -euo pipefail

cd "$(dirname "$0")/.."

BOLD=$'\e[1m'; DIM=$'\e[2m'; GREEN=$'\e[32m'; OFF=$'\e[0m'

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$OFF"; }

DEPLOYMENT_ID="$(bash deploy/deployment-id.sh)"
export DEPLOYMENT_ID

step "Building images (deployment ${DEPLOYMENT_ID})"
docker compose build

# --- Migrate BEFORE the new code serves anything ---------------------------
#
# The order here is the whole point. Building and starting first, then
# migrating, leaves a window where the new code is already taking traffic
# against the old schema — and a release that adds a column its own code reads
# spends that window answering "column does not exist" to every shopper.
#
# So the migration runs in a THROWAWAY container built from the new image,
# while the live containers carry on serving the old code. `run --rm` publishes
# no ports, so it cannot collide with the running API.
#
# It also means a broken migration stops the deploy before any traffic moves.
step "Applying database migrations"
# No `--no-deps`: the api service declares `depends_on: postgres: healthy`, and
# letting Compose honour that is what guarantees the database is actually
# accepting connections rather than merely started.
#
# `:prod` runs the COMPILED entrypoint. The runtime image is pruned with
# `npm prune --omit=dev`, so `tsx` — and the TypeScript source it would run —
# are both absent from it, and the dev script fails with `sh: tsx: not found`.
#
# Forward-only and safe to re-run, so this is unconditional: a release with no
# new migrations costs a second, and one that has them cannot be forgotten.
docker compose run --rm api npm run db:migrate:prod

step "Starting the new containers"
docker compose up -d

step "Waiting for API service to be healthy"
for i in $(seq 1 30); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    printf '  API is healthy and accepting requests.\n'
    break
  fi
  sleep 1
done

step "Waiting for Web service to be ready"
published="$(docker compose port web 3000 2>/dev/null || true)"
target_host="${published:-127.0.0.1:8080}"
for i in $(seq 1 30); do
  if curl -sf "http://${target_host}/" >/dev/null 2>&1; then
    printf '  Web service is responding on %s.\n' "$target_host"
    break
  fi
  sleep 1
done

step "Warming up storefront cache (catalogue & branding)"
# Trigger on-demand revalidation to flush any stale build-time static cache
curl -s "http://${target_host}/api/revalidate?secret=revalidate-now" >/dev/null 2>&1 || true
sleep 1
# Follow-up requests ensure the cache is fully populated with live products
curl -s "http://${target_host}/" >/dev/null 2>&1 || true
curl -s "http://${target_host}/category/all" >/dev/null 2>&1 || true
curl -s "http://${target_host}/category/gadget" >/dev/null 2>&1 || true

if curl -s "http://${target_host}/" | grep -q "hinarbd.com/uploads"; then
  printf '%s  Cache warmed up successfully with live branding and products.%s\n' "$GREEN" "$OFF"
fi

step "Running containers"
docker compose ps

printf '\n%s  Deployed as %s%s%s.%s\n' "$GREEN" "$BOLD" "$DEPLOYMENT_ID" "$OFF$GREEN" "$OFF"

if [ -n "$published" ]; then
  printf '%s  Verify the storefront is serving that id:%s\n' "$DIM" "$OFF"
  printf '%s    curl -s http://%s/admin/login | grep -o "dpl=[^\"&]*" | sort -u%s\n\n' \
    "$DIM" "$published" "$OFF"
fi
