import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Homepage banners.
 *
 * A table rather than more columns on `store_settings`, because unlike the logo
 * this is a LIST: the shop owner adds, removes and reorders slides, and each one
 * carries its own artwork and link. Modelling that as numbered settings columns
 * caps the count at whatever was guessed here and makes reordering a rewrite.
 *
 * Storage keys, not URLs — same reasoning as everywhere else: the bucket layout
 * stays an implementation detail, and a resolved URL would break the day the
 * public hostname or the storage driver changes.
 */
export const banners = pgTable(
  "banners",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Wide crop, used from the `sm` breakpoint up. Required — a banner with no
     * artwork is a blank slot on the most valuable space on the homepage.
     */
    imageKey: text("image_key").notNull(),

    /**
     * Real pixel size of the stored artwork.
     *
     * Kept so the storefront can shape the slider to the picture the shop
     * actually uploaded, instead of forcing every banner into one hardcoded
     * aspect ratio and cropping whatever does not fit.
     */
    imageWidth: integer("image_width").notNull().default(0),
    imageHeight: integer("image_height").notNull().default(0),

    /**
     * Taller crop for phones. Optional; the wide image is used when absent.
     *
     * Worth keeping as its own column rather than letting CSS crop the wide one:
     * a phone would otherwise download a 1600px-wide banner to show a letterboxed
     * strip of it, which is exactly the kind of waste that hurts on a Bangladeshi
     * mobile connection.
     */
    imageMobileKey: text("image_mobile_key"),
    imageMobileWidth: integer("image_mobile_width"),
    imageMobileHeight: integer("image_mobile_height"),

    /**
     * Describes the artwork for screen readers and for the moment the image
     * fails to load. Not rendered as visible text — the artwork carries its own
     * words.
     */
    alt: text("alt").notNull().default(""),

    /** Where tapping the banner goes. A site-relative path. */
    href: text("href").notNull().default("/"),

    sortOrder: integer("sort_order").notNull().default(0),

    /** Lets a seasonal banner be kept and switched off rather than deleted. */
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* The storefront always reads "active banners, in order" — one index serves
       that query exactly. */
    index("banners_active_order_idx").on(table.isActive, table.sortOrder),
  ],
);

export type BannerRow = typeof banners.$inferSelect;
export type NewBannerRow = typeof banners.$inferInsert;
