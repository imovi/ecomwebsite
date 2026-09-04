import { formatTaka, isValidPhone, normalizePhone } from "@/lib/utils";
import type { ApiOrderDetail } from "@/lib/api/types";
import { render, templateFor, type TemplateKey } from "./whatsapp-templates";

/**
 * The shop's own wording, as stored in settings.
 *
 * Absent or blank means "use the built-in Bangla" — never "send nothing". The
 * rule lives in `whatsapp-templates.ts` beside the defaults themselves.
 */
export type Templates = Record<string, string> | null | undefined;

/**
 * Sending a customer their order update over WhatsApp.
 *
 * WHY THIS OPENS WHATSAPP INSTEAD OF SENDING BY ITSELF
 * ----------------------------------------------------
 * Sending on the shop's behalf means the WhatsApp Business Cloud API: a
 * verified business, message templates approved by Meta before they may be
 * sent, and a per-message charge. Until that exists this builds a `wa.me` link
 * — the same mechanism the storefront's floating button already uses. One tap
 * opens the chat with the message written and waiting.
 *
 * That the text lands in the input box rather than being sent is a feature
 * here, not a limitation: the shop reads it, adds "vai" or a courier's name or
 * whatever this particular customer needs, and sends. A template that cannot
 * be adjusted is a template people stop using.
 */

/**
 * WhatsApp addresses a number by country code and no plus sign.
 *
 * Orders hold `01712345678`. Handing that to `wa.me` opens a chat with a
 * number in whatever country the shop's own phone is registered to — usually
 * nobody. Returns null rather than guessing when the number is not a
 * Bangladeshi mobile, so the button can be left out instead of pointing
 * somewhere wrong.
 */
export function whatsappNumber(phone: string): string | null {
  if (!isValidPhone(phone)) return null;
  return `88${normalizePhone(phone)}`;
}

/**
 * Where the customer can look the order up themselves.
 *
 * The site address comes from `NEXT_PUBLIC_SITE_URL` rather than from
 * `@/lib/api/config`, which is marked `server-only` — importing it here would
 * pull server configuration into a browser bundle, and the build refuses. Next
 * substitutes a `NEXT_PUBLIC_` variable at build time, so this is a literal by
 * the time it reaches the browser.
 *
 * Empty when unset: a tracking line pointing at nothing is worse than none.
 */
function trackingLine(order: ApiOrderDetail): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!site) return "";
  return `নিজে দেখতে: ${site.replace(/\/+$/, "")}/track (Order ID ${order.orderNumber}, ফোন ${order.phone})`;
}

/**
 * What to say at each stage.
 *
 * Bangla, because this is WhatsApp to a Bangladeshi customer — the one place
 * on this shop where the reader is being spoken to rather than shown a page.
 * Every line the shop might want to change is right here in one function.
 */
function statusLine(order: ApiOrderDetail, templates: Templates): string {
  return render(templateFor(templates, `status.${order.status}` as TemplateKey), {
    orderNumber: order.orderNumber,
  });
}

/**
 * The whole message.
 *
 * Order number first: it is the one thing the customer needs if they reply
 * about this later. Then what has happened, then what they bought and what it
 * costs — because on cash on delivery the amount at the door is the question
 * that causes refusals when it comes as a surprise.
 */
export function orderMessage(
  order: ApiOrderDetail,
  options: { storeName: string; templates?: Templates },
): string {
  const items = order.items
    .map((item) => `• ${item.productName}${item.variantLabel ? ` (${item.variantLabel})` : ""} × ${item.quantity}`)
    .join("\n");

  const context: Record<string, string> = {
    store: options.storeName,
    orderNumber: order.orderNumber,
    customerName: order.customerName || "",
    name: order.customerName || "",
    items,
    total: formatTaka(order.grandTotal),
    address: `${order.address}, ${order.areaText}`,
    phone: order.phone,
    track: trackingLine(order),
  };

  const statusTemplate = templateFor(options.templates, `status.${order.status}` as TemplateKey);
  const status = render(statusTemplate, context);

  return render(templateFor(options.templates, "order"), {
    ...context,
    status,
  });
}

/** The link that opens WhatsApp with the message ready to send. */
export function whatsappHref(phone: string, message: string): string | null {
  const number = whatsappNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/* -------------------------------------------------------------------------- */
/* Chasing an incomplete checkout                                             */
/* -------------------------------------------------------------------------- */

/**
 * Messages for a customer who never finished.
 *
 * A different job from the order messages above, and a different tone. There is
 * no order number to quote and nothing has been agreed — this person put a
 * basket down and walked away, and the only honest reason to write to them is
 * that they might have hit a problem. So the message names what they were
 * buying, offers help, and gives them a way back. It does not chase.
 *
 * Bangla, like every other message in this file: the reader is a Bangladeshi
 * customer on WhatsApp, being spoken to rather than shown a page.
 */

export interface RecoveryLead {
  id: string;
  customerName: string | null;
  contents: { name: string; variantLabel: string | null; quantity: number }[];
  estimatedValue: number;
}

/**
 * Where the customer picks their basket back up.
 *
 * The lead id and nothing else. The page rebuilds the cart from it and opens
 * the checkout form EMPTY — no name, no phone, no address. WhatsApp messages
 * get forwarded, and a link that filled in somebody's home address would hand
 * it to whoever it was forwarded to.
 *
 * Empty when the site address is unset, and every template drops the line
 * rather than printing a broken one.
 */
export function resumeCheckoutHref(leadId: string, couponCode?: string): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!site) return "";

  const base = `${site.replace(/\/+$/, "")}/checkout/resume/${leadId}`;
  return couponCode ? `${base}?c=${encodeURIComponent(couponCode)}` : base;
}

/** "30 Aug, 3:30 PM" in the shop's own time, which is the customer's too. */
export function offerDeadline(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * The customer's name, or nothing.
 *
 * Empty rather than a stand-in: the greeting in the template reads "আসসালামু
 * আলাইকুম {{name}}", which is a complete sentence on its own when the lead
 * never got as far as typing one. Inventing "ভাই" for a stranger whose name the
 * shop does not know is a guess the shop did not ask for.
 */
function salutationName(name: string | null): string {
  return name?.trim() ?? "";
}

function basketLines(lead: RecoveryLead): string {
  return lead.contents
    .map(
      (line) =>
        `• ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ""} × ${line.quantity}`,
    )
    .join("\n");
}

/**
 * "We noticed you did not finish — can we help?"
 *
 * The estimated total is shown because on cash on delivery the amount at the
 * door is the thing customers are actually weighing up, and a message that
 * hides it invites the reply asking for it.
 */
export function recoveryMessage(
  lead: RecoveryLead,
  options: { storeName: string; templates?: Templates },
): string {
  return render(templateFor(options.templates, "recovery"), {
    store: options.storeName,
    /* The greeting has to work whether or not they got as far as typing a
       name, so `{{name}}` carries the whole salutation rather than a bare
       name that would leave "আসসালামু আলাইকুম ," on a nameless lead. */
    name: salutationName(lead.customerName),
    items: basketLines(lead),
    total: formatTaka(lead.estimatedValue),
    link: resumeCheckoutHref(lead.id),
  });
}

/**
 * "Here is free delivery, for the next 24 hours."
 *
 * The code, the deadline and the fact that it works once, in that order —
 * those are the three things a customer needs and the three things a shop gets
 * asked about afterwards if it leaves any of them out.
 */
export function couponOfferMessage(
  lead: RecoveryLead,
  coupon: { code: string; expiresAt: string },
  options: { storeName: string; templates?: Templates },
): string {
  return render(templateFor(options.templates, "couponOffer"), {
    store: options.storeName,
    name: salutationName(lead.customerName),
    code: coupon.code,
    expiry: offerDeadline(coupon.expiresAt),
    items: basketLines(lead),
    total: formatTaka(lead.estimatedValue),
    link: resumeCheckoutHref(lead.id, coupon.code),
  });
}

