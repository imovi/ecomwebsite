# gng backend

REST API for the gng store. Node 20+, TypeScript (ESM), Express 5,
PostgreSQL via Drizzle ORM.

**Phase 1 — foundation.** Configuration, database, security, admin
authentication, validation, error handling, logging, upload plumbing.
Documented below.

**Phase 2 — Product Management.** Categories, products, variants, images,
search, filtering, sorting and Trending. Documented in
**[docs/PRODUCT-MODULE.md](docs/PRODUCT-MODULE.md)** — schema, relationships,
every endpoint, validation rules and the image pipeline.

**Phase 3 — Order Management.** Guest checkout, cash on delivery, configurable
delivery charges, the admin order desk, an immutable audit log, invoices and
notification hooks. Documented in
**[docs/ORDER-MODULE.md](docs/ORDER-MODULE.md)** — schema, relationships, the
order lifecycle, stock handling, every endpoint and validation rules.

Customer accounts, wishlists, reviews, coupons, an analytics dashboard, a
standalone inventory module and payment gateways are deliberately absent.

---

## Quick start

```bash
cd backend
npm install
cp .env.example .env        # then set JWT_ACCESS_SECRET and SEED_ADMIN_EMAIL
npm run db:migrate
npm run db:seed
npm run dev
```

The default `.env.example` uses `DATABASE_DRIVER=postgres`. To run with no
Postgres or Docker installed, set `DATABASE_DRIVER=pglite` — see
[Database drivers](#database-drivers).

Generate a signing secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch mode with `tsx` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (type-aware) |
| `npm test` | Integration tests against embedded Postgres |
| `npm run verify` | typecheck + lint + test |
| `npm run db:generate` | Diff schema → new SQL migration |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Create the first super admin (idempotent) |

---

## Folder structure

```
backend/
├── migrations/                  Generated SQL migrations (committed, reviewed)
│   └── 0000_initial_admin_auth.sql
├── src/
│   ├── server.ts                Process bootstrap, graceful shutdown
│   ├── app.ts                   Express assembly — middleware order lives here
│   │
│   ├── config/
│   │   ├── env.ts               Zod schema for process.env; exits on failure
│   │   └── index.ts             Typed, frozen, domain-shaped config object
│   │
│   ├── core/                    Framework-agnostic primitives
│   │   ├── errors.ts            AppError hierarchy, operational vs programmer
│   │   ├── http-status.ts       Status codes + machine-readable error codes
│   │   ├── response.ts          The response envelope
│   │   ├── logger.ts            Pino, with a redaction list
│   │   └── types.ts             Express request augmentation
│   │
│   ├── db/
│   │   ├── client.ts            Driver abstraction, pooling, lifecycle
│   │   ├── schema/              Drizzle table definitions
│   │   ├── migrate.ts           Migration runner (standalone process)
│   │   └── seed.ts              First-admin seeding
│   │
│   ├── middleware/              Cross-cutting HTTP concerns
│   │   ├── request-context.ts   Correlation id + request logging
│   │   ├── security.ts          Helmet + CORS
│   │   ├── rate-limit.ts        Global and auth-specific limiters
│   │   ├── validate.ts          Zod request validation
│   │   ├── authenticate.ts      JWT verification + role guards
│   │   ├── upload.ts            Multer factory + content verification
│   │   └── error-handler.ts     Centralised error handling + 404
│   │
│   ├── modules/                 Feature modules (vertical slices)
│   │   ├── admins/              Repository + DTO for the admin entity
│   │   ├── auth/                routes → controller → service → repository
│   │   └── health/              Liveness and readiness probes
│   │
│   ├── lib/                     Reusable, framework-free libraries
│   │   ├── security/            password.ts (Argon2id), tokens.ts (JWT/refresh)
│   │   ├── storage/             StorageDriver interface + local driver
│   │   ├── validation/          Shared Zod building blocks
│   │   └── utils/               Small helpers
│   │
│   └── routes/
│       └── v1.ts                Version router; future modules mount here
└── tests/
    └── auth.test.ts             Full-stack integration tests
```

### Architectural rules

**Layering, strictly one direction:**

```
routes → controller → service → repository → database
```

- **Controllers** translate HTTP to and from services. No business logic, no
  SQL. This is why the auth policy is testable without an HTTP server.
- **Services** own the rules. No Express types ever appear here.
- **Repositories** are the only place a table is referenced. No SQL escapes
  them, which keeps the query surface small enough to audit.
- **`core/` and `lib/`** never import from `modules/`. Dependencies point
  inward, so a feature module can be deleted without breaking the foundation.

**Adding a feature module** (Phase 2 onward) means creating
`modules/<name>/` with `.routes.ts`, `.controller.ts`, `.service.ts`,
`.repository.ts`, `.validation.ts`, adding tables under `db/schema/`, and one
`v1Router.use()` line. Nothing in the foundation changes.

---

## Environment variables

Every variable is validated by Zod at startup. A missing or malformed value
prints the offending fields and exits non-zero — a container fails its start
rather than dying on the first request that needs the value.

### Runtime

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `4000` | |
| `API_URL` | `http://localhost:4000` | Public base URL; used for file URLs |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allow-list |
| `TRUST_PROXY_HOPS` | `0` | Number of proxies in front. **Must be > 0 in production** |

### Logging

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info` | `fatal`…`trace`, `silent` |
| `LOG_PRETTY` | `false` | Dev only; rejected in production |

### Database

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_DRIVER` | `postgres` | `postgres` \| `pglite` |
| `DATABASE_URL` | — | Required when driver is `postgres` |
| `DATABASE_SSL` | `false` | |
| `DATABASE_POOL_MAX` | `10` | Pool ceiling per instance |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | `30000` | |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `10000` | |
| `PGLITE_DATA_DIR` | `./.pglite` | `memory://` for ephemeral |

### Authentication

| Variable | Default | Notes |
|---|---|---|
| `JWT_ACCESS_SECRET` | — | **Required**, min 32 chars |
| `JWT_ISSUER` | `gng-api` | Verified on every token |
| `JWT_AUDIENCE` | `gng-admin` | Verified on every token |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | |
| `REFRESH_TOKEN_TTL_DAYS` | `14` | |
| `COOKIE_DOMAIN` | — | Leave empty for host-only |
| `COOKIE_SECURE` | `false` | **Must be true in production** |
| `LOGIN_MAX_FAILED_ATTEMPTS` | `5` | Per account |
| `LOGIN_LOCKOUT_MINUTES` | `15` | |

### Rate limiting

| Variable | Default |
|---|---|
| `RATE_LIMIT_WINDOW_MINUTES` | `15` |
| `RATE_LIMIT_MAX` | `300` |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES` | `15` |
| `AUTH_RATE_LIMIT_MAX` | `10` |

### Uploads / seeding

| Variable | Default |
|---|---|
| `STORAGE_DRIVER` | `local` |
| `UPLOAD_DIR` | `./uploads` |
| `UPLOAD_MAX_FILE_SIZE_MB` | `5` |
| `UPLOAD_MAX_FILES` | `10` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | — |

Production config validation additionally rejects: the `pglite` driver,
`COOKIE_SECURE=false`, `TRUST_PROXY_HOPS=0`, and `LOG_PRETTY=true`.

---

## API conventions

**Base path:** `/api/v1`

**Versioning by URL prefix**, not by header — greppable in logs and access
rules, cacheable, and visible in a URL a user pasted into a support ticket.
Additive changes ship inside `v1`; anything breaking (removing or renaming a
field, changing a type, tightening validation) requires `v2`, with `v1` kept
alive until clients migrate.

**Conventions**

- `application/json` for request and response bodies.
- `camelCase` field names; `snake_case` in the database, mapped by Drizzle.
- Timestamps are ISO 8601 UTC strings.
- Money, when it arrives in Phase 2, will be an integer number of taka.
- Every response carries `X-Request-Id`, echoed in the body as `requestId`.
  An inbound `X-Request-Id` is honoured if it is a UUID.
- Collections are paginated with `?page=` and `?perPage=` (max 100).

**Status codes**

| Code | Used for |
|---|---|
| 200 | Successful read or action |
| 201 | Resource created (`Location` header set) |
| 204 | Success with no body — sent with **no** envelope |
| 400 | Malformed request (bad JSON, unparseable) |
| 401 | Missing, invalid or expired credentials |
| 403 | Authenticated but not permitted; also locked/disabled accounts |
| 404 | No such route or resource |
| 409 | Conflict (duplicate, FK violation) |
| 413 | Body or file too large |
| 415 | Unsupported file type |
| 422 | Validation failed — the body parsed but the data is wrong |
| 429 | Rate limited (`Retry-After` set) |
| 5xx | Server-side failure |

400 vs 422 is a deliberate distinction: 400 means we could not read the
request, 422 means we read it and the contents are invalid.

---

## Response format

Every response — success and failure — is a discriminated union on `success`,
so a client narrows with one check.

**Success**

```json
{
  "success": true,
  "data": { "admin": { "id": "…", "email": "admin@gng.com.bd" } },
  "requestId": "6b1f…"
}
```

**Paginated**

```json
{
  "success": true,
  "data": [ … ],
  "meta": {
    "pagination": {
      "page": 1, "perPage": 20, "total": 137,
      "totalPages": 7, "hasNext": true, "hasPrev": false
    }
  },
  "requestId": "6b1f…"
}
```

**Error**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The submitted data is invalid.",
    "details": [
      { "field": "body.email", "message": "Enter a valid email address." }
    ]
  },
  "requestId": "6b1f…"
}
```

Branch on `error.code`, never on `error.message` — messages are for humans and
may change without notice. `details` appears only on validation failures.

### Error codes

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Field-level validation failed |
| `MALFORMED_JSON` | 400 | Body is not parseable JSON |
| `UNAUTHORIZED` | 401 | No credentials supplied |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `TOKEN_EXPIRED` | 401 | Access token expired — refresh |
| `TOKEN_INVALID` | 401 | Malformed, forged or unknown token |
| `REFRESH_TOKEN_REUSED` | 401 | Reuse detected; family revoked — re-login |
| `ACCOUNT_LOCKED` | 403 | Too many failed logins |
| `ACCOUNT_DISABLED` | 403 | Account deactivated |
| `INSUFFICIENT_ROLE` | 403 | Authenticated but under-privileged |
| `ROUTE_NOT_FOUND` | 404 | No such endpoint |
| `NOT_FOUND` | 404 | No such resource |
| `ALREADY_EXISTS` | 409 | Unique constraint violated |
| `FILE_TOO_LARGE` | 413 | Exceeds `UPLOAD_MAX_FILE_SIZE_MB` |
| `UNSUPPORTED_FILE_TYPE` | 415 | Not a permitted image type |
| `RATE_LIMITED` | 429 | Throttled; see `Retry-After` |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

**Errors are classified as operational or not.** Operational errors (bad
credentials, missing record, rate limit) are described honestly to the client.
Everything else is logged with a full stack and reported as a bare 500,
because raw error messages routinely contain connection strings, SQL
fragments and filesystem paths.

---

## Authentication flow

Two token types, chosen for different jobs.

| | Access token | Refresh token |
|---|---|---|
| Format | JWT (HS256) | 32 random bytes, base64url |
| Lifetime | 15 minutes | 14 days |
| Storage (client) | Memory | `httpOnly` cookie |
| Storage (server) | None — stateless | SHA-256 digest only |
| Transport | `Authorization: Bearer` | Cookie, scoped to `/api/v1/auth` |
| Revocable | No | Yes |

**Why the refresh token is not a JWT.** A stateless JWT cannot be revoked
before it expires. The refresh token is the long-lived credential, so it must
be revocable — which means server state, which means there is no benefit to
making it self-describing. It is stored only as a SHA-256 digest, so a dump of
the table yields nothing presentable to the API.

**Why access in body, refresh in cookie.** The access token is never an
ambient credential, so no state-changing request is authenticated by something
the browser attaches automatically — that removes CSRF as a concern. The
refresh token is `httpOnly`, so XSS cannot read it. Neither placement is safe
alone; the split is what makes it work.

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | Public | Exchange credentials for tokens |
| `POST` | `/api/v1/auth/refresh` | Refresh cookie | Rotate the token pair |
| `POST` | `/api/v1/auth/logout` | Bearer | Revoke session(s) |
| `GET` | `/api/v1/auth/me` | Bearer | Current admin, read live |

`POST /login`

```json
{ "email": "admin@gng.com.bd", "password": "…" }
```

```json
{
  "success": true,
  "data": {
    "admin": { "id": "…", "email": "…", "role": "super_admin", "isActive": true },
    "accessToken": "eyJhbGci…",
    "tokenType": "Bearer",
    "expiresIn": 900
  },
  "requestId": "…"
}
```

`POST /logout` accepts `{ "allDevices": true }` to revoke every session for the
admin. It requires a Bearer token, so a stolen cookie alone cannot trigger it.

### Refresh rotation and reuse detection

Every refresh issues a new token and marks the old one used. All tokens
descended from one login share a `familyId`.

```
login ──► T1 ──refresh──► T2 ──refresh──► T3
           │
           └── replayed later ──► REUSE DETECTED
                                  revoke T1, T2, T3 — whole family dies
```

Presenting an already-exchanged token means it leaked, so the entire family is
revoked and the client must log in again. Without this, a stolen refresh token
is indefinite access; with it, the theft is self-limiting and leaves a loud
`error`-level log line.

Concurrency is handled at the database, not in application code: the claim
runs as `UPDATE … WHERE id = ? AND used_at IS NULL`, so two simultaneous
refreshes cannot both succeed and fork the session.

### Roles

Hierarchical: `manager` (1) < `admin` (2) < `super_admin` (3).
`requireRole("admin")` therefore also admits `super_admin`.

```ts
router.get("/orders", authenticate, requireRole("manager"), handler);
```

`requireRole` **re-reads the admin from the database** rather than trusting the
token's claims. A 15-minute token issued before a demotion or deactivation
would otherwise keep its old privileges until it expired.

### Client integration sketch

1. `POST /auth/login`, keep `accessToken` in memory (not `localStorage` — that
   is readable by XSS).
2. Send `Authorization: Bearer <accessToken>`.
3. On `401` with `TOKEN_EXPIRED`, call `POST /auth/refresh` (send credentials
   with `fetch(..., { credentials: "include" })`), then retry once.
4. On `401` with `TOKEN_INVALID` or `REFRESH_TOKEN_REUSED`, clear state and
   redirect to login.

---

## Security summary

| Concern | Measure |
|---|---|
| Password storage | Argon2id, m=19456 KiB, t=2, p=1 (OWASP minimum); auto-rehash on login when parameters change |
| Account enumeration | Identical response and comparable timing for unknown account vs wrong password (dummy hash on the miss path) |
| Brute force | Per-account lockout after N failures + per-IP+email rate limit |
| IPv6 limiter bypass | `ipKeyGenerator` collapses IPv6 to a /64 prefix |
| SQL injection | Drizzle parameterises everything; `drizzle-orm` pinned ≥ 0.45.2 for GHSA-gpj5-g38j-94v9; sort columns validated against an allow-list |
| XSS | API returns JSON only; `nosniff`; restrictive CSP; control characters stripped from input. Output escaping is React's job at render time |
| CSRF | Bearer auth for all state changes; refresh cookie is `SameSite=Strict` and path-scoped |
| Clickjacking | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |
| Secrets in logs | Pino redaction list covers auth headers, cookies, passwords, tokens |
| Payload exhaustion | 100 KB body cap; multipart bounded on size, count, fields and parts |
| Upload abuse | Magic-byte content sniffing; generated filenames; path-containment check |
| Header forgery | `trust proxy` is a hop count, never `true` |

**Not yet built** (deliberate, and required before public launch): password
reset, 2FA, an audit log of admin actions, and a shared rate-limit store.

---

## Database

### Drivers

`DATABASE_DRIVER=postgres` (default) uses `pg.Pool` — the production path.

`DATABASE_DRIVER=pglite` runs Postgres compiled to WebAssembly, in-process. It
is the real engine, so migrations and SQL behave identically, which makes it
suitable for local development and integration tests on a machine with no
Postgres or Docker. **Config validation rejects it when `NODE_ENV=production`.**

Nothing above `db/client.ts` knows which driver is active.

### Migrations

```bash
npm run db:generate -- --name=add_products   # after editing src/db/schema/
npm run db:migrate
```

Generated SQL is committed and reviewed like any other code — the main reason
for choosing Drizzle over an ORM that hides its DDL.

Migrations are applied by a **standalone process**, never on server boot: with
multiple replicas, boot-time migrations race, and a failed migration should
stop a deploy rather than crash-loop a container. Run `db:migrate` as a
release step.

### Schema (Phase 1)

`admins` — staff identity. Deliberately separate from any future `customers`
table; merging staff and customer identities is very hard to unpick and leads
to authorisation bugs.

`refresh_tokens` — session store with `familyId`, `usedAt`, `replacedByTokenId`
and `revokedAt` supporting the rotation and reuse-detection scheme above.

---

## File upload foundation

Plumbing only — **no upload routes exist yet**, by design. A Phase 2 module
composes it:

```ts
router.post(
  "/products/:id/images",
  authenticate,
  requireRole("admin"),
  uploadImages("images", 5),
  persistUploads("products"),
  handler,   // reads req.uploadedFiles
);
```

- **Memory storage, not disk.** Multer's disk storage writes before validation
  runs, so a rejected upload still touched the filesystem.
- **Content sniffing is the security boundary.** The declared `Content-Type`
  and file extension are attacker-controlled and used only for a cheap early
  rejection; the real check reads magic bytes (`lib/storage/file-types.ts`).
- **Filenames are generated**, never derived from client input, so `../../.env`
  and `shell.php` cannot become a path.
- **Storage is abstracted** behind `StorageDriver`. Local disk ships today;
  adding S3/R2 is one class plus a branch in `lib/storage/index.ts`. Local disk
  stops being correct the moment there are two app servers.

---

## Observability

- **Structured JSON logs** (Pino) with a redaction list.
- **Correlation ids** on every request, echoed in the response and every log
  line. One `requestId` grep returns the whole story of a request.
- **Log levels by outcome**: 5xx → `error`, 4xx → `warn`, 2xx → `info`, health
  checks → silent.
- **`/health/live`** — process liveness; touches no dependency. Failure means
  a restart will help.
- **`/health/ready`** — dependency readiness, including pool statistics.
  Failure means the instance should leave the load-balancer rotation, *not* be
  restarted.

Conflating those two probes is how a brief database blip turns into every
replica restarting at once.

---

## Verification

```bash
npm run verify
```

`tests/auth.test.ts` runs the real stack end to end — real HTTP, real
middleware order, real Argon2, real SQL against a real Postgres engine.
Nothing is mocked. 26 tests currently cover: health probes, the response and
error envelopes, security headers, validation (including unknown-key
rejection and malformed JSON), login, account enumeration resistance, lockout,
disabled accounts, token forgery, refresh rotation, reuse detection, logout
revocation and rate limiting.

---

## Production checklist

1. `DATABASE_DRIVER=postgres` with a real `DATABASE_URL`; set `DATABASE_SSL=true`
   for a managed provider.
2. Strong unique `JWT_ACCESS_SECRET`; `COOKIE_SECURE=true`;
   `TRUST_PROXY_HOPS` set to the real proxy count.
3. Run `db:migrate` as a release step, before new instances start.
4. **Replace the in-memory rate-limit store** with `rate-limit-redis` before
   running more than one replica — otherwise the effective limit multiplies by
   the replica count. One `store` option in `middleware/rate-limit.ts`.
5. Schedule `deleteExpiredRefreshTokens()` — refresh tokens are the
   fastest-growing table in an auth system.
6. Move uploads to object storage before scaling past one app server.
7. Ship logs to an aggregator; alert on `REFRESH_TOKEN_REUSED`, which means a
   token was stolen.
