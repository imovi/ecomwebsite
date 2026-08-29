import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./products.js";

/**
 * A Meta campaign the shop is running, registered so its numbers can be pulled.
 *
 * WHY THE SHOP REGISTERS IDS RATHER THAN THE API LISTING THEM
 * An ad account accumulates every campaign ever created, most of them paused,
 * duplicated or abandoned. Listing all of them would fill this screen with
 * noise on day one and cost an API call per render to keep. The shop names the
 * handful it is actually running; anything else is not the shop's business to
 * be reminded of.
 *
 * WHY A CAMPAIGN AND NOT AN AD
 * Meta's insights endpoint answers for a campaign, an ad set or a single ad,
 * and the id looks the same in all three cases. A campaign is the level a
 * budget is set at and therefore the level "was this worth it" is asked at. The
 * column takes whatever id is pasted in — an ad set id works and reports that
 * ad set — so the name is about intent rather than a constraint.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * No spend, no impressions, no results. Those live at Meta and are fetched on
 * demand; copying them into this table would create a second version of the
 * truth that goes stale the moment a campaign keeps running.
 */
export const adCampaigns = pgTable(
  "ad_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * The id as Meta knows it. Digits only.
     *
     * Stored as text rather than a number: Meta's ids are past the range a
     * 32-bit integer holds, and nothing here does arithmetic on them.
     */
    metaId: text("meta_id").notNull(),

    /** What the shop calls it. Meta's own name is fetched and shown beside it. */
    label: text("label").notNull().default(""),

    /**
     * The product this campaign is selling, when it is selling one.
     *
     * Optional, because a campaign can promote a category or the shop itself.
     * When set, the report can put Meta's spend next to what that product
     * actually delivered — which is the whole question an owner is asking.
     *
     * `set null` on delete rather than cascade: deleting a product must not
     * silently delete the record of what was spent advertising it.
     */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),

    /**
     * Paused campaigns stay registered but stop being fetched.
     *
     * Deleting is also offered. This exists for the campaign an owner switches
     * off for a month and will switch back on — re-pasting the id from Ads
     * Manager is exactly the kind of small friction that stops a report being
     * kept accurate.
     */
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /* One row per Meta id. Pasting the same campaign twice is a mistake, not a
       second campaign, and two rows would double its spend in every total. */
    uniqueIndex("ad_campaigns_meta_id_key").on(table.metaId),
    index("ad_campaigns_active_idx").on(table.isActive),
    check("ad_campaigns_meta_id_digits", sql`${table.metaId} ~ '^[0-9]{5,32}$'`),
  ],
);

export type AdCampaignRow = typeof adCampaigns.$inferSelect;
