import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { config } from "../../config/index.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendSuccess } from "../../core/response.js";
import { NotFoundError, TooManyRequestsError } from "../../core/errors.js";
import { getStorage } from "../../lib/storage/index.js";
import { getSettings } from "../settings/settings.service.js";
import { findOrderForCustomer, listOrderItems } from "./order.repository.js";
import { findShipmentForCustomer } from "../courier/courier.service.js";
import { bdPhoneSchema } from "./order.validation.js";

/**
 * Public storefront endpoints.
 *
 * Two things the shop genuinely needs without a login, kept apart from
 * `/checkout` because neither is part of placing an order.
 *
 * ORDER TRACKING — A REVERSED DECISION
 * ------------------------------------
 * Phase 3 shipped with no public order lookup, on the grounds that order
 * numbers are sequential and a record holds a name, phone and home address.
 * That reasoning still holds for a lookup keyed on the order number ALONE.
 *
 * It is reversed here because guest checkout leaves a customer with no other
 * way to see their own order, and the alternative is every status question
 * becoming a phone call. The exposure is closed differently instead:
 *
 *   - **Two matching secrets are required** — order number AND the phone
 *     number the order was placed with. Guessing a sequential number is easy;
 *     guessing the number plus its matching phone is not.
 *   - **Tightly rate limited per IP**, so the pair cannot be brute-forced.
 *   - **A deliberately narrow projection** — status, items, totals. No
 *     address, no internal notes, no audit log, no customer name.
 *   - **A uniform 404** whether the order is absent or the phone does not
 *     match, so the endpoint cannot be used to confirm that an order exists.
 */

/* Deliberately tighter than checkout: this endpoint is a lookup against a
   guessable identifier, so the budget assumes a human checking their order a
   handful of times, not a script walking the sequence. */
const trackRateLimit: RequestHandler = rateLimit({
  windowMs: config.rateLimit.checkout.windowMs,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `track:${ipKeyGenerator(req.ip ?? "unknown")}`,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError(Math.ceil(config.rateLimit.checkout.windowMs / 1000)));
  },
});

const trackOrderSchema = z
  .object({
    orderNumber: z.string().trim().min(3).max(60),
    phone: bdPhoneSchema,
  })
  .strict();

type TrackOrderInput = z.infer<typeof trackOrderSchema>;

/** POST /api/v1/storefront/track-order */
const trackOrder: RequestHandler = async (req, res) => {
  const { body } = validated<TrackOrderInput>(req);

  const order = await findOrderForCustomer(body.orderNumber, body.phone);

  /* One message for "no such order" and "wrong phone". Distinguishing them
     would confirm that an order number exists, which is exactly the
     enumeration this endpoint must not enable. */
  if (!order) {
    throw new NotFoundError("No order found with that order number and phone number.");
  }

  const items = await listOrderItems(order.id);
  const storage = getStorage();

  /**
   * Where the parcel is, in our own words.
   *
   * Deliberately NOT the courier's raw status: they report things like
   * `partial_delivered` and `return_pending`, in inconsistent wording that
   * changes without notice, and no shopper should have to decode that. The
   * tracking code is included so a customer who wants the courier's own detail
   * can look it up, and nothing else about the shipment is exposed — the
   * consignment id is an identifier in someone else's system.
   */
  const shipment = await findShipmentForCustomer(order.id);

  sendSuccess(res, {
    order: {
      orderNumber: order.orderNumber,
      status: order.status,
      ...(shipment
        ? {
            courier: {
              status: shipment.status,
              trackingCode: shipment.trackingCode || null,
              provider: shipment.provider,
            },
          }
        : {}),
      placedAt: order.createdAt.toISOString(),
      subtotal: order.subtotal,
      deliveryCharge: order.deliveryCharge,
      grandTotal: order.grandTotal,
      paymentMethod: order.paymentMethod,
      items: items.map((item) => ({
        productName: item.productName,
        variantLabel: item.variantLabel,
        imageUrl: item.imageKey ? storage.url(item.imageKey) : null,
        quantity: item.quantity,
      })),
    },
  });
};

/**
 * GET /api/v1/storefront/settings
 *
 * The public subset of store settings: delivery pricing and contact details.
 * The storefront shows delivery charges on product pages and a hotline in the
 * footer, and neither is a secret — but the admin settings endpoint also
 * carries order thresholds and the invoice footer, so it stays authenticated
 * and this returns only what a shopper may see.
 */
const publicSettings: RequestHandler = async (_req, res) => {
  const settings = await getSettings();

  sendSuccess(res, {
    settings: {
      delivery: {
        insideDhaka: settings.deliveryChargeInsideDhaka,
        outsideDhaka: settings.deliveryChargeOutsideDhaka,
        freeDeliveryThreshold: settings.freeDeliveryThreshold,
      },
      store: {
        name: settings.storeName,
        phone: settings.storePhone,
        email: settings.storeEmail,
        /* The header renders this instead of the wordmark when set. Public by
           nature — it is displayed on every page of the shop. */
        logoUrl: settings.storeLogoKey ? getStorage().url(settings.storeLogoKey) : null,
        logoWidth: settings.storeLogoWidth,
        logoHeight: settings.storeLogoHeight,
      },
      /**
       * Browser-side tracking configuration.
       *
       * Both values are inherently public — the pixel id is visible in the page
       * source of every site that uses one, and the domain-verification token is
       * a meta tag Meta expects to read from a public page. Publishing them here
       * is what lets the owner paste a pixel id into the dashboard and have it
       * take effect on the next page load instead of the next deploy.
       *
       * Conspicuously absent: the Conversions API token and the test event code.
       * The token is a secret and never leaves the API; the server-side Purchase
       * event is sent from here, so the storefront has no use for either.
       *
       * `pixelId` is empty unless tracking is switched on, so turning tracking
       * off in the dashboard genuinely stops the browser pixel loading rather
       * than only stopping server events.
       */
      tracking: {
        pixelId: settings.metaTrackingEnabled ? settings.metaPixelId : "",
        domainVerification: settings.metaDomainVerification,
        /* GTM is entirely public and client-side — there is no server-side
           counterpart and nothing to keep back. Gated on its own switch, not
           Meta's: the two are independent, and an owner running GA4 through GTM
           should not have to enable Facebook tracking to get it. */
        gtmContainerId: settings.googleGtmEnabled ? settings.googleGtmContainerId : "",
      },
    },
  });
};

export const storefrontRouter: Router = Router();

storefrontRouter.get("/settings", publicSettings);

storefrontRouter.post(
  "/track-order",
  trackRateLimit,
  validate({ body: trackOrderSchema }),
  trackOrder,
);
