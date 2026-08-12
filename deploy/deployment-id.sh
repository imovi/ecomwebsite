#!/usr/bin/env bash
#
# Prints the identifier for the build about to be made.
#
#   DEPLOYMENT_ID="$(bash deploy/deployment-id.sh)"
#
# Next stamps this onto every asset and navigation and compares it on the way
# back, so a browser still holding the previous build reloads instead of calling
# a server action that no longer exists — see the note in `next.config.ts`.
#
# The ONE property that matters is that it differs on every deploy. It bought
# nothing for its first weeks in the tree because no deploy path set it, so every
# build came out as the literal `dev` and no client could tell two of them apart.
# That is why this is a file both deploy scripts call rather than a line each of
# them is trusted to remember.

set -euo pipefail

# Always present, always different. A commit sha alone is not enough: a fix
# applied on the server and rebuilt without a commit — which is how a hurried
# hotfix actually happens — would deploy twice under the same id.
#
# The clock is only accurate to the second, and the whole value of this file is
# that its output never repeats, so it does not rest on "two builds cannot start
# in the same second". Four random digits cost nothing and remove the question.
stamp="$(date -u '+%Y%m%d%H%M%S')-$(printf '%04d' "$((RANDOM % 10000))")"

# And the sha when there is one, purely so the id says something to a person
# reading it in page source. The server is normally provisioned from an unpacked
# tarball with no repository in it, so this has to be allowed to fail.
if sha="$(git rev-parse --short HEAD 2>/dev/null)"; then
  printf '%s-%s\n' "$sha" "$stamp"
else
  printf '%s\n' "$stamp"
fi
