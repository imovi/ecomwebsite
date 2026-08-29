import { formatTaka, isValidPhone, normalizePhone } from "@/lib/utils";
import type { ApiOrderDetail, ApiOrderStatus } from "@/lib/api/types";

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
function statusLine(status: ApiOrderStatus): string {
  const lines: Record<ApiOrderStatus, string> = {
    pending: "আপনার অর্ডারটি আমরা পেয়েছি। কনফার্ম করার জন্য একটু পরেই কল করব।",
    confirmed: "আপনার অর্ডারটি কনফার্ম হয়েছে। আমরা প্যাক করা শুরু করছি।",
    processing: "আপনার অর্ডারটি প্রস্তুত করা হচ্ছে।",
    packed: "আপনার অর্ডারটি প্যাক হয়ে গেছে। খুব শিগগিরই কুরিয়ারে দেওয়া হবে।",
    shipped: "আপনার অর্ডারটি কুরিয়ারে পাঠিয়ে দেওয়া হয়েছে। ডেলিভারিম্যান কল করলে দয়া করে ধরবেন।",
    delivered: "আপনার অর্ডারটি ডেলিভারি হয়ে গেছে। আমাদের সাথে থাকার জন্য ধন্যবাদ।",
    cancelled: "আপনার অর্ডারটি বাতিল করা হয়েছে।",
    returned: "আপনার অর্ডারটি ফেরত এসেছে।",
  };

  return lines[status];
}

/**
 * The whole message.
 *
 * Order number first: it is the one thing the customer needs if they reply
 * about this later. Then what has happened, then what they bought and what it
 * costs — because on cash on delivery the amount at the door is the question
 * that causes refusals when it comes as a surprise.
 */
export function orderMessage(order: ApiOrderDetail, options: { storeName: string }): string {
  const items = order.items
    .map((item) => `• ${item.productName}${item.variantLabel ? ` (${item.variantLabel})` : ""} × ${item.quantity}`)
    .join("\n");

  return [
    `${options.storeName} — Order ${order.orderNumber}`,
    "",
    statusLine(order.status),
    "",
    items,
    "",
    `ডেলিভারি চার্জসহ মোট: ${formatTaka(order.grandTotal)} (ক্যাশ অন ডেলিভারি)`,
    `ঠিকানা: ${order.address}, ${order.areaText}`,
    "",
    trackingLine(order),
  ].join("\n");
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

/** Greeting that works whether or not they got as far as typing a name. */
function salutation(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? `আসসালামু আলাইকুম ${trimmed},` : "আসসালামু আলাইকুম,";
}

function basketLines(lead: RecoveryLead): string {
  return lead.contents
    .map(
      (line) =>
        `• ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ""} × ${line.quantity}`,
    )
    .join("\n");
}

/** Drops the blank rows left by an absent link, so nothing prints as a gap. */
function joinLines(lines: string[]): string {
  return lines
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n")
    .trim();
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
  options: { storeName: string },
): string {
  const link = resumeCheckoutHref(lead.id);

  return joinLines([
    salutation(lead.customerName),
    "আপনি আমাদের ওয়েবসাইট থেকে নিচের পণ্যটি অর্ডার করতে চেয়েছিলেন, কিন্তু চেকআউট সম্পূর্ণ হয়নি।",
    "",
    basketLines(lead),
    "",
    `আনুমানিক মোট: ${formatTaka(lead.estimatedValue)} (ডেলিভারি চার্জ আলাদা)`,
    "",
    "কোনো সমস্যা হয়েছিল, বা কিছু জানার থাকলে আমাদের বলুন — আমরা সাহায্য করব।",
    link ? `অর্ডারটি শেষ করতে: ${link}` : "",
    "",
    `— ${options.storeName}`,
  ]);
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
  options: { storeName: string },
): string {
  const link = resumeCheckoutHref(lead.id, coupon.code);

  return joinLines([
    salutation(lead.customerName),
    "আপনার অসম্পূর্ণ অর্ডারটির জন্য আমরা একটি ফ্রি ডেলিভারি অফার রেখেছি।",
    "",
    "চেকআউটের সময় এই কুপন কোডটি ব্যবহার করুন:",
    coupon.code,
    "",
    `অফারটি ${offerDeadline(coupon.expiresAt)} পর্যন্ত চলবে এবং একবারই ব্যবহার করা যাবে।`,
    "",
    basketLines(lead),
    "",
    link ? `অর্ডারটি শেষ করতে: ${link}` : "",
    "",
    `— ${options.storeName}`,
  ]);
}
