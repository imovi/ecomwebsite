# Product Management module (Phase 2)

Categories, products, variants and images for the gng catalogue.

Built on the Phase 1 foundation with no changes to it beyond two additive
edits: mounting the new routers in `src/routes/v1.ts` and re-exporting the new
tables from `src/db/schema/index.ts`.

---

## Database schema

Five tables. Money is an **integer number of taka** everywhere — never a float.

### `categories`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text | unique, case-insensitive |
| `slug` | text | unique, case-insensitive; derived from name when omitted |
| `description` | text | nullable |
| `image_key` | text | storage key, **not** a URL |
| `icon` | text | key into the storefront's own icon set |
| `sort_order` | int | manual display order, ties broken by name |
| `is_active` | bool | disabled categories keep their products |
| `created_at` / `updated_at` | timestamptz | |

Deliberately **flat** — no `parent_id`. Nesting was not requested, and a
self-referencing tree drags recursive queries, breadcrumb resolution and cycle
prevention into every read. Adding it later is additive; removing it once code
depends on it is not.

### `products`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name`, `slug`, `sku`, `brand` | text | slug and SKU unique, case-insensitive |
| `category_id` | uuid fk | → `categories.id`, **ON DELETE RESTRICT** |
| `short_description`, `description` | text | nullable |
| `specifications` | jsonb | `[{ label, value }]` |
| `whats_included` | jsonb | `string[]` |
| `variant_options` | jsonb | `[{ name, values[] }]` — declared axes |
| `tags` | text[] | GIN indexed |
| `warranty` | text | nullable |
| `price` | int | current selling price |
| `old_price` | int | nullable; pre-discount reference |
| **`discount_percent`** | int | **GENERATED ALWAYS** — see below |
| `stock_quantity` | int | denormalised sum of variants when they exist |
| `stock_status` | enum | `in_stock` \| `out_of_stock` \| `pre_order` \| `discontinued` |
| `low_stock_threshold` | int | drives the storefront's urgency hint |
| `status` | enum | `draft` \| `active` \| `archived` |
| `is_visible` | bool | hide without archiving |
| `published_at`, `archived_at` | timestamptz | stamped once, on first transition |
| **`search_vector`** | tsvector | **GENERATED ALWAYS**, GIN indexed |

**`discount_percent` is a generated column, not an application calculation.**
A stored percentage goes stale the first moment someone edits a price; a value
computed in the API layer cannot be sorted or filtered on. A generated column
is correct by construction *and* indexable.

**`search_vector` is a weighted generated tsvector:**

```
A  name, sku            simple  (no stemming)
B  brand, tags          simple
C  short_description    english (stemming helps prose)
```

`simple` for identifiers because English stemming mangles model numbers and
brand names — "AirPods" must not stem to "airpod", and "Redmi"/"redmis" are not
the same product.

Tags reach the vector through `catalog_tags_to_text()`, a narrow **IMMUTABLE**
wrapper defined in migration `0001`. The built-in `array_to_string` is only
STABLE — for a generic `anyarray` its result depends on the element type's
output function — so Postgres refuses it in a generated column. Restricted to
`text[]` with a fixed delimiter there is no such dependency, so declaring that
signature immutable is accurate rather than a workaround.

### `product_variants`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `product_id` | uuid fk | → `products.id`, **CASCADE** |
| `sku` | text | unique **globally**, case-insensitive |
| `options` | jsonb | `{ "Color": "Black", "Storage": "256GB" }` |
| `price`, `old_price`, `stock_quantity` | int | |
| `image_id` | uuid fk | → `product_images.id`, **SET NULL** |
| `is_active`, `sort_order` | | |

`options` is jsonb rather than a normalised option/value/assignment triple: the
axes differ per product, values are only ever read as a set alongside their
variant, and the service validates every key against the parent's
`variant_options`. Three extra tables and two joins would buy flexibility this
catalogue does not use.

SKU is unique **globally**, not per product — it is the identifier warehouse
staff read off a box, and a duplicate across two products is a picking error.

### `product_images`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `product_id` | uuid fk | → `products.id`, **CASCADE** |
| `storage_key` | text | driver key; URLs are derived at read time |
| `alt` | text | defaults to the product name |
| `width`, `height`, `size`, `mime_type`, `checksum` | | captured at upload |
| `is_featured` | bool | **partial unique index**: one per product |
| `sort_order` | int | gallery order |

The featured image is a flag here rather than `products.featured_image_id`,
which would create a circular foreign key. `CREATE UNIQUE INDEX … WHERE
is_featured` enforces "at most one" in the database — stronger than any service
check.

### `product_metrics`

| Column | Type | Notes |
|---|---|---|
| `product_id` | uuid pk fk | → `products.id`, **CASCADE** |
| `view_count` | bigint | all-time detail views |
| `units_sold` | int | all-time; drives `best_selling` |
| `units_sold_recent` | int | trailing window; dominant trending term |
| `last_sold_at` | timestamptz | |
| `trending_score` | double precision | **precomputed**, indexed DESC |
| `score_updated_at`, `updated_at` | timestamptz | |

Separate from `products` on purpose: these columns are written on a read path
(a view bumps a counter), so keeping them apart means views do not churn
product rows, invalidate their cache, or contend with catalogue writes.

---

## Relationships

```
categories 1 ──── n products            RESTRICT   (deleting a category with
                                                    products is refused)
products   1 ──── n product_variants    CASCADE
products   1 ──── n product_images      CASCADE
products   1 ──── 1 product_metrics     CASCADE
product_variants n ──── 1 product_images  SET NULL (deleting an image must not
                                                    delete the variant)
```

Declared to Drizzle in `src/db/schema/relations.ts`, which is what lets a
product detail read be one statement with lateral joins instead of four
sequential queries.

---

## API endpoints

### Public — no authentication, read only

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/categories` | Active categories with product counts |
| `GET` | `/api/v1/categories/:identifier` | By uuid or slug |
| `GET` | `/api/v1/products` | List, filter, sort, paginate |
| `GET` | `/api/v1/products/search?q=` | Ranked full-text search |
| `GET` | `/api/v1/products/new-arrivals?limit=` | Newest first |
| `GET` | `/api/v1/products/trending?limit=` | By computed popularity |
| `GET` | `/api/v1/products/facets` | Brands + price range for filter UI |
| `GET` | `/api/v1/products/:identifier` | Detail, by uuid or slug |

Public reads are always constrained to `status = 'active' AND is_visible`.
Drafts, hidden and archived products are invisible on every public route
including search and facets.

### Admin — `authenticate` + `requireRole("manager")`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/admin/categories` | Includes disabled |
| `POST` | `/api/v1/admin/categories` | Create |
| `GET` | `/api/v1/admin/categories/:id` | Detail |
| `PATCH` | `/api/v1/admin/categories/:id` | Update |
| `PATCH` | `/api/v1/admin/categories/:id/status` | Enable / disable |
| `PATCH` | `/api/v1/admin/categories/reorder` | Bulk sort order |
| `DELETE` | `/api/v1/admin/categories/:id` | Refused while products exist |
| `POST` | `/api/v1/admin/categories/:id/image` | multipart, field `image` |
| `DELETE` | `/api/v1/admin/categories/:id/image` | Remove image |
| `GET` | `/api/v1/admin/products` | Includes drafts / archived |
| `POST` | `/api/v1/admin/products` | Create, with variants |
| `GET` | `/api/v1/admin/products/:id` | Detail + metrics |
| `PATCH` | `/api/v1/admin/products/:id` | Update |
| `PATCH` | `/api/v1/admin/products/:id/status` | status / isVisible |
| `DELETE` | `/api/v1/admin/products/:id` | Archive (soft) |
| `DELETE` | `/api/v1/admin/products/:id?permanent=true` | Hard delete — **super_admin only** |
| `GET` | `/api/v1/admin/products/:id/variants` | List |
| `POST` | `/api/v1/admin/products/:id/variants` | Add |
| `PATCH` | `/api/v1/admin/products/:id/variants/:variantId` | Update |
| `DELETE` | `/api/v1/admin/products/:id/variants/:variantId` | Remove |
| `GET` | `/api/v1/admin/products/:id/images` | List |
| `POST` | `/api/v1/admin/products/:id/images` | multipart, field `images` |
| `PATCH` | `/api/v1/admin/products/:id/images/reorder` | Bulk order |
| `PATCH` | `/api/v1/admin/products/:id/images/:imageId/featured` | Set featured |
| `DELETE` | `/api/v1/admin/products/:id/images/:imageId` | Remove |

### Query parameters — `GET /api/v1/products`

| Parameter | Values | Notes |
|---|---|---|
| `page`, `perPage` | int | `perPage` capped at 100 |
| `q` | string | full-text + prefix |
| `categoryId` / `category` | uuid / slug | |
| `brand` | `Sony` or `Sony,Apple` | repeated keys also work |
| `tags` | `anc,5g` | array overlap |
| `minPrice`, `maxPrice` | int | rejected if inverted |
| `stockStatus` | enum | |
| `inStock` | `true` | quantity > 0 and in stock |
| `onSale` | `true` | `discount_percent > 0` |
| `sort` | see below | |
| `status` | enum | **admin route only** |

`sort`: `newest` (default), `oldest`, `price_asc`, `price_desc`, `name_asc`,
`name_desc`, `discount`, `best_selling`, `trending`.

The sort key is a closed enum mapped to column expressions — a client string is
never interpolated into `ORDER BY`. Every branch ends with `id` as a tiebreaker
so pagination cannot repeat or skip a row when the sort key ties.

---

## Validation rules

### Categories

| Field | Rule |
|---|---|
| `name` | 2–100 chars, unique case-insensitively |
| `slug` | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤120, unique; derived from name when omitted |
| `description` | ≤1000 chars |
| `icon` | `^[a-z0-9-]+$`, ≤50 |
| `sortOrder` | int 0–9999 |
| `reorder.order` | 1–200 entries, no duplicate ids |

### Products

| Field | Rule |
|---|---|
| `name` | 2–200 chars |
| `slug` | as above, ≤160, **unique** |
| `sku` | 2–64, `^[A-Za-z0-9][A-Za-z0-9._/-]*$`, **unique** |
| `brand` | 1–80 chars |
| `categoryId` | uuid; must exist (404 otherwise) |
| `price` | **integer** ≥ 0 — `1299.99` is rejected, not rounded |
| `oldPrice` | integer, **must exceed `price`** |
| `shortDescription` | ≤300 · `description` ≤20 000 |
| `specifications` | ≤60 rows, `{ label ≤80, value ≤400 }` |
| `whatsIncluded` | ≤40 entries, ≤200 chars each |
| `tags` | ≤25, `^[a-z0-9-]+$`, de-duplicated |
| `stockQuantity` | int 0–1 000 000 |
| `stockStatus` | on create only `pre_order` / `discontinued`; in/out is derived |
| `variantOptions` | ≤4 axes, ≤30 unique values each |
| `variants` | ≤100 |

Every request body is `.strict()` — unknown keys are **rejected**, not ignored,
so `{ sortIndex: 3 }` fails loudly instead of silently doing nothing. `PATCH`
with an empty body is a 422.

### Variants

Beyond the field rules, the service enforces three integrity checks that a
schema cannot express:

1. every option key is a **declared axis** on the parent product;
2. every value is in that axis's allowed list;
3. no two variants describe the **same combination** (compared order-independently).

Duplicate SKUs inside a single create payload are caught before the database,
so the error names the offending index rather than surfacing a constraint
violation.

### Uniqueness

`slug` and `sku` are guarded in two layers: a service pre-check for a readable
409 naming the conflict, and a **case-insensitive unique index** as the real
guarantee. The pre-check alone loses to two concurrent requests; the Phase 1
error handler already maps a `23505` to `ALREADY_EXISTS`.

---

## Images

Pipeline: `multer (memory) → sharp decode → validate → resize → WebP → storage → row`.

Re-encoding is a **security control**, not only compression:

- **Polyglots are neutralised** — a file crafted to be both a valid JPEG and a
  PHP payload does not survive decode → re-encode; only pixels come out.
- **EXIF is stripped** — phone photos carry GPS coordinates. Serving a
  supplier's home location from a product image is a privacy incident.
- **Decompression bombs are rejected** — `limitInputPixels` refuses oversized
  images at header-parse time, before the decode buffer is allocated.

| Rule | Value |
|---|---|
| Accepted input | JPEG, PNG, GIF, WebP, AVIF — verified by **magic bytes**, not `Content-Type` |
| Minimum | 200 × 200 |
| Maximum stored | 2000 px longest edge (never upscaled) |
| Output | WebP, quality 82 |
| Per file | `UPLOAD_MAX_FILE_SIZE_MB` (default 5 MB) |
| Per product | 12 images |

Filenames are generated from random bytes — client input never becomes a path.
The first image uploaded becomes featured automatically; deleting the featured
image promotes the next one, so a product is never left with a gallery and no
featured image.

---

## Trending

**Trending is never operator-controlled.** There is no "feature this product"
flag anywhere in the module, and the test suite asserts that no such endpoint
exists.

```
score = units_sold_recent × 25
      + ln(view_count + 1)  × 5
      + 40 × exp(−age_in_days / 21)
```

Sales dominate. Views are logarithmic so a bot or a viral link cannot swamp the
board. Freshness decays over ~3 weeks, giving new stock a chance to be seen
before it has any sales history to rank on.

The score is recomputed in **one bulk UPDATE** and read through an index —
Trending is on the homepage and must not run a decay calculation across the
catalogue on every request.

```ts
import { recomputeTrendingScores } from "./modules/products/metrics.service.js";
await recomputeTrendingScores();   // schedule hourly
```

### Integration point for the orders module

When an order reaches a state that counts as a real sale — for a
cash-on-delivery store that is `delivered`, not `placed` — it calls, once per
line item:

```ts
await recordProductSale({ productId, units: item.qty });
// and on a return or cancellation:
await reverseProductSale({ productId, units: item.qty });
```

Nothing else changes. `best_selling` sorting and the trending score already
read these columns, so both start reflecting real demand automatically — no
schema change, no code change. Until then every product scores zero on sales
and ranks on views and freshness alone.

---

## Performance

| Concern | Approach |
|---|---|
| Listing | **One** statement: LATERAL join for the featured image + `count(*) over()` for the total. No N+1, no separate COUNT |
| Detail | **One** statement — Drizzle relations compile `with` into lateral joins |
| Search | GIN index over the generated tsvector; sub-linear, not `ILIKE '%…%'` |
| Tags | GIN index, `&&` array overlap |
| Availability filters | `stock_quantity` denormalised onto the product, re-derived inside the same transaction as any variant change — no aggregate join per list query |
| Trending | Precomputed score, indexed DESC |
| Reorder (categories, gallery) | Single `UPDATE … FROM (VALUES …)`, atomic and one round trip |
| Page size | Capped at 100 — an uncapped `perPage` is unbounded database work from an anonymous request |

Composite indexes lead with `status, is_visible`, which is the predicate on
every public read, so Postgres seeks rather than scans.

---

## Testing

```bash
npm test          # 104 tests: 26 auth (Phase 1) + 78 catalog (Phase 2)
npm run verify    # typecheck + lint + test
```

`tests/catalog.test.ts` runs against a real Postgres engine (PGlite) with real
sharp image processing and the real middleware chain — nothing mocked. Coverage
includes every endpoint above, plus: auth boundaries on every write, duplicate
SKU/slug, invalid variant options, duplicate option combinations, inverted
price ranges, non-integer prices, `perPage` capping, an injection attempt
through `sort`, search terms that would break a naive `to_tsquery`, a PHP
payload disguised as a PNG, undersized images, featured-image promotion on
delete, category deletion blocked by FK, soft vs permanent delete, role
enforcement, and that recorded demand actually reorders Trending.

---

## Known limitations

- **Brand is an indexed text column, not a table.** A brands module was not in
  scope. Filtering and the facets endpoint work today; brand logos or
  descriptions would need a real table and a migration.
- **View counting is one UPDATE per product view.** Fine at current scale; at a
  few hundred views/second per product it becomes hot-row contention and should
  buffer through Redis. That changes only `recordView`.
- **`units_sold_recent` needs a scheduled reset** once orders exist, or "recent"
  drifts into "all-time". `resetRecentSalesWindow()` exists for that job.
- **No category nesting.** See the note in the schema section.
