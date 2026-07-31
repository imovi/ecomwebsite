import { createLogger } from "../../core/logger.js";
import { config } from "../../config/index.js";
import { getSettings } from "../settings/settings.service.js";
import type { StoreSettingsRow } from "../../db/schema/store-settings.js";
import type { OrderStatus } from "../../db/schema/order-enums.js";

/**
 * Telegram order alerts.
 *
 * On a cash-on-delivery shop the minutes between an order arriving and someone
 * ringing the customer are the difference between a confirmed sale and a
 * shopper who has moved on. There is no email or SMS transport in this system by
 * design, so a Telegram push is the cheapest way to close that gap.
 *
 * Deliberately send-only. A bot that accepts commands needs a public webhook,
 * a signature check on every update, and an authorisation model of its own —
 * a meaningful attack surface for the shop's order data. The message instead
 * carries everything needed to act (customer, phone, items, total, address) and
 * a link straight to the order in the admin panel.
 */

const log = createLogger("telegram");

const API = "https://api.telegram.org";

/** Bounded so a slow Telegram cannot pile up in-flight requests. */
const TIMEOUT_MS = 6000;

export type TelegramConfig = Pick<
  StoreSettingsRow,
  "telegramBotToken" | "telegramChatId" | "telegramEnabled"
>;

export type TelegramProblem = "disabled" | "missing_token" | "missing_chat";

export function configProblem(settings: TelegramConfig): TelegramProblem | null {
  if (settings.telegramBotToken.trim() === "") return "missing_token";
  if (settings.telegramChatId.trim() === "") return "missing_chat";
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

async function callTelegram(
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
  options: { skipEnabledCheck?: boolean } = {},
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

  try {
    const result = await callTelegram(settings.telegramBotToken, "sendMessage", {
      chat_id: settings.telegramChatId.trim(),
      text,
      parse_mode: "HTML",
      /* Order alerts carry a link to the admin panel; a link preview card for it
         would be a login page screenshot on every message. */
      link_preview_options: { is_disabled: true },
    });

    if (!result.ok) {
      log.error({ description: result.description }, "Telegram rejected the message");
      return { sent: false, reason: result.description ?? "Telegram rejected the message." };
    }

    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    log.error({ err: error }, "Telegram message not delivered");
    return { sent: false, reason };
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

export async function notifyNewOrder(
  order: OrderAlert,
  settings?: TelegramConfig,
): Promise<SendOutcome> {
  const resolved = settings ?? (await getSettings());
  return send(resolved, orderMessage(order));
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
