import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Store settings — a single row.
 *
 * Delivery charges must be configurable rather than compiled in, and the
 * invoice needs the store's own details. Both live here.
 *
 * Modelled as one typed row rather than a key/value table: every consumer
 * wants the whole set at once, the columns are known and few, and a typed row
 * means a missing setting is a compile error instead of an `undefined` that
 * surfaces as a zero delivery charge in production. The `CHECK (id = 1)`
 * constraint makes "single row" a database guarantee, not a convention.
 *
 * Money is an integer number of taka, consistent with the rest of the system.
 */
export const storeSettings = pgTable(
  "store_settings",
  {
    id: smallint("id").primaryKey().default(1),

    /* --- Delivery pricing ------------------------------------------------ */
    deliveryChargeInsideDhaka: integer("delivery_charge_inside_dhaka").notNull().default(80),
    deliveryChargeOutsideDhaka: integer("delivery_charge_outside_dhaka").notNull().default(130),
    /** Order value at or above which delivery is free. 0 disables the rule. */
    freeDeliveryThreshold: integer("free_delivery_threshold").notNull().default(0),

    /* --- Ordering rules -------------------------------------------------- */
    /** Reject orders below this subtotal. 0 disables the rule. */
    minimumOrderValue: integer("minimum_order_value").notNull().default(0),
    /** Cap on units of any single line, to blunt joke orders on a COD store. */
    maxQuantityPerItem: integer("max_quantity_per_item").notNull().default(10),

    /* --- Store identity, used on invoices -------------------------------- */
    storeName: text("store_name").notNull().default("gng"),
    storePhone: text("store_phone").notNull().default(""),
    storeEmail: text("store_email").notNull().default(""),
    storeAddress: text("store_address").notNull().default(""),
    invoiceFooter: text("invoice_footer").notNull().default(""),

    /**
     * Storage key for the shop's logo. Null means "use the wordmark".
     *
     * A key rather than a URL: the bucket layout is an implementation detail, and
     * storing a resolved URL would break every logo the day the storage driver or
     * the public hostname changes.
     */
    storeLogoKey: text("store_logo_key"),

    /**
     * Real pixel size of the logo, so the header can reserve the right box for
     * it rather than assuming one shape. Null when no logo is set.
     */
    storeLogoWidth: integer("store_logo_width"),
    storeLogoHeight: integer("store_logo_height"),

    /* --- Meta / Facebook tracking ---------------------------------------
       Stored here rather than in environment variables so the shop owner can
       connect their own pixel from the dashboard without a rebuild. The pixel
       id is baked into the client bundle when it comes from `NEXT_PUBLIC_*`,
       which makes "paste your pixel id" a deploy rather than a form.

       Empty string means "not configured" throughout — consistent with the
       other text columns here, and it keeps the column NOT NULL. */
    metaPixelId: text("meta_pixel_id").notNull().default(""),

    /**
     * Conversions API access token. A SECRET.
     *
     * It lives in the backend and is sent to Meta from the backend, so it never
     * has to travel to the storefront or the browser. The admin API returns only
     * a masked hint of it, never the value — a token that can be read back is a
     * token that leaks through any screen-share or XSS on the admin panel.
     */
    metaCapiToken: text("meta_capi_token").notNull().default(""),

    /** Routes events to Meta's Test Events console instead of optimisation. */
    metaTestEventCode: text("meta_test_event_code").notNull().default(""),

    /** Content of the `facebook-domain-verification` meta tag. */
    metaDomainVerification: text("meta_domain_verification").notNull().default(""),

    /**
     * Master switch, separate from "is a pixel id present".
     *
     * Lets the owner stop sending events without deleting their configuration —
     * needed when pausing campaigns, and needed to avoid teaching a live ad
     * account from test orders while the shop is still being set up.
     */
    metaTrackingEnabled: boolean("meta_tracking_enabled").notNull().default(false),

    /* --- Google Tag Manager ----------------------------------------------
       A container id (`GTM-XXXXXXX`), not a GA4 measurement id. GTM is the
       container the owner then puts GA4, Google Ads conversions and remarketing
       tags inside — so this one field replaces a growing list of per-vendor id
       columns, and adding a new vendor becomes a change in Google's UI rather
       than a schema migration here.

       No token or secret exists for GTM: everything it needs is public and
       client-side, which is why there is nothing here to mask. */
    googleGtmContainerId: text("google_gtm_container_id").notNull().default(""),

    /** Separate from "is a container id present", same reasoning as Meta. */
    googleGtmEnabled: boolean("google_gtm_enabled").notNull().default(false),

    /* --- Telegram order alerts -------------------------------------------
       A COD shop confirms orders by phone, so the delay between an order
       arriving and someone seeing it is money. A Telegram push is the cheapest
       way to close that gap without building email or SMS delivery. */

    /**
     * Bot token from @BotFather. A SECRET — anyone holding it can post as the
     * shop's bot, so it is write-only through the API, like the Meta token.
     */
    telegramBotToken: text("telegram_bot_token").notNull().default(""),

    /**
     * Where messages go: a personal chat, a group, or a channel.
     *
     * Text, not an integer: channel ids are large negatives, and group ids
     * exceed what a 32-bit column holds. Storing the string Telegram gives back
     * avoids a class of silent truncation bugs.
     */
    telegramChatId: text("telegram_chat_id").notNull().default(""),

    telegramEnabled: boolean("telegram_enabled").notNull().default(false),

    /* --- Google Sheets export --------------------------------------------
       One row appended per order, so the shop can filter, share and reconcile
       in a tool it already knows. Deliberately one-way: the sheet is a report,
       never a source of truth the database reads back. */

    /**
     * Service-account JSON key. A SECRET, and a particularly sensitive one —
     * it carries a private key. Write-only through the API.
     */
    googleSheetsCredentials: text("google_sheets_credentials").notNull().default(""),

    /** The long id from the sheet's URL. */
    googleSheetsId: text("google_sheets_id").notNull().default(""),

    /** Tab name to append to. Sheets calls this the sheet within the file. */
    googleSheetsTab: text("google_sheets_tab").notNull().default("Orders"),

    googleSheetsEnabled: boolean("google_sheets_enabled").notNull().default(false),

    /* --- What an order costs the shop ------------------------------------
       Applied to every order rather than to a product, so the profit reports
       need no per-order data entry. */

    /**
     * What the COURIER charges the shop, which is not what the customer is
     * charged. The gap between them is invisible today and is often negative:
     * free delivery over a threshold is paid for out of margin.
     */
    courierCostInsideDhaka: integer("courier_cost_inside_dhaka").notNull().default(0),
    courierCostOutsideDhaka: integer("courier_cost_outside_dhaka").notNull().default(0),

    /** Box, tape, bubble wrap, printed invoice — one figure per parcel. */
    packagingCostPerOrder: integer("packaging_cost_per_order").notNull().default(0),

    /** What a refused or returned parcel costs to get back. */
    returnCostPerOrder: integer("return_cost_per_order").notNull().default(0),

    /* --- Courier ----------------------------------------------------------
       Handing parcels over by API instead of typing them into the courier's
       own panel, and reading the delivery status back. */

    /** `steadfast`, `pathao`, or empty for none. */
    courierProvider: text("courier_provider").notNull().default(""),

    /**
     * SECRETS. Write-only through the API, like every other credential here.
     *
     * Steadfast uses key + secret. Pathao uses client id + client secret, which
     * occupy the same two columns rather than adding provider-specific ones —
     * only one courier is configured at a time.
     */
    courierApiKey: text("courier_api_key").notNull().default(""),
    courierApiSecret: text("courier_api_secret").notNull().default(""),

    /** Pathao's merchant store id. Unused by Steadfast. */
    courierStoreId: text("courier_store_id").notNull().default(""),

    /** Lets sandbox and live be swapped without a deploy. */
    courierBaseUrl: text("courier_base_url").notNull().default(""),

    courierEnabled: boolean("courier_enabled").notNull().default(false),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check("store_settings_single_row", sql`${table.id} = 1`),
    check(
      "store_settings_non_negative",
      sql`${table.deliveryChargeInsideDhaka} >= 0
          and ${table.deliveryChargeOutsideDhaka} >= 0
          and ${table.freeDeliveryThreshold} >= 0
          and ${table.minimumOrderValue} >= 0
          and ${table.maxQuantityPerItem} > 0`,
    ),
    check(
      "store_settings_courier_provider_known",
      sql`${table.courierProvider} in ('', 'steadfast', 'pathao')`,
    ),
    check(
      "store_settings_costs_non_negative",
      sql`${table.courierCostInsideDhaka} >= 0
          and ${table.courierCostOutsideDhaka} >= 0
          and ${table.packagingCostPerOrder} >= 0
          and ${table.returnCostPerOrder} >= 0`,
    ),
  ],
);

export type StoreSettingsRow = typeof storeSettings.$inferSelect;
export type NewStoreSettingsRow = typeof storeSettings.$inferInsert;
