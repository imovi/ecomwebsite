import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Product categories.
 *
 * Deliberately flat — no `parentId`. Nested categories were not requested, and
 * a self-referencing tree drags in recursive queries, breadcrumb resolution
 * and cycle prevention for every read. Adding one later is an additive
 * migration; removing it once code depends on it is not.
 *
 * The image is stored as a storage key, never a URL. Keys survive a move from
 * local disk to S3; absolute URLs baked into rows do not.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    name: text("name").notNull(),
    /** URL segment. Unique case-insensitively via the index below. */
    slug: text("slug").notNull(),
    description: text("description"),

    /** Storage key from the StorageDriver, e.g. `categories/2026/07/ab12.webp`. */
    imageKey: text("image_key"),
    /** Optional icon identifier the storefront maps to its own icon set. */
    icon: text("icon"),

    /** Manual display order. Ties broken by name for a stable result. */
    sortOrder: integer("sort_order").notNull().default(0),

    /** Disabled categories stay in the database and keep their products; they
     *  simply stop appearing publicly. */
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* Case-insensitive uniqueness enforced by the database, not by a service
       check that a concurrent request can race past. */
    uniqueIndex("categories_slug_unique_idx").on(sql`lower(${table.slug})`),
    uniqueIndex("categories_name_unique_idx").on(sql`lower(${table.name})`),
    /* Covers the public listing: `where is_active order by sort_order, name`. */
    index("categories_active_sort_idx").on(table.isActive, table.sortOrder, table.name),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
