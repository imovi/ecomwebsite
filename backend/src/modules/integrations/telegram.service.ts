import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "../../core/logger.js";
import { config } from "../../config/index.js";
import { getDb } from "../../db/client.js";
import { getSettings } from "../settings/settings.service.js";
import { storeSettings, type StoreSettingsRow } from "../../db/schema/store-settings.js";
import type { OrderStatus } from "../../db/schema/order-enums.js";

/**
 * Telegram order alerts.
 *
 * On a cash-on-delivery shop the minutes between an order arriving and someone
 * ringing the customer are the difference between a confirmed sale and a
 * shopper who has moved on. There is no email or SMS transport in this system by
 * design, so a Telegram push is the cheapest way to close that gap.
 *
 * Every message carries what is needed to act — customer, phone, items, total,
 * address — plus a link to the order, so the alert is useful on its own even
 * when the interactive half is switched off.
 *
 * INTERACTIVE MODE
 * The bot also accepts button taps and a handful of commands, which needs a
 * public webhook that can change orders. That is guarded three ways, and all
 * three have to hold: Telegram's own secret header, the chat id matching the
 * one configured here, and — optionally — an allow-list of user ids. See
 * `telegram-bot.service.ts`, which owns everything inbound; this file stays
 * responsible for what goes out.
 */

const log = createLogger("telegram");

const API = "https://api.telegram.org";

/** Bounded so a slow Telegram cannot pile up in-flight requests. */
const TIMEOUT_MS = 6000;

export type TelegramConfig = Pick<
  StoreSettingsRow,
  | "telegramBotToken"
  | "telegramChatId"
  | "telegramBackupChatId"
  | "telegramEnabled"
  | "telegramWebhookSecret"
  | "telegramAllowedUserIds"
>;

export type TelegramProblem = "disabled" | "missing_token" | "missing_chat";

/**
 * The chats an alert goes to.
 *
 * Commas, because that is what someone types when asked for "the chat ids".
 * Duplicates are dropped rather than delivered twice — the same id pasted into
 * the field twice is a slip, and two identical alerts with two sets of Confirm
 * buttons is a way to confirm an order twice.
 */
export function alertChatIds(settings: TelegramConfig): string[] {
  return [
    ...new Set(
      settings.telegramChatId
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== ""),
    ),
  ];
}

export function configProblem(settings: TelegramConfig): TelegramProblem | null {
  if (settings.telegramBotToken.trim() === "") return "missing_token";
  if (alertChatIds(settings).length === 0) return "missing_chat";
  if (!settings.telegramEnabled) return "disabled";
  return null;
}

export interface SendOutcome {
  sent: boolean;
  reason?: string;
}

/**
 * Escapes text for Telegram's HTML parse mode.
 *
 * Customer names and addresses are free text typed by strangers. Without this, a
 * name containing `<` silently breaks the whole message — Telegram rejects the
 * entity and the alert never arrives, which is precisely when it matters most.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * One button on a message.
 *
 * `callback_data` is capped at 64 bytes by Telegram and is echoed back verbatim
 * when tapped, so it carries an action and an id and nothing else — never a
 * secret, since anyone who can read the message can read it.
 */
export interface InlineButton {
  text: string;
  callbackData: string;
}

export async function callTelegram(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  const response = await fetch(`${API}/bot${token.trim()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  /* Telegram answers 200 with `ok: false` for application errors and 4xx for
     protocol ones, so both have to be read. */
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
    result?: unknown;
  } | null;

  if (!body) {
    return { ok: false, description: `Telegram returned a non-JSON response (${response.status}).` };
  }

  return {
    ok: body.ok === true,
    ...(body.description ? { description: body.description } : {}),
    ...(body.result !== undefined ? { result: body.result } : {}),
  };
}

async function send(
  settings: TelegramConfig,
  text: string,
  options: { skipEnabledCheck?: boolean; buttons?: InlineButton[][] } = {},
): Promise<SendOutcome> {
  const problem = configProblem(settings);

  /* The test button needs to reach Telegram before the switch is on — that is
     the whole point of testing first. */
  if (problem && !(options.skipEnabledCheck && problem === "disabled")) {
    return {
      sent: false,
      reason:
        problem === "disabled"
          ? "Telegram alerts are turned off in settings."
          : problem === "missing_token"
            ? "No bot token is configured."
            : "No chat is configured.",
    };
  }

  const chats = alertChatIds(settings);

  const payload = {
    text,
    parse_mode: "HTML" as const,
    /* Order alerts carry a link to the admin panel; a link preview card for it
       would be a login page screenshot on every message. */
    link_preview_options: { is_disabled: true },
    ...(options.buttons
      ? {
          reply_markup: {
            inline_keyboard: options.buttons.map((row) =>
              row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
            ),
          },
        }
      : {}),
  };

  /* Sent one chat at a time, and one failing does not stop the others.
     A staff member who has blocked the bot, or a chat id typed with a digit
     missing, must not silently cost the owner their order alert — which is
     exactly what a single request for all recipients would do. */
  const failures: string[] = [];
  let delivered = 0;

  for (const chatId of chats) {
    try {
      const result = await callTelegram(settings.telegramBotToken, "sendMessage", {
        chat_id: chatId,
        ...payload,
      });

      if (result.ok) delivered += 1;
      else {
        log.error({ chatId, description: result.description }, "Telegram rejected the message");
        failures.push(`${chatId}: ${result.description ?? "rejected"}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Network error";
      log.error({ err: error, chatId }, "Telegram message not delivered");
      failures.push(`${chatId}: ${reason}`);
    }
  }

  /* Reported as sent if it reached anybody. The alert's job is to put the order
     in front of a human; one unreachable phone has not stopped that, and
     failing the whole send would retry against the chats that already got it. */
  if (delivered > 0) {
    return failures.length > 0 ? { sent: true, reason: failures.join("; ") } : { sent: true };
  }

  return { sent: false, reason: failures.join("; ") || "No chat accepted the message." };
}

/**
 * Sends a file to the backup chat.
 *
 * `sendDocument` rather than a message, and multipart rather than JSON, because
 * this is the one call that carries bytes. Telegram's own limit for a bot
 * upload is 50 MB; a gzipped dump of a shop this size is measured in kilobytes,
 * and the guard below exists for the day that stops being true rather than for
 * today.
 *
 * Deliberately its own destination. The alert chats are read by whoever is
 * working the orders; this file is every customer's name, phone and address.
 */
export async function sendBackupDocument(
  settings: TelegramConfig,
  file: { name: string; bytes: Uint8Array },
  caption: string,
): Promise<SendOutcome> {
  const token = settings.telegramBotToken.trim();
  const chatId = settings.telegramBackupChatId.trim();

  if (token === "") return { sent: false, reason: "No bot token is configured." };
  if (chatId === "") return { sent: false, reason: "No backup chat is configured." };

  const LIMIT = 45 * 1024 * 1024;
  if (file.bytes.byteLength > LIMIT) {
    return {
      sent: false,
      reason: `The backup is ${Math.round(file.bytes.byteLength / 1024 / 1024)} MB, past what a bot may upload. Move to the off-server repository backup.`,
    };
  }

  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  /* Copied into a fresh ArrayBuffer rather than passed as the view: a
     Uint8Array over a pooled Node buffer can carry a byteOffset, and Blob would
     then read from the start of the pool instead of the start of the dump. */
  const bytes = new Uint8Array(file.bytes.byteLength);
  bytes.set(file.bytes);
  form.set("document", new Blob([bytes.buffer], { type: "application/gzip" }), file.name);

  try {
    const response = await fetch(`${API}/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
      /* Longer than a message: this one is an upload. */
      signal: AbortSignal.timeout(120_000),
    });

    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;

    if (!response.ok || !body?.ok) {
      const reason = body?.description ?? `Telegram answered ${response.status}.`;
      log.error({ reason }, "Backup not delivered to Telegram");
      return { sent: false, reason };
    }

    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    log.error({ err: error }, "Backup not delivered to Telegram");
    return { sent: false, reason };
  }
}

/**
 * Sends to a specific chat, bypassing the configured destination.
 *
 * Used only to answer a command in the chat it was typed in. Everything the bot
 * says on its own initiative still goes to the configured chat.
 */
export async function sendToChat(
  settings: TelegramConfig,
  chatId: string,
  text: string,
  buttons?: InlineButton[][],
): Promise<SendOutcome> {
  if (settings.telegramBotToken.trim() === "") {
    return { sent: false, reason: "No bot token is configured." };
  }

  try {
    const result = await callTelegram(settings.telegramBotToken, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(buttons
        ? {
            reply_markup: {
              inline_keyboard: buttons.map((row) =>
                row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
              ),
            },
          }
        : {}),
    });

    return result.ok
      ? { sent: true }
      : { sent: false, reason: result.description ?? "Telegram rejected the message." };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Network error" };
  }
}

/**
 * Replaces a message's buttons after one is pressed.
 *
 * Without this a Confirm button stays tappable forever, and the second tap gets
 * an error about an order that is already confirmed — which reads as the bot
 * being broken rather than the work already being done.
 */
export async function editMessageButtons(
  settings: TelegramConfig,
  chatId: string,
  messageId: number,
  buttons: InlineButton[][],
): Promise<void> {
  try {
    await callTelegram(settings.telegramBotToken, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: buttons.map((row) =>
          row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
        ),
      },
    });
  } catch (error) {
    /* Cosmetic. The action itself already succeeded, and failing here must not
       turn a confirmed order into an error the operator sees. */
    log.warn({ err: error }, "Could not update the message buttons");
  }
}

/**
 * Answers a button tap.
 *
 * Telegram shows a spinner on the button until this is called, so it has to
 * happen on every path including failures — an unanswered tap looks like the
 * bot hung.
 */
export async function answerCallback(
  settings: TelegramConfig,
  callbackId: string,
  text: string,
  isAlert = false,
): Promise<void> {
  try {
    await callTelegram(settings.telegramBotToken, "answerCallbackQuery", {
      callback_query_id: callbackId,
      text: text.slice(0, 200),
      show_alert: isAlert,
    });
  } catch (error) {
    log.warn({ err: error }, "Could not answer the callback query");
  }
}

/* -------------------------------------------------------------------------- */
/* Webhook registration                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Points Telegram at our webhook and hands it the secret to echo back.
 *
 * `allowed_updates` is narrowed to what the bot actually handles. The default
 * is every update type, which would mean this shop's server being woken for
 * every edited message and poll answer in a busy staff group.
 */
export async function registerWebhook(
  settings: TelegramConfig,
  url: string,
  secret: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const result = await callTelegram(settings.telegramBotToken, "setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      /* Anything queued while the bot was send-only is stale by definition. */
      drop_pending_updates: true,
    });

    return result.ok
      ? { ok: true }
      : { ok: false, reason: result.description ?? "Telegram refused the webhook." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Network error" };
  }
}

export async function removeWebhook(
  settings: TelegramConfig,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const result = await callTelegram(settings.telegramBotToken, "deleteWebhook", {
      drop_pending_updates: true,
    });
    return result.ok
      ? { ok: true }
      : { ok: false, reason: result.description ?? "Telegram refused." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Network error" };
  }
}

/**
 * Turns the interactive bot on.
 *
 * Telegram is told first and the secret is only stored once it accepted. The
 * other order leaves the two sides disagreeing about what the secret is, and
 * every real update would then be refused by our own check — a bot that looks
 * connected and silently ignores every tap.
 */
export async function enableBot(): Promise<{ ok: boolean; detail: string }> {
  const settings = await getSettings();

  if (settings.telegramBotToken.trim() === "") {
    return { ok: false, detail: "Add the bot token first." };
  }
  if (settings.telegramChatId.trim() === "") {
    return { ok: false, detail: "Choose the chat first — the bot only answers there." };
  }

  const secret = randomBytes(32).toString("base64url");
  const url = `${config.server.apiUrl}/api/v1/webhooks/telegram`;

  const registered = await registerWebhook(settings, url, secret);
  if (!registered.ok) {
    return {
      ok: false,
      detail:
        registered.reason ??
        "Telegram refused the webhook. The address must be reachable over https.",
    };
  }

  await getDb()
    .update(storeSettings)
    .set({ telegramWebhookSecret: secret, updatedAt: sql`now()` })
    .where(eq(storeSettings.id, 1));

  log.info({ url }, "Telegram bot enabled");
  return { ok: true, detail: "Buttons and commands are on." };
}

/**
 * Turns it off.
 *
 * The stored secret is cleared even if Telegram could not be reached: a blank
 * secret makes our endpoint refuse everything, so the bot is genuinely off from
 * this side regardless of what Telegram still believes.
 */
export async function disableBot(): Promise<{ ok: boolean; detail: string }> {
  const settings = await getSettings();

  const removed = await removeWebhook(settings);

  await getDb()
    .update(storeSettings)
    .set({ telegramWebhookSecret: "", updatedAt: sql`now()` })
    .where(eq(storeSettings.id, 1));

  log.info("Telegram bot disabled");

  return removed.ok
    ? { ok: true, detail: "Buttons and commands are off." }
    : {
        ok: true,
        detail: `Turned off here. Telegram said: ${removed.reason ?? "unreachable"}.`,
      };
}

/** What Telegram believes about our webhook — the first thing to check. */
export async function webhookInfo(
  settings: TelegramConfig,
): Promise<{ url: string; pendingUpdates: number; lastError: string } | null> {
  try {
    const result = await callTelegram(settings.telegramBotToken, "getWebhookInfo", {});
    if (!result.ok) return null;

    const info = result.result as {
      url?: string;
      pending_update_count?: number;
      last_error_message?: string;
    };

    return {
      url: info.url ?? "",
      pendingUpdates: info.pending_update_count ?? 0,
      lastError: info.last_error_message ?? "",
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

const taka = (amount: number) => `৳${amount.toLocaleString("en-US")}`;

export interface OrderAlert {
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
  deliveryZone: "inside_dhaka" | "outside_dhaka";
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  items: { name: string; variantLabel: string | null; quantity: number; lineTotal: number }[];
  note?: string | null;
}

function orderMessage(order: OrderAlert): string {
  const lines = order.items
    .map(
      (item) =>
        `• ${escapeHtml(item.name)}${item.variantLabel ? ` (${escapeHtml(item.variantLabel)})` : ""}` +
        ` × ${item.quantity} — ${taka(item.lineTotal)}`,
    )
    .join("\n");

  const zone = order.deliveryZone === "inside_dhaka" ? "Inside Dhaka" : "Outside Dhaka";
  const adminUrl = `${config.marketing.storefrontUrl}/admin/orders/${order.orderNumber}`;

  return [
    `🛒 <b>New order ${escapeHtml(order.orderNumber)}</b>`,
    "",
    `<b>${escapeHtml(order.customerName)}</b>`,
    /* `tel:` makes the number tappable in the Telegram client, which is the
       single most-used action on this message. */
    `📞 <a href="tel:${escapeHtml(order.phone)}">${escapeHtml(order.phone)}</a>`,
    `📍 ${escapeHtml(order.address)}, ${escapeHtml(order.areaText)} (${zone})`,
    "",
    lines,
    "",
    `Subtotal: ${taka(order.subtotal)}`,
    `Delivery: ${taka(order.deliveryCharge)}`,
    `<b>Collect on delivery: ${taka(order.grandTotal)}</b>`,
    ...(order.note ? ["", `📝 ${escapeHtml(order.note)}`] : []),
    "",
    `<a href="${adminUrl}">Open in admin</a>`,
  ].join("\n");
}

/**
 * The buttons on a new-order alert.
 *
 * Only offered when the bot can actually receive the tap. A button that does
 * nothing is worse than no button: it reads as the shop being broken at the
 * exact moment somebody is trying to work quickly.
 *
 * The order NUMBER rather than its uuid, because `callback_data` is capped at
 * 64 bytes and the number is what a human reads back over the phone anyway.
 */
export function orderButtons(orderNumber: string): InlineButton[][] {
  return [
    [
      { text: "✅ Confirm", callbackData: `c:${orderNumber}` },
      { text: "❌ Cancel", callbackData: `x:${orderNumber}` },
    ],
  ];
}

export async function notifyNewOrder(
  order: OrderAlert,
  settings?: TelegramConfig,
): Promise<SendOutcome> {
  const resolved = settings ?? (await getSettings());

  /* Interactive mode off means send-only, so no buttons — see orderButtons. */
  const interactive = resolved.telegramWebhookSecret.trim() !== "";

  return send(resolved, orderMessage(order), {
    ...(interactive ? { buttons: orderButtons(order.orderNumber) } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* Courier, leads and the daily summary                                       */
/* -------------------------------------------------------------------------- */

/**
 * A parcel reached its end state.
 *
 * Only the two outcomes that change what the shop owes or is owed. A push for
 * every scan at every depot would bury the new-order alert, which is the one
 * message somebody is genuinely waiting on.
 */
export async function notifyParcel(
  input: {
    orderNumber: string;
    customerName: string;
    status: "delivered" | "returned";
    courierStatus: string;
    grandTotal: number;
  },
  settings?: TelegramConfig,
): Promise<SendOutcome> {
  const resolved = settings ?? (await getSettings());

  const delivered = input.status === "delivered";
  const text = [
    `${delivered ? "📦" : "↩️"} <b>${escapeHtml(input.orderNumber)} — ${
      delivered ? "Delivered" : "Returned"
    }</b>`,
    "",
    `${escapeHtml(input.customerName)} · ${taka(input.grandTotal)}`,
    delivered
      ? "Collected by the courier. It now counts in your profit figures."
      : "The parcel came back. Its cost is counted as a loss.",
    "",
    `<i>Courier said: ${escapeHtml(input.courierStatus)}</i>`,
  ].join("\n");

  return send(resolved, text);
}

/**
 * Somebody left a phone number and did not finish.
 *
 * The highest-value message in this file after the order alert: they already
 * chose a product, so a call usually turns it into a sale.
 */
export async function notifyAbandonedCheckout(
  input: {
    phone: string;
    customerName: string | null;
    itemSummary: string;
    value: number;
  },
  settings?: TelegramConfig,
): Promise<SendOutcome> {
  const resolved = settings ?? (await getSettings());

  const text = [
    "🕐 <b>Someone left without finishing</b>",
    "",
    input.customerName ? `<b>${escapeHtml(input.customerName)}</b>` : "<i>No name given</i>",
    `📞 <a href="tel:${escapeHtml(input.phone)}">${escapeHtml(input.phone)}</a>`,
    "",
    escapeHtml(input.itemSummary),
    `Worth about ${taka(input.value)}`,
    "",
    "<i>They picked a product and stopped. A call usually finishes it.</i>",
  ].join("\n");

  return send(resolved, text);
}

export interface DailySummary {
  day: string;
  ordersPlaced: number;
  delivered: number;
  revenue: number;
  pending: number;
  cancelled: number;
  returned: number;
}

/** One message a day: what happened, and what still needs a call. */
export async function notifyDailySummary(
  summary: DailySummary,
  settings?: TelegramConfig,
): Promise<SendOutcome> {
  const resolved = settings ?? (await getSettings());

  const text = [
    `📊 <b>${escapeHtml(summary.day)}</b>`,
    "",
    `New orders: <b>${summary.ordersPlaced}</b>`,
    `Delivered: <b>${summary.delivered}</b> — ${taka(summary.revenue)}`,
    ...(summary.cancelled > 0 ? [`Cancelled: ${summary.cancelled}`] : []),
    ...(summary.returned > 0 ? [`Returned: ${summary.returned}`] : []),
    "",
    summary.pending > 0
      ? `⚠️ <b>${summary.pending}</b> still waiting for a call.`
      : "✅ Nothing waiting for a call.",
  ].join("\n");

  return send(resolved, text);
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pending confirmation",
  confirmed: "Confirmed",
  processing: "Processing",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

export async function notifyStatusChange(
  input: {
    orderNumber: string;
    customerName: string;
    previousStatus: OrderStatus;
    newStatus: OrderStatus;
    changedBy: string;
  },
  settings?: TelegramConfig,
): Promise<SendOutcome> {
  const resolved = settings ?? (await getSettings());

  /* Only the outcomes worth interrupting someone for. A push on every step of
     the packing workflow trains people to ignore the channel, which costs the
     new-order alert its value. */
  if (input.newStatus !== "cancelled" && input.newStatus !== "returned") {
    return { sent: false, reason: "Status is not one that raises an alert." };
  }

  const icon = input.newStatus === "cancelled" ? "❌" : "↩️";
  const text = [
    `${icon} <b>${escapeHtml(input.orderNumber)} — ${STATUS_LABEL[input.newStatus]}</b>`,
    "",
    `Customer: ${escapeHtml(input.customerName)}`,
    `Was: ${STATUS_LABEL[input.previousStatus]}`,
    `By: ${escapeHtml(input.changedBy)}`,
  ].join("\n");

  return send(resolved, text);
}

/** Sends a harmless message so the dashboard can prove the wiring works. */
export async function sendTestMessage(settings?: TelegramConfig): Promise<SendOutcome> {
  const resolved = settings ?? (await getSettings());

  return send(
    resolved,
    [
      "✅ <b>gng is connected</b>",
      "",
      "Order alerts will arrive in this chat.",
    ].join("\n"),
    /* Deliberately allowed before the switch is flipped: verify, then enable. */
    { skipEnabledCheck: true },
  );
}

/**
 * Finds the chat id for whoever last messaged the bot.
 *
 * Getting this is the fiddly part of Telegram setup — the id is not shown
 * anywhere in the app, and the usual advice is to message a third-party bot,
 * which means handing the shop's chat to a stranger. This reads it from the
 * shop's own bot instead.
 */
export async function discoverChats(
  settings?: TelegramConfig,
): Promise<{ ok: boolean; reason?: string; chats: { id: string; title: string }[] }> {
  const resolved = settings ?? (await getSettings());

  if (resolved.telegramBotToken.trim() === "") {
    return { ok: false, reason: "Add the bot token first.", chats: [] };
  }

  try {
    const result = await callTelegram(resolved.telegramBotToken, "getUpdates", { limit: 20 });

    if (!result.ok) {
      return { ok: false, reason: result.description ?? "Telegram rejected the request.", chats: [] };
    }

    /* A chat is a person, a group or a channel, and Telegram names each one
       differently — `first_name` for a person, `title` for the other two. */
    interface Chat {
      id?: number;
      title?: string;
      username?: string;
      first_name?: string;
    }
    interface Update {
      message?: { chat?: Chat };
      channel_post?: { chat?: Chat };
    }

    const seen = new Map<string, string>();
    for (const update of (result.result ?? []) as Update[]) {
      const chat = update.message?.chat ?? update.channel_post?.chat;
      if (chat?.id === undefined) continue;

      const id = String(chat.id);
      const title =
        chat.title ?? chat.username ?? chat.first_name ?? (Number(id) < 0 ? "Group" : "Direct chat");
      if (!seen.has(id)) seen.set(id, title);
    }

    return {
      ok: true,
      chats: [...seen].map(([id, title]) => ({ id, title })),
      ...(seen.size === 0
        ? { reason: "No messages yet. Send any message to your bot, then try again." }
        : {}),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Network error",
      chats: [],
    };
  }
}
