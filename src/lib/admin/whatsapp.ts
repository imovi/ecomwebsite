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
