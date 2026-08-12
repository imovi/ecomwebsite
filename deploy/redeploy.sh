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

step "Building and starting (deployment ${DEPLOYMENT_ID})"
docker compose up -d --build

step "Applying database migrations"
# `:prod` runs the COMPILED entrypoint. The runtime image is pruned with
# `npm prune --omit=dev`, so `tsx` — and the TypeScript source it would run —
# are both absent from it, and the dev script fails with `sh: tsx: not found`.
#
# Forward-only and safe to re-run, so this is unconditional: a release with no
# new migrations costs a second, and one that has them cannot be forgotten.
docker compose exec -T api npm run db:migrate:prod

step "Running containers"
docker compose ps

printf '\n%s  Deployed as %s%s%s.%s\n' "$GREEN" "$BOLD" "$DEPLOYMENT_ID" "$OFF$GREEN" "$OFF"
printf '%s  Verify the storefront picked it up:%s\n' "$DIM" "$OFF"
printf '%s    curl -s localhost:3000/admin/login | grep -o "dpl=[^\"&]*" | sort -u%s\n\n' "$DIM" "$OFF"
