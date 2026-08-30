/**
 * The wording of every WhatsApp message, and the placeholders it may use.
 *
 * Split out of `whatsapp.ts` so one file owns the words and another owns the
 * plumbing. The Settings screen needs the defaults, the labels, the
 * placeholders and an example of each — all of which are about the text, not
 * about building a `wa.me` link.
 *
 * A shop that has written nothing gets exactly what it got before this existed.
 */

export type TemplateKey =
  | "order"
  | "recovery"
  | "couponOffer"
  | "status.pending"
  | "status.confirmed"
  | "status.processing"
  | "status.packed"
  | "status.shipped"
  | "status.delivered"
  | "status.cancelled"
  | "status.returned";

/**
 * What the shop gets if it writes nothing.
 *
 * Bangla, because this is WhatsApp to a Bangladeshi customer — the one place in
 * the system where the reader is being spoken to rather than shown a page.
 */
export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  order: [
    "{{store}} — Order {{orderNumber}}",
    "",
    "{{status}}",
    "",
    "{{items}}",
    "",
    "ডেলিভারি চার্জসহ মোট: {{total}} (ক্যাশ অন ডেলিভারি)",
    "ঠিকানা: {{address}}",
    "",
    "{{track}}",
  ].join("\n"),

  recovery: [
    "আসসালামু আলাইকুম {{name}}",
    "আপনি আমাদের ওয়েবসাইট থেকে নিচের পণ্যটি অর্ডার করতে চেয়েছিলেন, কিন্তু চেকআউট সম্পূর্ণ হয়নি।",
    "",
    "{{items}}",
    "",
    "আনুমানিক মোট: {{total}} (ডেলিভারি চার্জ আলাদা)",
    "",
    "কোনো সমস্যা হয়েছিল, বা কিছু জানার থাকলে আমাদের বলুন — আমরা সাহায্য করব।",
    "অর্ডারটি শেষ করতে: {{link}}",
    "",
    "— {{store}}",
  ].join("\n"),

  couponOffer: [
    "আসসালামু আলাইকুম {{name}}",
    "আপনার অসম্পূর্ণ অর্ডারটির জন্য আমরা একটি ফ্রি ডেলিভারি অফার রেখেছি।",
    "",
    "চেকআউটের সময় এই কুপন কোডটি ব্যবহার করুন:",
    "{{code}}",
    "",
    "অফারটি {{expiry}} পর্যন্ত চলবে এবং একবারই ব্যবহার করা যাবে।",
    "",
    "{{items}}",
    "",
    "অর্ডারটি শেষ করতে: {{link}}",
    "",
    "— {{store}}",
  ].join("\n"),

  "status.pending": "আপনার অর্ডারটি আমরা পেয়েছি। কনফার্ম করার জন্য একটু পরেই কল করব।",
  "status.confirmed": "আপনার অর্ডারটি কনফার্ম হয়েছে। আমরা প্যাক করা শুরু করছি।",
  "status.processing": "আপনার অর্ডারটি প্রস্তুত করা হচ্ছে।",
  "status.packed": "আপনার অর্ডারটি প্যাক হয়ে গেছে। খুব শিগগিরই কুরিয়ারে দেওয়া হবে।",
  "status.shipped":
    "আপনার অর্ডারটি কুরিয়ারে পাঠিয়ে দেওয়া হয়েছে। ডেলিভারিম্যান কল করলে দয়া করে ধরবেন।",
  "status.delivered": "আপনার অর্ডারটি ডেলিভারি হয়ে গেছে। আমাদের সাথে থাকার জন্য ধন্যবাদ।",
  "status.cancelled": "আপনার অর্ডারটি বাতিল করা হয়েছে।",
  "status.returned": "আপনার অর্ডারটি ফেরত এসেছে।",
};

/** What each template may say, for the editor to list beside the box. */
export const TEMPLATE_PLACEHOLDERS: Record<TemplateKey, string[]> = {
  order: ["store", "orderNumber", "status", "items", "total", "address", "phone", "track"],
  recovery: ["store", "name", "items", "total", "link"],
  couponOffer: ["store", "name", "code", "expiry", "items", "total", "link"],
  "status.pending": ["orderNumber"],
  "status.confirmed": ["orderNumber"],
  "status.processing": ["orderNumber"],
  "status.packed": ["orderNumber"],
  "status.shipped": ["orderNumber"],
  "status.delivered": ["orderNumber"],
  "status.cancelled": ["orderNumber"],
  "status.returned": ["orderNumber"],
};

/**
 * Fills `{{name}}` gaps with real values.
 *
 * An UNKNOWN placeholder is left standing rather than blanked. A shop that
 * typed `{{costomer}}` should see `{{costomer}}` in the preview and fix it —
 * silently deleting it would send a customer a sentence with a hole in it and
 * nothing would ever say why.
 *
 * Three or more blank lines collapse to one gap, so a template whose optional
 * line resolved to nothing does not leave a chasm in the middle of the message.
 */
export function render(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (whole, key: string) =>
      key in values ? values[key]! : whole,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The wording to use for one message.
 *
 * Blank means "use the built-in", never "send nothing" — a shop that clears a
 * box is asking for the default back, not for an empty chat. That rule lives
 * here rather than in the database so it holds for a template that was saved
 * before a new message was added.
 */
export function templateFor(
  templates: Record<string, string> | null | undefined,
  key: TemplateKey,
): string {
  const written = templates?.[key];
  return written && written.trim() !== "" ? written : DEFAULT_TEMPLATES[key];
}
