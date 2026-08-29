import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { uploadImage } from "../../middleware/upload.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendSuccess } from "../../core/response.js";
import { BadRequestError } from "../../core/errors.js";
import { safeString } from "../../lib/validation/schemas.js";
import * as service from "./settings.service.js";

/**
 * Store settings.
 *
 * Reading is restricted to authenticated staff: delivery pricing is public
 * information in effect, but the store's internal contact details and order
 * thresholds are not, and the storefront gets its delivery charges from the
 * checkout quote endpoint rather than from here.
 *
 * Writing requires `admin` — a manager can run the catalogue and the order
 * queue, but changing what the store charges for delivery is a commercial
 * decision.
 */

const money = z.number().int().min(0).max(100_000);

const updateSettingsSchema = z
  .object({
    delivery: z
      .object({
        insideDhaka: money.optional(),
        outsideDhaka: money.optional(),
        /** 0 disables free delivery entirely. */
        freeDeliveryThreshold: money.optional(),
      })
      .strict()
      .optional(),
    /**
     * What new order numbers start with.
     *
     * Letters, digits and a dash only. A space or a slash would break the
     * moment the number went into a URL or a courier's own form, and the shop
     * would find out from a customer rather than from a validation message.
     * Empty is allowed and means "just the number".
     */
    orderNumberPrefix: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(10)
          .regex(
            /^[A-Za-z0-9-]+$/,
            "Use letters, numbers and dashes only — no spaces or slashes.",
          ),
      ])
      .optional(),

    ordering: z
      .object({
        minimumOrderValue: money.optional(),
        maxQuantityPerItem: z.number().int().min(1).max(1000).optional(),
      })
      .strict()
      .optional(),
    /* Courier hand-off. The key and secret are write-only, like every other
       credential here: omitted keeps the stored value, `null` clears it. */
    courier: z
      .object({
        provider: z.enum(["", "steadfast", "pathao"]).optional(),
        apiKey: z.union([z.null(), z.string().trim().min(6).max(300)]).optional(),
        apiSecret: z.union([z.null(), z.string().trim().min(6).max(300)]).optional(),
        /* Pathao's merchant store id — digits, and only meaningful for them. */
        storeId: z
          .union([z.literal(""), z.string().trim().regex(/^\d{1,20}$/, "A store id is a number.")])
          .optional(),
        /* Lets sandbox and live be swapped without a deploy. Must be https so a
           credential is never posted over plain http. */
        baseUrl: z
          .union([
            z.literal(""),
            z
              .string()
              .trim()
              .max(200)
              .refine(
                (value) => value.startsWith("https://"),
                "The courier API address must start with https://",
              ),
          ])
          .optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),

    /* What an order costs the shop. Feeds the profit reports and nothing the
       customer ever sees. */
    costs: z
      .object({
        courierInsideDhaka: money.optional(),
        courierOutsideDhaka: money.optional(),
        packagingPerOrder: money.optional(),
        returnPerOrder: money.optional(),
      })
      .strict()
      .optional(),
    store: z
      .object({
        name: safeString({ min: 1, max: 120 }).optional(),
        phone: safeString({ max: 40 }).optional(),
        email: z.union([z.literal(""), z.email()]).optional(),
        address: safeString({ max: 400 }).optional(),
        invoiceFooter: safeString({ max: 400 }).optional(),

        /* Accepted loosely and normalised to digits in the service — an owner
           will type "+880 1712-345678" and should not be told off for it. */
        whatsapp: z
          .union([
            z.literal(""),
            z
              .string()
              .trim()
              .max(30)
              .refine(
                (value) => value.replace(/\D/g, "").length >= 10,
                "Include the country code, like 8801712345678.",
              ),
          ])
          .optional(),

        /* Footer copy. One short line each — the tagline sits beside the shop
           name and the note under the copyright, so a paragraph in either
           wraps the footer into something nobody designed. */
        tagline: safeString({ max: 120 }).optional(),
        footerNote: safeString({ max: 200 }).optional(),

        /* Empty means "use the built-in", so the shop can clear an override
           and get the default back rather than being stuck with a blank tab. */
        seoTitle: safeString({ max: 70 }).optional(),
        seoDescription: safeString({ max: 200 }).optional(),
      })
      .strict()
      .optional(),

    tracking: z
      .object({
        /* Meta pixel ids are numeric strings, 15-16 digits today. Validated by
           shape rather than exact length so a future change in Meta's id format
           does not lock the owner out of their own settings. Empty clears it. */
        pixelId: z
          .union([z.literal(""), z.string().trim().regex(/^\d{10,20}$/, "A pixel id is 10–20 digits.")])
          .optional(),

        /* Meta's own console labels these TEST#####. Kept permissive — the
           format is theirs to change. */
        testEventCode: z
          .union([z.literal(""), safeString({ min: 1, max: 40 })])
          .optional(),

        /* The `content` value of the facebook-domain-verification meta tag: a
           hex-ish token. Restricted to URL-safe characters because it is
           rendered into an HTML attribute. */
        domainVerification: z
          .union([
            z.literal(""),
            z
              .string()
              .trim()
              .regex(/^[A-Za-z0-9_-]{8,120}$/, "That does not look like a verification token."),
          ])
          .optional(),

        enabled: z.boolean().optional(),

        /**
         * Write-only. Omit to keep the stored token, `null` to clear it.
         *
         * The API never returns this value, so the dashboard cannot round-trip
         * it — which is exactly why omission has to mean "unchanged" rather than
         * "clear".
         */
        capiToken: z
          .union([z.null(), z.string().trim().min(20).max(500)])
          .optional(),

        /* Google Tag Manager container id.
           Upper-cased on the way in: Google prints it as `GTM-ABC1234`, people
           paste it lower-cased, and the snippet is case-sensitive — so a silently
           lower-cased id loads nothing and gives no error to debug. Length is
           left loose because the suffix length is Google's to change. */
        gtmContainerId: z
          .union([
            z.literal(""),
            z
              .string()
              .trim()
              .toUpperCase()
              .regex(
                /^GTM-[A-Z0-9]{4,12}$/,
                "A container id looks like GTM-ABC1234.",
              ),
          ])
          .optional(),

        gtmEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),

    /* Reading spend back out of Meta. A different token from the Conversions
       API one above, with a wider permission, so it is entered and revoked
       separately. */
    ads: z
      .object({
        /* Accepted with or without the `act_` prefix Ads Manager prints, and
           stored with it — the shop should not have to know which half to
           keep. An empty string clears it. */
        adAccountId: z
          .union([
            z.literal(""),
            z
              .string()
              .trim()
              .regex(/^(act_)?[0-9]{5,32}$/, "An ad account id looks like act_1234567890.")
              .transform((value) => (value.startsWith("act_") ? value : `act_${value}`)),
          ])
          .optional(),

        /* Omitted leaves the stored token alone; `null` clears it. The panel
           only ever holds a masked hint and so can never re-send the real one. */
        token: z.union([z.null(), z.string().trim().min(20).max(500)]).optional(),

        /* Taka per dollar, entered as a decimal and stored as paisa. Bounded
           either side of anything the rate has ever plausibly been: a slipped
           decimal point that turns ৳122 into ৳12,200 would silently multiply
           every ad figure in the shop by a hundred. */
        usdRate: z
          .number()
          .min(0)
          .max(1000)
          .optional(),
      })
      .strict()
      .optional(),

    integrations: z
      .object({
        telegram: z
          .object({
            /* Write-only. Omitted keeps the stored token, `null` clears it —
               the dashboard is never given the value to re-send.
               Shape is `<digits>:<35-ish chars>` as issued by @BotFather. */
            botToken: z
              .union([
                z.null(),
                z
                  .string()
                  .trim()
                  .regex(
                    /^\d{6,15}:[A-Za-z0-9_-]{20,60}$/,
                    "That does not look like a bot token from @BotFather.",
                  ),
              ])
              .optional(),

            /**
             * Where order alerts go. One chat id, or several with commas.
             *
             * Signed integers as text: channels are large negatives. Spaces
             * around the commas are tolerated and stripped — people type a
             * list the way they would write one, and rejecting "123, 456" for
             * a space would be a needless argument with the owner.
             */
            chatId: z
              .union([
                z.literal(""),
                z
                  .string()
                  .trim()
                  .transform((value) =>
                    value
                      .split(",")
                      .map((id) => id.trim())
                      .filter((id) => id !== "")
                      .join(","),
                  )
                  .refine(
                    (value) => value.split(",").every((id) => /^-?\d{1,20}$/.test(id)),
                    "Each chat id is a number. Separate several with commas.",
                  ),
              ])
              .optional(),

            /* One chat, not a list: the database is not a thing to broadcast. */
            backupChatId: z
              .union([
                z.literal(""),
                z.string().trim().regex(/^-?\d{1,20}$/, "A chat id is a number."),
              ])
              .optional(),

            enabled: z.boolean().optional(),

            /**
             * Who may press the buttons, as comma-separated Telegram user ids.
             *
             * Empty means anyone in the configured chat, which is right for a
             * private staff group. Not a secret — these are public ids — so
             * unlike the token it is returned and editable.
             */
            allowedUserIds: z
              .union([
                z.literal(""),
                z
                  .string()
                  .trim()
                  .max(300)
                  .regex(
                    /^\d{1,20}(\s*,\s*\d{1,20})*$/,
                    "Use Telegram user ids — numbers, separated by commas.",
                  ),
              ])
              .optional(),
          })
          .strict()
          .optional(),

        googleSheets: z
          .object({
            /* The whole downloaded JSON key. Bounded generously — a real key is
               about 2.3 KB — and validated properly by the service, which can
               give a far better message than a regex can. */
            credentials: z
              .union([z.null(), z.string().trim().min(50).max(20_000)])
              .optional(),

            /* The id from the sheet URL: /spreadsheets/d/<id>/edit */
            sheetId: z
              .union([
                z.literal(""),
                z
                  .string()
                  .trim()
                  .regex(/^[A-Za-z0-9_-]{20,100}$/, "Paste the id from the sheet's web address."),
              ])
              .optional(),

            tab: safeString({ min: 1, max: 100 }).optional(),
            enabled: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one settings group to update.",
  });

type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;

const read: RequestHandler = async (_req, res) => {
  sendSuccess(res, { settings: await service.getSettingsDto() });
};

const update: RequestHandler = async (req, res) => {
  const { body } = validated<UpdateSettingsBody>(req);

  /* The panel sends a rate the way a person writes one — 122.5 taka to the
     dollar — and the column stores paisa, because every other money value in
     this system is an integer and a float here would round differently on
     every report that touched it. Converted once, at the boundary. */
  const { ads, ...rest } = body;
  const patch: service.UpdateSettingsInput = {
    ...rest,
    ...(ads
      ? {
          ads: {
            ...(ads.adAccountId !== undefined ? { adAccountId: ads.adAccountId } : {}),
            ...(ads.token !== undefined ? { token: ads.token } : {}),
            ...(ads.usdRate !== undefined
              ? { usdRatePaisa: Math.round(ads.usdRate * 100) }
              : {}),
          },
        }
      : {}),
  };

  sendSuccess(res, { settings: await service.updateSettings(patch) });
};

/** POST /api/v1/admin/settings/logo — multipart, field name `logo`. */
const uploadLogo: RequestHandler = async (req, res) => {
  if (!req.file) {
    throw new BadRequestError('No file received. Send one image in the "logo" field.');
  }

  const settings = await service.setLogo({
    buffer: req.file.buffer,
    originalname: req.file.originalname,
  });
  sendSuccess(res, { settings });
};

const deleteLogo: RequestHandler = async (_req, res) => {
  sendSuccess(res, { settings: await service.removeLogo() });
};

/** POST /api/v1/admin/settings/favicon — multipart, field name `favicon`. */
const uploadFavicon: RequestHandler = async (req, res) => {
  if (!req.file) {
    throw new BadRequestError('No file received. Send one image in the "favicon" field.');
  }

  const settings = await service.setFavicon({
    buffer: req.file.buffer,
    originalname: req.file.originalname,
  });
  sendSuccess(res, { settings });
};

const deleteFavicon: RequestHandler = async (_req, res) => {
  sendSuccess(res, { settings: await service.removeFavicon() });
};

export const settingsAdminRouter: Router = Router();

settingsAdminRouter.use(authenticate);

settingsAdminRouter.get("/", requireRole("manager"), read);
settingsAdminRouter.patch(
  "/",
  requireRole("admin"),
  validate({ body: updateSettingsSchema }),
  update,
);

/* Branding is a commercial decision like delivery pricing, so it matches the
   `admin` floor used for settings writes rather than the `manager` read. */
settingsAdminRouter.post("/logo", requireRole("admin"), uploadImage("logo"), uploadLogo);
settingsAdminRouter.delete("/logo", requireRole("admin"), deleteLogo);
settingsAdminRouter.post(
  "/favicon",
  requireRole("admin"),
  uploadImage("favicon"),
  uploadFavicon,
);
settingsAdminRouter.delete("/favicon", requireRole("admin"), deleteFavicon);
