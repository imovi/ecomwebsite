import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { categories } from "./categories.js";
import { productStatusEnum, stockStatusEnum } from "./catalog-enums.js";

/**
 * Postgres `tsvector`. Drizzle has no built-in mapping, and full-text search
 * is worth a five-line custom type: the alternative is `ILIKE '%term%'`, which
 * cannot use an index and degrades linearly with catalogue size.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/** One spec row, e.g. `{ label: "Display", value: "6.7\" OLED" }`. */
export interface ProductSpec {
  label: string;
  value: string;
}

/** How an axis is offered to the shopper. */
export type OptionDisplay = "text" | "image";

/**
 * A selectable variant axis, e.g. `{ name: "Storage", values: ["256GB"] }`.
 *
 * `display` decides whether the shopper picks by reading a word or by looking
 * at a picture. It is per axis rather than per product because a phone sold in
 * three colours and two storage tiers wants both at once: swatches for Colour,
 * where "Midnight Green" means nothing until you see it, and plain text for
 * Storage, where a picture of 256GB does not exist.
 *
 * Optional, and absent means text. Every product saved before this existed has
 * no such key, and must keep rendering exactly as it does today.
 */
export interface ProductOptionDefinition {
  name: string;
  values: string[];
  display?: OptionDisplay;
}

/**
 * Products.
 *
 * Money is an integer number of taka throughout — never a float. Bangladeshi
 * retail does not use paisa, and float arithmetic on prices produces totals
 * that do not reconcile.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /* --- Identity ------------------------------------------------------- */
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sku: text("sku").notNull(),

    /**
     * Optional.
     *
     * Plenty of stock has no meaningful brand — a generic cable, a phone case, a
     * mixed lot. Requiring it does not produce better data, it produces "N/A"
     * and the shop's own name sitting permanently in the brand filter and the
     * search index.
     *
     * NULL rather than empty string, so "no brand" is one value instead of two
     * that behave differently in `group by`.
     */
    brand: text("brand"),

    /* RESTRICT, not CASCADE: deleting a category must never silently delete
       its products. The service returns a 409 listing what is in the way. */
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict", onUpdate: "cascade" }),

    /* --- Content -------------------------------------------------------- */
    shortDescription: text("short_description"),
    description: text("description"),

    /* jsonb, not a child table: specs and inclusions are always read as a
       whole with their product, never queried across products, and never
       joined. A `product_specs` table would add a join to every detail read
       to buy flexibility nothing needs. */
    specifications: jsonb("specifications")
      .$type<ProductSpec[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    whatsIncluded: jsonb("whats_included")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    /** Declared variant axes. Empty for products sold as a single SKU. */
    variantOptions: jsonb("variant_options")
      .$type<ProductOptionDefinition[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    warranty: text("warranty"),

    /* --- Pricing -------------------------------------------------------- */
    /** Current selling price, in whole taka. */
    price: integer("price").notNull(),
    /** Pre-discount reference price. Null when not discounted. */
    oldPrice: integer("old_price"),

    /**
     * What the shop pays for one unit. Never shown to a customer.
     *
     * Null means "not recorded", which the profit reports surface as unknown
     * rather than treating as free. A default of 0 would report a 100% margin
     * on every product nobody has costed yet — a lie shaped like data.
     */
    costPrice: integer("cost_price"),

    /**
     * What THIS product costs to ship and to box, overriding the shop defaults.
     *
     * Null means "use the shop figure", so nothing changes until a product is
     * given its own. They exist because one shop-wide courier cost flatters a
     * phone case and hides that a laptop barely earns.
     *
     * A courier bills per PARCEL, so these are not summed: a parcel costs the
     * highest override among the products inside it. See the profit service,
     * which also splits that parcel cost back across the lines by revenue share
     * so the per-product rows still add up to the order total.
     */
    courierCostInsideDhaka: integer("courier_cost_inside_dhaka"),
    courierCostOutsideDhaka: integer("courier_cost_outside_dhaka"),
    packagingCost: integer("packaging_cost"),

    /**
     * Derived, never written.
     *
     * A stored percentage silently goes stale the first time someone edits a
     * price. A generated column keeps it correct by construction while still
     * being indexable and sortable — which a value computed in the API layer
     * would not be.
     */
    discountPercent: integer("discount_percent").generatedAlwaysAs(
      (): SQL => sql`
        case
          when old_price is not null and old_price > price
          then round(((old_price - price)::numeric * 100) / old_price)::int
          else 0
        end
      `,
    ),

    /* --- Availability --------------------------------------------------- */
    /**
     * Total sellable units.
     *
     * For a product with variants this is the denormalised sum of variant
     * stock, recalculated inside the same transaction whenever a variant
     * changes. Denormalised on purpose: filtering and sorting the catalogue by
     * availability otherwise needs an aggregate join on every list query.
     */
    stockQuantity: integer("stock_quantity").notNull().default(0),
    stockStatus: stockStatusEnum("stock_status").notNull().default("out_of_stock"),
    /** Below this, the storefront may show an urgency hint. */
    lowStockThreshold: integer("low_stock_threshold").notNull().default(5),

    /* --- Visibility ----------------------------------------------------- */
    status: productStatusEnum("status").notNull().default("draft"),
    /** Hide an active product without archiving it. Public reads require
     *  `status = 'active' and is_visible`. */
    isVisible: boolean("is_visible").notNull().default(true),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    /* --- Search --------------------------------------------------------- */
    /**
     * Weighted full-text index over the fields users actually search.
     *
     * `simple` (no stemming) for name, SKU, brand and tags: English stemming
     * mangles model numbers and brand names — "Redmi" and "redmis" are not the
     * same product, and "AirPods" must not stem to "airpod". Prose gets
     * `english`, where stemming genuinely helps.
     *
     * Tags go through `catalog_tags_to_text` rather than `array_to_string`.
     * The built-in is marked STABLE — its generic `anyarray` signature depends
     * on the element type's output function — so Postgres refuses it in a
     * generated column. For `text[]` with a fixed delimiter the result is
     * genuinely deterministic, so the migration defines a narrow IMMUTABLE
     * wrapper over exactly that case.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL => sql`
        setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(sku, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(brand, '')), 'B') ||
        setweight(to_tsvector('simple', catalog_tags_to_text(tags)), 'B') ||
        setweight(to_tsvector('english', coalesce(short_description, '')), 'C')
      `,
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* Uniqueness, case-insensitive, enforced by the database. */
    uniqueIndex("products_slug_unique_idx").on(sql`lower(${table.slug})`),
    uniqueIndex("products_sku_unique_idx").on(sql`lower(${table.sku})`),

    /* The public catalogue predicate is always
       `status = 'active' and is_visible`, so it leads every composite index
       below and lets Postgres seek rather than scan. */
    index("products_visibility_created_idx").on(
      table.status,
      table.isVisible,
      table.createdAt.desc(),
    ),
    index("products_visibility_price_idx").on(table.status, table.isVisible, table.price),
    index("products_category_idx").on(table.categoryId, table.status, table.isVisible),
    index("products_brand_idx").on(sql`lower(${table.brand})`),
    index("products_stock_status_idx").on(table.stockStatus),
    index("products_discount_idx").on(table.discountPercent),

    /* GIN over the tsvector — this is what makes search sub-linear. */
    index("products_search_idx").using("gin", table.searchVector),
    /* GIN over tags for `tags && array['usb-c']` containment filters. */
    index("products_tags_idx").using("gin", table.tags),

    check(
      "products_cost_price_non_negative",
      sql`${table.costPrice} is null or ${table.costPrice} >= 0`,
    ),
  ],
);

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
