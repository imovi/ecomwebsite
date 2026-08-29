# Implementation Plan: Admin login — "Forgot password" link sometimes missing, and login fails in the same state

> Planning document only. No production code has been modified.

## Symptom (as reported)

On `/admin/login`, sometimes the "Forgot your password?" link is there and sometimes it is
not. **When it is not there, signing in also fails.** The two always happen together.

## Verdict

There is **no duplicate login code**. Sign-in exists in exactly one place on each side
(`src/lib/admin/actions.ts` → `src/lib/admin/session.ts` → `backend/src/modules/auth/*`),
and there is only one `LoginForm`.

The correlation between the two symptoms is the whole diagnosis: **the browser is running
an old build's client bundle.** The "Forgot your password?" link was added in `9c0c731`
(2026-08-11). A bundle from before that commit renders a login form with no link — and its
server-action ids belong to a build the running server no longer knows, so the submit dies
with `Failed to find Server Action`. One cause, both symptoms, always together.

`f29008a` was supposed to fix exactly this by setting `deploymentId`. **That fix is inert
in production:** nothing in any deploy path sets `DEPLOYMENT_ID`, so every build gets the
literal string `dev`, the id never changes between deploys, Next never detects a skew, and
the hard-navigation protection never fires.

## Evidence

| # | Fact | Location |
|---|------|----------|
| 1 | Forgot link is rendered unconditionally — no flag, no A/B, no server condition. So a page without it is a page from a *different build*. | [LoginForm.tsx:60-65](src/components/admin/LoginForm.tsx:60) |
| 2 | The link shipped in `9c0c731` (2026-08-11); five deploys followed the same day. | `git log -S'/admin/forgot-password'` |
| 3 | `deploymentId` is wired from `NEXT_DEPLOYMENT_ID`. | [next.config.ts:96-98](next.config.ts:96) |
| 4 | Compose defaults it to `dev` when `DEPLOYMENT_ID` is unset. | [docker-compose.yml:154](docker-compose.yml:154) |
| 5 | Dockerfile defaults the ARG to `dev` too. | [Dockerfile:51](Dockerfile:51) |
| 6 | **No deploy path sets `DEPLOYMENT_ID`** — first-run bootstrap builds bare. | [deploy/bootstrap.sh:103](deploy/bootstrap.sh:103) |
| 7 | Documented redeploy command builds bare. | [docs/LAUNCH.md:539](docs/LAUNCH.md:539) |
| 8 | Documented redeploy command builds bare. | [deploy/README.md:161](deploy/README.md:161) |
| 9 | Documented web-only rebuild builds bare. | [deploy/README.md:207](deploy/README.md:207) |
| 10 | The only mention of the correct command is a comment nobody executes. | [docker-compose.yml:150](docker-compose.yml:150) |
| 11 | Next's documented behaviour: on id match the client keeps its stale bundle; only a mismatch forces a hard navigation. | `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md:213-232` |
| 12 | Action ids rotate on new builds — and at most every 14 days even with unchanged source. | `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:174` |

Ruled out along the way:

- **HTTP/CDN caching of the login document** — the page is dynamic (`cookies()` + `searchParams`),
  and Next sends `private, no-cache, no-store, max-age=0, must-revalidate` for dynamic responses
  (`node_modules/next/dist/server/lib/cache-control.js:15`). Caddy adds no cache rule for the
  site origin ([deploy/Caddyfile.example:13-58](deploy/Caddyfile.example:13)).
- **Service worker** — none exists (`public/` holds only `favicon.ico` and one SVG).
- **Backend rate limiting** — `authRateLimit` on `/login` would cause intermittent failures,
  but cannot remove a link from the HTML, so it cannot explain the correlation.
- **Duplicate auth code** — a single backend `auth` module, a single set of server actions.
- **Multi-instance action-key skew** — `web` runs a single replica, so a shared
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is not required today.

## Task type

- [x] Backend / deployment (build + release pipeline)
- [ ] Frontend
- [ ] Fullstack

The application code is correct. The defect is that the release process never varies the
build identity, so a shipped protection is disabled in practice.

---

## Implementation steps

### Step 1 — Make `DEPLOYMENT_ID` vary on every deploy (the actual fix)

Add `deploy/redeploy.sh` as the single, documented redeploy entry point. It must compute an
id that changes per deploy and pass it through to the build.

**Important:** the server is provisioned from a scp'd tarball ([deploy/README.md:54-63](deploy/README.md:54)),
so there is often **no git repo on the box** — the `git rev-parse` one-liner suggested in
[docker-compose.yml:150](docker-compose.yml:150) would fail there and fall straight back to
`dev`. The script needs a fallback.

```sh
# deploy/redeploy.sh  (pseudo-code)
set -euo pipefail

# Changes every deploy. Git sha when this is a checkout; a UTC timestamp when it
# is an unpacked tarball, which is how the server is normally provisioned.
DEPLOYMENT_ID="$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
export DEPLOYMENT_ID

echo "Deploying as ${DEPLOYMENT_ID}"
docker compose up -d --build
docker compose exec -T api npm run db:migrate
```

Deliverable: an executable script whose every run produces a distinct `DEPLOYMENT_ID`.

### Step 2 — Route every documented build through it

| File | Line | Change |
|------|------|--------|
| `deploy/bootstrap.sh` | 103 | Set `DEPLOYMENT_ID` before `docker compose build` (same derivation as Step 1) |
| `docs/LAUNCH.md` | 539 | Replace `git pull && docker compose up -d --build` with `git pull && bash deploy/redeploy.sh` |
| `deploy/README.md` | 161 | Replace the redeploy one-liner with `bash deploy/redeploy.sh` |
| `deploy/README.md` | 207 | Replace `docker compose up -d --build web` with the script (or a documented `DEPLOYMENT_ID=… ` prefix) |
| `docker-compose.yml` | 150 | Update the comment to point at `deploy/redeploy.sh` instead of a raw command |

Deliverable: no remaining documented path that builds `web` without a fresh id.

### Step 3 — Make the silent failure loud (recommended)

The reason this shipped broken is that a missing `DEPLOYMENT_ID` degrades to `dev` in
silence — the build succeeds, and nothing is observably wrong until an admin cannot sign in
days later.

Two options, pick one:

- **(a) Fail the build.** Change [docker-compose.yml:154](docker-compose.yml:154) to
  `${DEPLOYMENT_ID:?set DEPLOYMENT_ID — use deploy/redeploy.sh}`. Strongest guarantee; the
  cost is that a bare `docker compose build` no longer works, which the
  [Dockerfile:44-50](Dockerfile:51) comment deliberately preserved.
- **(b) Warn at startup.** Log a warning when `NEXT_DEPLOYMENT_ID` is `dev` or unset in a
  production build. Keeps the bare build working; relies on someone reading logs.

Recommendation: **(a)** for the compose path, since production is only ever built through
compose, and the "bare build" convenience is what let this regress.

### Step 4 — Verify on the live server (do not skip)

Before the fix, confirm the diagnosis; after it, confirm the repair:

```bash
curl -s https://gng.com.bd/admin/login | grep -o 'dpl=[^"&]*' | sort -u
```

- Before: expect `dpl=dev` (or no `dpl=` at all if the running image predates `f29008a`).
- After: expect the new id, and a **different** value after the next deploy.

Then, in a browser: load `/admin/login`, deploy again, and submit the form from the tab that
was already open. It must reload into the new build rather than fail.

### Step 5 — Cover the tab that never navigates (defence in depth, optional)

`deploymentId` protects *navigations*. A tab restored from bfcache, or one sitting on the
login page across a deploy and submitted without navigating, still posts a dead action id.
Today that lands on the global error screen, whose retry now reloads
([src/app/error.tsx](src/app/error.tsx) — fixed in `f29008a`), so it is recoverable but ugly.

Optional improvement: give `src/app/(admin)/admin/login/` its own `error.tsx` that reloads
immediately instead of showing "Something went wrong" on the one page where a stale bundle
is both most likely and least explicable to the person hitting it.

### Step 6 — Duplicate-code answer (housekeeping, LOW)

There is no duplicated login logic. The only real duplication in this area is a small local
`SubmitButton` helper defined twice:

- [LoginForm.tsx:74](src/components/admin/LoginForm.tsx:74)
- [ForgotPasswordForm.tsx:141](src/components/admin/ForgotPasswordForm.tsx:141)

They differ (one hardcodes its labels, the other takes `idle`/`busy` props). Merging them
into one shared component is a tidy-up, **not** related to this bug. Do it separately or not
at all.

---

## Key files

| File | Operation | Description |
|------|-----------|-------------|
| `deploy/redeploy.sh` | Create | Single deploy entry point; derives and exports `DEPLOYMENT_ID` |
| [deploy/bootstrap.sh:103](deploy/bootstrap.sh:103) | Modify | Set `DEPLOYMENT_ID` before the first build |
| [docs/LAUNCH.md:539](docs/LAUNCH.md:539) | Modify | Point the redeploy instructions at the script |
| [deploy/README.md:161](deploy/README.md:161) | Modify | Same |
| [deploy/README.md:207](deploy/README.md:207) | Modify | Same, for the web-only rebuild |
| [docker-compose.yml:150-154](docker-compose.yml:150) | Modify | Update comment; optionally make the variable required |
| `src/app/(admin)/admin/login/error.tsx` | Create (optional) | Reload straight away on a stale-action error |

No change is required in `src/lib/admin/actions.ts`, `src/lib/admin/session.ts`,
`src/components/admin/LoginForm.tsx`, `src/proxy.ts`, or the backend `auth` module. They are
not at fault.

## Risks and mitigation

| Risk | Mitigation |
|------|------------|
| `git rev-parse` fails on a tarball-provisioned server and silently falls back to `dev` again | Explicit timestamp fallback in the script (Step 1); verify with Step 4 |
| Making `DEPLOYMENT_ID` required breaks someone's bare `docker compose build` | Documented in the error message; `deploy/redeploy.sh` is the supported path |
| A changed `deploymentId` invalidates the static-asset cache each deploy | Intended — that is the mechanism. Assets are content-hashed anyway; cost is one cold load per deploy |
| Admins already holding an ancient tab stay broken until they hard-reload | Unavoidable for bundles already in the wild; Step 5 shortens the recovery to one automatic reload |
| Fix is invisible until the *next* deploy (needs two differing ids to prove) | Step 4's before/after check is written to require two deploys |

## Test plan

- [ ] `deploy/redeploy.sh` produces a different `DEPLOYMENT_ID` on two consecutive runs
- [ ] Same script works in a directory with **no** `.git` (tarball case)
- [ ] Served HTML contains `?dpl=<id>` matching the deployed commit (Step 4)
- [ ] Tab opened before a deploy, submitted after: reloads into the new build; login succeeds
- [ ] "Forgot your password?" is present on every fresh load of `/admin/login`
- [ ] Reset flow end-to-end still works: request code → enter code → `?reset=1` → sign in
- [ ] No documented deploy command remains that builds `web` without an id (`grep -rn "compose.*build" docs deploy README.md`)

## Sessions

Not applicable — `/multi-plan`'s Codex/Gemini legs require the `ccg-workflow` runtime
(`~/.claude/bin/codeagent-wrapper`, `~/.claude/.ccg/prompts/*`), which is not installed on
this machine. This plan was produced from direct source, git-history and vendored-docs
analysis instead.

- CODEX_SESSION: n/a
- GEMINI_SESSION: n/a
