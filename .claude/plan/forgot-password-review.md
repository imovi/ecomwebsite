# Code Review: Admin "Forgot Password" (uncommitted)

> Reviewed 2026-08-11 against the working tree — 19 modified files, 8 new.
> No code was changed by this review.
>
> The `ccg-workflow` runtime is not installed, so there is no Codex/Gemini
> cross-check. Four specialist agents were used instead: `security-reviewer`,
> `typescript-reviewer`, `silent-failure-hunter`, `database-reviewer`. Their
> load-bearing claims were re-verified directly against the source before being
> written down here.

## Verdict

**Do not deploy as-is.** Nine findings, four of them worth fixing before this
goes near production. None of them let an attacker into the panel — the core
flow (hash the code, spend it once, revoke sessions, clear the lockout) is
sound, and the 354 passing tests cover it. What is broken is the *guarantees
around* that flow: an enumeration defence that does not actually hold, an
attempt ceiling that leaks under concurrency, and a failure mode that leaves a
locked-out owner staring at a screen that says everything is fine.

One of these is a documentation lie I wrote, and it is the worst of them.

---

## H1 — The enumeration defence does not hold, and a comment claims it does

`backend/src/modules/auth/auth.service.ts:390-439`

Every early return in `requestPasswordReset` — unknown account, disabled
account, cooldown still active — comes back after a single cheap `SELECT`, in
single-digit milliseconds. The one path that continues does an Argon2 hash
(~50-100 ms) **plus a live SMTP transaction and a Telegram HTTP call**, because
`deliverResetCode` is awaited inside the request.

That is a one-shot oracle. No statistical averaging needed: a fast answer means
"not a live admin account", a slow one means "yes, and here is the address to go
after". `login` and `resetPasswordWithCode` both defend against exactly this
with `simulatePasswordVerification` — verified present at `auth.service.ts:95`,
`:468` and `:474`. It appears **nowhere** in `requestPasswordReset`.

And this, which I wrote, at `auth.controller.ts:178-180`:

> *"That includes the timing of the answer, which is why the service does a
> dummy Argon2 verification on the paths where there is nothing real to check."*

That sentence is false. The service does no such thing on this endpoint. A
comment asserting a security property that the code does not implement is worse
than no comment — the next person to read it stops checking.

**Fix — one change closes most of it.** Send the code *after* the response,
not before it:

```
sendSuccess(res, { message: ... })   ← respond immediately
then deliver, fire-and-forget
```

Delivery latency then cannot vary with the answer, because it is no longer
inside the answer. That alone removes the network component, which is the
largest and most variable part. Add a dummy Argon2 on the three early-return
branches to flatten the remaining ~50-100 ms, matching what `login` already
does. Fix the comment either way.

This same change also fixes **H4** — see below.

---

## H2 — The five-attempt ceiling leaks under concurrency

`backend/src/modules/auth/auth.service.ts:472-496`,
`backend/src/modules/auth/password-reset.repository.ts:66-77`

The ceiling is check-then-act with a slow operation in the middle:

1. `findLatestLiveReset` — a plain `SELECT`, no row lock — reads `attempts`
2. compare against `RESET_MAX_ATTEMPTS`
3. **`verifyPassword` — Argon2, ~100 ms**
4. `incrementResetAttempts`

Step 4 is atomic on its own. The *gate* is not. N requests fired together all
read the same stale `attempts`, all pass step 2, and all reach step 3. The real
bound on live guesses becomes however many an attacker can run in parallel — not
five. The Argon2 verify makes the window unusually wide.

The per-IP rate limiter does not save this: it keys on address plus email, and
an attacker with a proxy pool has many addresses.

**Fix — reserve the attempt atomically instead of checking it:**

```sql
UPDATE admin_password_resets
   SET attempts = attempts + 1
 WHERE id = $1 AND consumed_at IS NULL AND attempts < 5
RETURNING attempts
```

No row back means the budget is gone — reject before Argon2 is ever called,
which also stops the endpoint being a free CPU burner.

---

## H3 — Two live codes can exist at once, doubling the budget in H2

`backend/src/modules/auth/auth.service.ts:402-423`,
`backend/src/modules/auth/password-reset.repository.ts:35-49`

The "one live code per account" rule is three separate round trips with no
transaction, no lock and no constraint holding them together: check the
cooldown, invalidate the old codes, insert the new one. A double-click, a
client retry after a timeout, or genuinely concurrent traffic can have both
requests pass the cooldown check before either has inserted — leaving two rows
with `consumed_at IS NULL`.

`findLatestLiveReset` then orders by `created_at DESC` with **no tiebreaker**.
`created_at` defaults to `now()`, which is transaction-start time and can
genuinely collide. Which of the two codes counts as "latest" is undefined, and
the docstring at `password-reset.repository.ts:26-29` — "a second request
supersedes the first" — is not actually guaranteed.

Worse, two live rows means two independent five-attempt budgets.

**Fix — make it a database invariant rather than a hope:**

```sql
CREATE UNIQUE INDEX admin_password_resets_one_live_idx
  ON admin_password_resets (admin_id) WHERE consumed_at IS NULL;
```

Plus `ORDER BY created_at DESC, id DESC` for determinism. The unique index is
the real fix — it makes the race impossible instead of unlikely.

---

## H4 — A half-dead SMTP host produces a genuinely confusing failure

`backend/src/lib/mail/mailer.ts:62-78` vs `src/lib/api/config.ts:42`

The transporter sets no timeouts, so nodemailer's defaults apply:
**2 minutes** to connect, **30 seconds** for a greeting. The storefront aborts
its call to the API after **8 seconds** (`timeoutMs: 8000`, verified).

An SMTP host that accepts TCP and then stalls — firewalled, overloaded, mid-AUTH
— plays out like this:

1. The owner asks for a code.
2. Telegram delivers it in under a second. **The code is now in their pocket.**
3. Email hangs. `Promise.all` waits for the slower branch.
4. At 8 seconds the browser gives up and shows
   **"Could not reach the server. Please try again."** — which is false. The
   server is fine and the code was already sent.
5. They try again, as instructed. The 60-second cooldown silently drops it —
   same reassuring message, no new code.
6. The code that will actually work is the one from step 2, which they have been
   told to disregard.

Nothing here is malicious and nothing is a crash. It is a self-inflicted outage
built out of two reasonable numbers that were never compared.

**Fix:** set `connectionTimeout` / `greetingTimeout` / `socketTimeout` to ~5 s so
the mail path fails inside the frontend's window. Moving delivery out of the
request path (**H1**) removes the collision entirely.

---

## M5 — "Delivery is not configured at all" is a fact worth telling

`backend/src/modules/auth/auth.controller.ts:185-194`

`requestPasswordReset` returns `{ delivered, sentToEmail, sentToTelegram }`. The
controller ignores it and always answers the same 200. I chose that deliberately,
for enumeration resistance.

The review's counter-argument is better than my reasoning, and I accept it: **two
different questions are being conflated.**

| Question | Account-specific? | Must stay hidden? |
|---|---|---|
| Does this address belong to an admin? | Yes | **Yes** |
| Is this server able to send anything at all? | **No** | No |

Whether `SMTP_HOST` is set and whether a Telegram token exists are properties of
the deployment. The answer is byte-identical for a real admin address, a fake
one, and an empty string — so surfacing it leaks nothing.

The gap this leaves is not theoretical. Telegram is configured **from the panel
the owner is now locked out of**. On a fresh install with neither channel set up,
every reset attempt returns the same encouraging "a code is on its way", forever,
for a code that cannot exist. The only trace is one `log.error` on a server they
cannot reach through the product.

**Fix:** check "is any channel configured" *before* the account lookup, and if
not, say so plainly — for every email, identically.

---

## M6 — Nothing warns at boot that recovery is impossible

`backend/src/config/env.ts`

`env.ts` hard-fails startup over `TRUST_PROXY_HOPS` and `COOKIE_SECURE`
mistakes. The one path back into a locked-out panel gets no check at all. A
deploy with no SMTP and no Telegram looks perfectly healthy until the day it
matters.

**Fix:** a one-line `log.warn` at boot. It costs nothing and lands in deploy
logs, where somebody is actually looking.

---

## M7 — `Promise.all` makes a safety property depend on three files

`backend/src/modules/auth/reset-code.delivery.ts:50-53`

Both branches are written never to throw, and that holds today — verified
through `mailer.ts:90-109` and `telegram.service.ts:177-210`. But it is a
convention spread across three files, not a guarantee. If either ever throws,
`Promise.all` rejects, nothing between it and Express catches it, and a request
that has **already inserted a live code** returns a 500 — which is a different
response from the uniform 200, i.e. the enumeration oracle again, through a
second door.

**Fix:** `Promise.allSettled`, or a `.catch()` per branch, plus a defensive
`try/catch` around the `deliverResetCode` call.

---

## M8 — No backoff across successive codes

An attacker who can request a fresh code every 60 s gets ~7,200 guesses a day
against a 1,000,000 space — around 0.72 % a day, which stops being negligible
over weeks. `login` has account lockout; this flow has no equivalent.

Mitigating: every request sends the owner an email *and* a Telegram message, so
a sustained attack is extremely loud. Worth tracking consecutive wrong codes per
account and escalating the cooldown, but it is not what blocks this release.

---

## L9 — `row!` where the rest of the codebase throws

`backend/src/modules/auth/password-reset.repository.ts:19-20`

Safe today — a single-row `INSERT … RETURNING` cannot come back empty. But
`createAdmin` (`admin.repository.ts:52-56`) and `insertRefreshToken`
(`refresh-token.repository.ts:20-24`) both check and throw a described error.
This file's own `SELECT` helpers correctly use `row ?? null`. Match the
house idiom.

---

## Checked and clean

Worth recording, because these were the plausible failure points:

- **Migration 0022 vs the Drizzle schema** — compared column by column: names,
  types, nullability, defaults, the FK name, the index. Exact match. This is the
  class of bug that has already bitten this project once, and it is not present.
- **`_journal.json`** — verified against the migrator's real implementation
  (`drizzle-orm/pg-core/dialect.js`), which selects by a single `when` watermark
  rather than per-file hashes. Entry 22's timestamp is strictly greater than
  21's, so a production database sitting at 0021 applies exactly this one file.
- **`gen_random_uuid()`** — built in since PG13, no extension, consistent with
  20+ prior migrations here.
- **`consumeReset`** — genuinely atomic. Two submissions of the same correct
  code cannot both reset the password.
- **`updatePasswordHash` signature change** — all three call sites re-checked;
  `{}` and `{ markPasswordChanged: false }` behave identically. No regression.
- **Rules of Hooks** — `CodeStep` is a separate component, so the early return
  in `ForgotPasswordForm` is legal. No violation.
- **`redirect()`** placement, Next 16 `searchParams` awaiting, array-valued
  `?reset=` — all correct.
- **Attempt boundary** — exactly five wrong guesses, checked before the verify
  so none is double-counted. No off-by-one.
- **`clearLockout`** — opt-in, and reachable only after a verified, consumed
  code. Correctly scoped.
- **Secret handling** — the plaintext code is never logged, returned, or stored;
  `mailer.ts` deliberately keeps the recipient address out of its error log, and
  the request logger already strips bodies.
- **`src/proxy.ts`** — exact-match on the path, so no prefix or suffix bypass.
  No other admin route was opened.
- **Redirect target** — a hardcoded literal. Not an open redirect.

---

## Suggested order

1. **H1 + H4 together** — move delivery out of the request path, add the SMTP
   timeouts, add the dummy Argon2, and fix the false comment. One change,
   two findings.
2. **H3** — the partial unique index. Smallest diff, largest guarantee.
3. **H2** — the atomic attempt reservation. H3 first, because H3 doubles what
   H2 leaks.
4. **M5 + M6** — the configured/not-configured signal, and the boot warning.
5. **M7, L9** — cheap hardening.
6. **M8** — after the rest, if at all.

Each needs a regression test. The existing suite passes precisely because none
of these are exercised: the timing gap, the concurrency races and the delivery
failure modes all sit outside what 354 sequential tests can see.

---

## SESSION_ID

- CODEX_SESSION: *(unavailable — `ccg-workflow` not installed)*
- GEMINI_SESSION: *(unavailable — `ccg-workflow` not installed)*

Agents: `security-reviewer` (`a4fc7bf7ada92d8eb`), `typescript-reviewer`
(`ae89fd9475d67ca8e`), `silent-failure-hunter` (`a46661e44000274ae`),
`database-reviewer` (`ad65c1742d98d42a9`).
To enable multi-model planning: `npx ccg-workflow`
