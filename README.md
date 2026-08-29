# gng

A mobile-first gadget store for the Bangladesh market. Cash on delivery, guest
checkout, no customer accounts.

Two deployables in one repository:

- **`/`** — Next.js 16 storefront and admin panel (React 19.2, Tailwind v4)
- **`/backend`** — Express 5 API on Postgres (Drizzle ORM, TypeScript ESM)

The browser never talks to the API directly. Page data is fetched by the Next
server, and admin requests go through an authenticated proxy inside it — so the
API can sit on a private network and needs no CORS rule for the storefront.

To deploy this for real, follow [`docs/LAUNCH.md`](docs/LAUNCH.md).

## Running it locally

Two terminals. The API first:

```bash
cd backend && cp .env.example .env && npm install && npm run db:migrate && npm run db:seed && npm run dev
```

Then the storefront:

```bash
cp .env.example .env.local && npm install && npm run dev
```

The API defaults to `DATABASE_DRIVER=pglite` friendly settings for local work —
an embedded Postgres, no server to install. Switch to `postgres` with a
`DATABASE_URL` when you want the real thing.

Seed a realistic catalogue through the public API:

```bash
cd backend && npm run seed:catalog
```

| | |
|---|---|
| Storefront | http://localhost:3000 |
| Admin | http://localhost:3000/admin |
| API | http://localhost:4000/api/v1 |

---

## What's here

| Surface | Route | Notes |
|---|---|---|
| Home | `/` | Banner, categories, new arrivals, trending. ISR 5m |
| Category | `/category/[slug]` | `all` is a virtual category |
| Product | `/product/[slug]` | Sticky buy bar, variant sheet, JSON-LD. ISR 5m |
| Search | `/search?q=` | noindex |
| Cart | `/cart` | localStorage; prices resolved server-side on every view |
| Checkout | `/checkout` | `?mode=buynow` bypasses the cart |
| Order success | `/order/success/[orderNumber]` | |
| Track order | `/track` | Order number **and** matching phone |
| Policies | `/policies/[slug]` | delivery, returns, warranty, terms, privacy, about, contact |
| Admin | `/admin` | Overview, orders, profit, products, categories, branding, tracking, alerts, team, settings |

The admin panel is behind real authentication — see below.

## Architecture

```
src/
  app/
    (shop)/            storefront routes + shell
    (admin)/           admin routes (login is outside the shell)
    api/admin/[...path] authenticated proxy to the API — owns token refresh
    actions.ts         storefront server actions: cart resolve, quote, order, track
  proxy.ts             admin route guard (the `proxy` file convention)
  components/
    ui/                Button, Badge, Price, Field, Sheet, Toaster, Icon, Layout
    product/ home/ cart/ checkout/ shop/
    admin/             shell, product form, image manager, order detail, settings
  lib/
    api/               typed client, DTO mirror, adapters, config
    data/              REPOSITORY LAYER — the only module that reads the API for pages
    admin/             session, client, revalidation
    analytics/         Meta Pixel, Google Tag Manager, dataLayer events
    stores/            zustand: cart, toast, last order
    geo.ts             delivery-zone suggestion
    copy.ts            every user-facing string

backend/src/
  modules/             auth, admins, categories, products, orders, settings, marketing, integrations, banners, reports, health
  db/                  schema, migrations, seed, driver abstraction
  middleware/          security stack, validation, auth, upload, rate limits
  core/                errors, response envelope
```

`lib/data/*` kept the same function signatures when the mock tables were
replaced by real API calls, which is why no page or component changed during
that swap. That was the point of putting a repository layer there.

### Rules the codebase follows

- **Money is always an integer number of taka.** Never a float. Formatting
  happens only in `formatTaka`. The API rejects a decimal price rather than
  truncating it.
- **Discount percentages are derived, never stored** — a stored percentage goes
  stale the first time someone edits a price. It is a generated column in
  Postgres.
- **Cost is snapshotted onto the order line, exactly like price.** Profit joined
  to a product's *current* buying price would rewrite every past order the day a
  supplier raises his rate. A line with no recorded cost counts as earning
  nothing rather than as pure profit — the report understates rather than
  flatters, and says how much of itself is unknown.
- **The cart stores only `{ productId, variantId, qty }`.** Names, prices, images
  and stock ceilings are fetched fresh on every cart view and recomputed again at
  order placement, so a stale cart can never buy at a stale price.
- **Order items carry snapshots** of name, price and image. Editing a product
  must never rewrite order history.
- **No component hardcodes user-facing text.** It all lives in `lib/copy.ts`, so
  switching the UI to Bangla is one file.
- **`lib/data/*` and `lib/api/*` are `server-only`.**
- **Every order mutation is inside a transaction and writes an audit entry.**
  Nothing about an order is ever silently modified.

---

## Three decisions worth understanding

### Admin credentials never reach the browser

The API issues a short-lived access token plus a rotating refresh token. The Next
server captures both and stores them in its own httpOnly cookies; the browser
holds nothing but an opaque cookie for the storefront's own origin. Every admin
request goes through `src/app/api/admin/[...path]/route.ts`, which attaches the
bearer token server-side.

An access token in `localStorage` is readable by any XSS. Here an XSS can act as
the admin while the page is open but cannot exfiltrate a credential to use later.
Token refresh lives in that one route handler because rotation must write a
cookie, and only a route handler or server action can.

`src/proxy.ts` checks only that a session cookie *exists* — it does not validate
the token, because that would add a network round trip to every navigation. Real
enforcement is the API's signature check plus the proxy's refusal to forward
without a session. A forged cookie yields an empty shell and a 401 on every
request.

### Delivery zone is suggested, never silently inferred

`lib/geo.ts` matches free-typed area text against thana, neighbourhood and
district lists to **pre-select** a zone; the customer's confirmed selection is
what gets stored, and the API recomputes the charge server-side regardless.

A naive `text.includes("dhaka")` is wrong in both directions, and each mistake
costs money at the doorstep:

- `"Dhanmondi"`, `"Mirpur 10"`, `"Uttara Sector 7"` — inside Dhaka, but the word
  "Dhaka" never appears.
- `"Savar, Dhaka"`, `"Keraniganj, Dhaka"`, `"Tongi, Gazipur"` — contain "Dhaka"
  but couriers bill them at the outside-city rate.

Hence the check order in `suggestZone`: outside-overrides → inside-Dhaka areas →
districts → bare "dhaka". Bangla script and common misspellings are mapped.

### Trending is measured, never pinned

Products are ranked by a decay-weighted score over **delivered** orders,
computed and indexed in Postgres. On a COD store, counting *placed* orders lets
refused and prank orders decide what the homepage promotes.

There is deliberately no way for an operator to pin a product into Trending. A
"trending" rail that can be hand-arranged is just a second Featured rail, and it
stops telling you anything true about demand.

---

## Order lifecycle

```
PENDING → CONFIRMED → PROCESSING → PACKED → SHIPPED → DELIVERED
             ↓            ↓          ↓         ↓          ↓
         CANCELLED    CANCELLED  CANCELLED CANCELLED   RETURNED
```

`PENDING → CONFIRMED` is the confirmation phone call, made an explicit logged
transition so "did anyone ring this customer?" is a fact rather than a guess.

Stock is decremented at placement with a conditional `UPDATE ... WHERE
stock_quantity >= qty` — so two simultaneous orders for the last unit cannot both
succeed — and released on cancel or return. Illegal transitions are rejected by
the service, and cancellation requires a reason that is recorded permanently.

Every edit — a corrected phone number, a changed quantity, a status change —
appends an immutable audit entry recording who changed what, from what, to what,
and when.

---

## Verification

```bash
npm run build                    # storefront
cd backend && npm run verify     # typecheck + lint + 298 integration tests
```

The backend suite runs against a real embedded Postgres, not mocks — migrations,
constraints, generated columns and transaction behaviour are all exercised.

---

## Deliberately not built

Reviews and ratings (an empty review section hurts a new store more than it
helps — the product-page trust badges do that job instead), customer accounts,
wishlists, a general discount system, online payment, email/SMS transports, and
an analytics dashboard.

There is one coupon, and it is deliberately not a discount system: a one-time
free-delivery code the desk hands to a single abandoned checkout, valid for a
day. It exists because the order desk could not otherwise keep a promise it was
already making on the phone — `orders` refuses admin edits to the delivery
charge on purpose. Anything wider (percentage off, campaign codes, stacking)
would be a different feature with different accounting behind it.

What *is* attached to the order event bus: Meta's Conversions API, Telegram
alerts and the Google Sheets export. Each is a subscriber that reads its own
configuration from store settings, so adding SMS later is another subscriber
rather than a refactor — and a failing one can never fail a checkout.
