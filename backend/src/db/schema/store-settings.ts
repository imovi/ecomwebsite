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

    /* --- Recovering incomplete checkouts --------------------------------- */
    /**
     * Below this cart value the desk cannot generate a free-delivery offer.
     *
     * 0 means no floor, which is where a shop starts. It exists because the
     * offer costs a fixed amount — one delivery charge — so on a small cart the
     * shop can end up paying most of its own margin to recover a sale worth
     * less than the courier. What that line is depends on the goods, so it is a
     * setting rather than a constant.
     */
    recoveryCouponMinCartValue: integer("recovery_coupon_min_cart_value").notNull().default(0),
    /**
     * How long an offer lives, in hours.
     *
     * The urgency is the mechanism — an offer with no deadline is a discount,
     * and a customer who can use it whenever has no reason to use it today. A
     * setting rather than a constant because a shop may want six hours during a
     * campaign or three days over Eid, and neither should need a deploy.
     */
    recoveryCouponHours: integer("recovery_coupon_hours").notNull().default(24),

    /**
     * What every new order number starts with — `GNG-` gives `GNG-10042`.
     *
     * Only NEW orders. Changing it never rewrites one already placed: the
     * number is printed on invoices, read out over the phone and typed into the
     * courier's panel, so an order that silently changed identity would break
     * every one of those at once.
     *
     * The counter behind it is a Postgres sequence and keeps running across a
     * change, so numbers stay unique whatever the prefix has been.
     */
    orderNumberPrefix: text("order_number_prefix").notNull().default("HINAR-"),

    /* --- Store identity, used on invoices -------------------------------- */
    storeName: text("store_name").notNull().default("HABU SHOP"),
    storePhone: text("store_phone").notNull().default(""),
    storeEmail: text("store_email").notNull().default(""),
    storeAddress: text("store_address").notNull().default(""),
    invoiceFooter: text("invoice_footer").notNull().default(""),

    /**
     * The half-sentence under the shop's name in the storefront footer —
     * "Gadgets, delivered." and the like.
     *
     * Also the suffix of the default page title, so a shop that has not written
     * its own `seo_title` still gets a `<title>` in its own words rather than
     * the one this app happened to ship with.
     *
     * Empty falls back to the built-in tagline.
     */
    storeTagline: text("store_tagline").notNull().default(""),

    /**
     * A free line in the footer, under the copyright.
     *
     * Deliberately open text rather than named fields: shops put a trade
     * licence number, a BIN, a "Powered by" credit or a slogan here, and
     * guessing which of those in a schema means the next shop needs a
     * migration to write the sentence it actually wants.
     */
    footerNote: text("footer_note").notNull().default(""),

    /**
     * The number behind the floating WhatsApp button, digits only with the
     * country code — `8801712345678`.
     *
     * Lived in `NEXT_PUBLIC_WHATSAPP_NUMBER` before this, which meant changing
     * the shop's contact number was a rebuild: `NEXT_PUBLIC_*` is inlined into
     * the client bundle at build time, so a restart alone would not pick it up.
     * A phone number is not a deploy.
     */
    storeWhatsapp: text("store_whatsapp").notNull().default(""),

    /**
     * Browser-tab title and the `<title>` search engines index.
     *
     * Empty falls back to `<store name> — <tagline>`, which is what every page
     * showed before this existed. Set it when the shop wants the words search
     * results lead with to be its own choice rather than a template.
     */
    seoTitle: text("seo_title").notNull().default(""),

    /** The sentence under the title in search results. Empty uses the built-in. */
    seoDescription: text("seo_description").notNull().default(""),

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

    /**
     * Storage key for the browser-tab icon. Null falls back to the bundled
     * `favicon.ico`.
     *
     * Kept separate from the logo rather than derived from it: a wordmark
     * scaled down to 32px is an unreadable smudge, and the tab icon is the
     * shop's mark at the size a customer actually sees it in a crowded row of
     * tabs. The two are different pictures for different jobs.
     */
    storeFaviconKey: text("store_favicon_key"),

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

    /* --- Reading ad spend back out of Meta -------------------------------
       Separate from the Conversions API above, and deliberately so: that token
       only needs permission to WRITE events, this one needs `ads_read` on the
       whole account, which can see every campaign's spend and results the shop
       has ever run. Two capabilities, two tokens, so revoking the reporting one
       does not stop conversions being sent. */

    /**
     * Ad account the campaigns belong to, as `act_<digits>`.
     *
     * Stored with the prefix Meta uses so it can be pasted straight from Ads
     * Manager without the shop having to know which half to keep.
     */
    metaAdAccountId: text("meta_ad_account_id").notNull().default(""),

    /**
     * `ads_read` access token. A SECRET, and a more dangerous one than the
     * Conversions API token beside it.
     *
     * Returned to the admin panel only as a masked hint, never in full — the
     * same rule the CAPI token follows, for the same reason.
     */
    metaAdsToken: text("meta_ads_token").notNull().default(""),

    /**
     * Taka per US dollar, in paisa. 12250 means ৳122.50.
     *
     * Meta bills in the ad account's currency, which for a Bangladeshi shop is
     * almost always USD, while every other figure in this system is taka. A
     * rate has to come from somewhere, and it is NOT fetched: an exchange rate
     * pulled live would silently restate last month's ad spend every time the
     * market moved, so a report an owner read on Monday would disagree with
     * itself on Friday. The shop sets what it was actually charged.
     *
     * Zero means "not set", and the reports say so rather than converting at a
     * rate nobody chose.
     */
    usdRatePaisa: integer("usd_rate_paisa").notNull().default(0),

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
     * Where order alerts go. One chat, or several separated by commas.
     *
     * Several, because a shop is rarely one person: the owner wants the alert
     * on their own phone and so does whoever is making the confirmation calls,
     * and a shared group means the owner cannot mute the desk's chatter without
     * muting the orders. Each id listed here gets its own copy of the message,
     * with its own buttons.
     *
     * Text, not an integer: channel ids are large negatives, and group ids
     * exceed what a 32-bit column holds. Storing the string Telegram gives back
     * avoids a class of silent truncation bugs.
     */
    telegramChatId: text("telegram_chat_id").notNull().default(""),

    /**
     * Where the nightly database backup is sent. Usually the owner alone.
     *
     * Deliberately NOT the alert chat. The alerts are read by whoever is
     * working the orders; the backup is every customer's name, phone and
     * address in one file, and it belongs to the person who owns the business.
     * Empty means no backup is sent.
     */
    telegramBackupChatId: text("telegram_backup_chat_id").notNull().default(""),

    telegramEnabled: boolean("telegram_enabled").notNull().default(false),

    /**
     * Shared secret Telegram echoes back on every update it delivers. A SECRET.
     *
     * The bot's webhook is a public URL that can confirm and cancel orders, and
     * the URL is not hard to guess. Telegram sends this in
     * `X-Telegram-Bot-Api-Secret-Token`, which is the only thing distinguishing
     * a real update from anyone who found the address.
     *
     * Empty means the bot is send-only: the endpoint refuses every update, which
     * is the correct reading of "interactive mode off". Never treat blank as
     * "no check needed".
     */
    telegramWebhookSecret: text("telegram_webhook_secret").notNull().default(""),

    /**
     * Telegram user ids allowed to press the buttons, comma-separated.
     *
     * Empty means "anyone in the configured chat", which is the sane default for
     * a private staff group — the chat membership IS the access list. It matters
     * when the chat is a large group: without it, every member can confirm and
     * cancel orders.
     */
    telegramAllowedUserIds: text("telegram_allowed_user_ids").notNull().default(""),

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

    /**
     * Shared secret the courier presents when it calls our webhook. A SECRET.
     *
     * This is the only thing standing between the internet and an endpoint that
     * marks orders delivered: a forged `delivered` would book revenue for a
     * parcel nobody received and quietly corrupt the profit report. Empty means
     * the webhook is closed — an unauthenticated caller is never trusted, and a
     * blank stored token must not match a blank presented one.
     */
    courierWebhookToken: text("courier_webhook_token").notNull().default(""),

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
      "store_settings_recovery_coupon_sane",
      sql`${table.recoveryCouponMinCartValue} >= 0
          and ${table.recoveryCouponHours} between 1 and 720`,
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
