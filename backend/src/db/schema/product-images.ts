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
import { products } from "./products.js";

/**
 * Product images.
 *
 * The featured image is a flag on this table rather than a `featuredImageId`
 * column on `products`, because the latter creates a circular foreign key
 * (products → images → products) that makes both inserts and deletes awkward.
 * A partial unique index enforces at most one featured image per product,
 * which is stronger than any service-level check.
 *
 * Only the storage key is persisted. URLs are derived at read time by the
 * active StorageDriver, so moving from local disk to S3 does not require
 * rewriting rows.
 */
export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** StorageDriver key, e.g. `products/2026/07/9f2c….webp`. */
    storageKey: text("storage_key").notNull(),

    /** Accessibility text. Defaults to the product name when not supplied. */
    alt: text("alt"),

    /* Dimensions are captured at upload time so the storefront can reserve
       layout space and avoid cumulative layout shift without a HEAD request
       per image. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Bytes, after optimisation. */
    size: integer("size").notNull(),
    mimeType: text("mime_type").notNull(),
    /** SHA-256 of the stored bytes; used to detect duplicate uploads. */
    checksum: text("checksum").notNull(),

    isFeatured: boolean("is_featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* At most one featured image per product, enforced by the database. */
    uniqueIndex("product_images_featured_unique_idx")
      .on(table.productId)
      .where(sql`${table.isFeatured}`),
    /* Gallery reads are always "this product, in display order". */
    index("product_images_product_sort_idx").on(table.productId, table.sortOrder),
    /* Lets an orphan sweep find rows by key when reconciling storage. */
    index("product_images_storage_key_idx").on(table.storageKey),
  ],
);

export type ProductImageRow = typeof productImages.$inferSelect;
export type NewProductImageRow = typeof productImages.$inferInsert;
