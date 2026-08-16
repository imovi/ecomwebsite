import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { productImages } from "./product-images.js";

/**
 * Alternate versions of a gallery photo.
 *
 * The shop sells a lamp, and every photo of it is a photo of it switched ON.
 * Those photos stay exactly where they are, in `product_images`, doing exactly
 * what they do now. This table holds the OTHER version of the same shot — the
 * same lamp, same angle, same crop, switched off — so the product page can
 * offer a toggle between them.
 *
 * WHY A TABLE OF ROWS RATHER THAN AN `off_image` COLUMN
 * ----------------------------------------------------
 * A column would answer today's question and no other. This lamp already
 * advertises three colour temperatures on its own packaging — Natural, Warm,
 * White — and the same mechanism is what a sofa bed (folded/unfolded) or a
 * before/after product needs. Each is another row here with another `stateKey`,
 * and none of them is a migration.
 *
 * The ON state is deliberately NOT stored. It is the gallery image itself, so
 * there is exactly one copy of it, it cannot drift from what the thumbnails
 * show, and a product whose feature is switched off is unchanged in every
 * respect rather than merely unchanged in effect.
 *
 * MAPPING
 * -------
 * Keyed on the image, not on its position. `sort_order` on a gallery is a
 * number an admin changes by dragging, and an index-based mapping would quietly
 * attach the unlit kitchen shot to the packaging photo the first time somebody
 * reordered the gallery. Deleting a photo takes its states with it, which is
 * what `ON DELETE CASCADE` is doing here rather than a service remembering to.
 *
 * Only the storage key is persisted; URLs are derived at read time by the
 * active StorageDriver, as everywhere else.
 */
export const productImageStates = pgTable(
  "product_image_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    productImageId: uuid("product_image_id")
      .notNull()
      .references(() => productImages.id, { onDelete: "cascade" }),

    /**
     * Machine name for this version — `off` today.
     *
     * Not an enum: an enum would put every future state behind a migration and
     * a deploy, which is the coupling this table exists to avoid.
     */
    stateKey: text("state_key").notNull(),

    /**
     * What the shopper is offered, e.g. "Off". Null falls back to the state
     * key, so a row is never unlabelled — and it is stored per state rather
     * than hardcoded in the storefront, because "Off" is the right word for a
     * lamp and the wrong one for a sofa bed.
     */
    label: text("label"),

    /** StorageDriver key, e.g. `products/2026/08/9f2c….webp`. */
    storageKey: text("storage_key").notNull(),

    /* Captured at upload, like the gallery image's own, so the storefront can
       reserve layout space and swap without shifting anything. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Bytes, after optimisation. */
    size: integer("size").notNull(),
    mimeType: text("mime_type").notNull(),
    /** SHA-256 of the stored bytes; used to detect duplicate uploads. */
    checksum: text("checksum").notNull(),

    /** Display order when a photo grows more than one alternate state. */
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* One row per state per photo. Uploading "off" twice replaces it rather
       than leaving two rows for the storefront to choose between. */
    uniqueIndex("product_image_states_image_key_unique_idx").on(
      table.productImageId,
      table.stateKey,
    ),
    /* Reads are always "every state for this photo, in display order". */
    index("product_image_states_image_sort_idx").on(table.productImageId, table.sortOrder),
    /* Lets an orphan sweep find rows by key when reconciling storage, matching
       the index `product_images` carries for the same reason. */
    index("product_image_states_storage_key_idx").on(table.storageKey),
  ],
);

export type ProductImageStateRow = typeof productImageStates.$inferSelect;
export type NewProductImageStateRow = typeof productImageStates.$inferInsert;
