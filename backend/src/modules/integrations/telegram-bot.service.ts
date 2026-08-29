import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { products } from "../../db/schema/products.js";
import { createLogger } from "../../core/logger.js";
import { getSettings } from "../settings/settings.service.js";
import * as orderService from "../orders/order.service.js";
import type { Actor } from "../orders/order-event.repository.js";
import * as telegram from "./telegram.service.js";

/**
 * The inbound half of the Telegram bot: button taps and commands.
 *
 * Everything here can change the shop's data from a public URL, so the guard is
 * the first thing in the file and every path goes through it.
 *
 * THREE CHECKS, ALL OF WHICH MUST HOLD
 *  1. Telegram's secret header. The webhook address is public and guessable;
 *     this is the only thing that proves an update came from Telegram at all.
 *  2. The chat id matches the one configured. Without it, anyone who found the
 *     bot could message it directly and act on this shop's orders.
 *  3. An optional allow-list of user ids, for when the chat is a large group and
 *     "in the group" should not mean "can cancel orders".
 *
 * WHY CANCEL IS TWO TAPS
 * Confirm is safe to get wrong — it can be walked back. Cancelling releases
 * stock and is recorded permanently, and the button sits directly beside
 * Confirm on a phone screen. So the first tap only asks.
 */

const log = createLogger("telegram:bot");

/* -------------------------------------------------------------------------- */
/* Authorisation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Checks the secret Telegram echoes back.
 *
 * Constant-time, and a blank stored secret is always a refusal — interactive
 * mode being off must close the endpoint, not open it to callers who send no
 * header at all.
 */
export async function verifySecret(presented: string | null): Promise<boolean> {
  const settings = await getSettings();
  const expected = settings.telegramWebhookSecret;

  if (expected === "" || !presented) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    /* Comparing b against itself keeps the timing flat rather than returning
       early on a length mismatch, which would leak the length. */
    timingSafeEqual(b, b);
    return false;
  }

  return timingSafeEqual(a, b);
}

/**
 * Any of the chats the alerts are sent to may press the buttons.
 *
 * Membership of the list, not equality with one id: the moment alerts go to
 * more than one person, an equality check leaves everyone but the first
 * unable to act on the message they were just sent — the buttons would appear
 * and do nothing, which is worse than not sending them the alert at all.
 */
function isAllowedChat(settings: telegram.TelegramConfig, chatId: string): boolean {
  return telegram.alertChatIds(settings).includes(chatId);
}

function isAllowedUser(settings: telegram.TelegramConfig, userId: string): boolean {
  const list = settings.telegramAllowedUserIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

  /* Empty list means the chat membership is the access list, which is the right
     default for a private staff group. */
  return list.length === 0 || list.includes(userId);
}

/* -------------------------------------------------------------------------- */
/* Update shapes                                                              */
/* -------------------------------------------------------------------------- */

export interface TelegramUpdate {
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number };
    from?: { id: number; first_name?: string; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number; first_name?: string; username?: string };
    message?: { message_id: number; chat: { id: number } };
  };
}

function personName(from: { first_name?: string; username?: string } | undefined): string {
  return from?.first_name ?? from?.username ?? "Telegram";
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

const taka = (amount: number) => `৳${amount.toLocaleString("en-US")}`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The shop's calendar day, as `YYYY-MM-DD`.
 *
 * Dhaka, not the server's clock — "today" in a summary has to mean the day the
 * person reading it is living in.
 */
const SHOP_OFFSET_MS = 6 * 60 * 60_000;

function shopDay(at: Date = new Date()): string {
  return new Date(at.getTime() + SHOP_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instants bounding a Dhaka day, for comparing against stored timestamps. */
function dayBounds(day: string): { from: Date; to: Date } {
  return {
    from: new Date(`${day}T00:00:00+06:00`),
    to: new Date(`${day}T23:59:59.999+06:00`),
  };
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

const HELP = [
  "🤖 <b>What I can do</b>",
  "",
  "/today — today's orders and takings",
  "/pending — orders still waiting for a call",
  "/order GNG-10001 — look up one order",
  "/stock — products low or out of stock",
  "/help — this list",
  "",
  "<i>New orders arrive here with Confirm and Cancel buttons.</i>",
].join("\n");

async function todayReport(): Promise<string> {
  const db = getDb();
  const day = shopDay();
  const { from, to } = dayBounds(day);

  const placed = await db
    .select({
      status: orders.status,
      total: sql<number>`count(*)`.mapWith(Number),
      value: sql<number>`coalesce(sum(${orders.grandTotal}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(and(gte(orders.createdAt, from), lte(orders.createdAt, to)))
    .groupBy(orders.status);

  const delivered = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      value: sql<number>`coalesce(sum(${orders.grandTotal}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(and(gte(orders.deliveredAt, from), lte(orders.deliveredAt, to)));

  const totalPlaced = placed.reduce((sum, row) => sum + row.total, 0);
  const placedValue = placed.reduce((sum, row) => sum + row.value, 0);
  const pending = placed.find((row) => row.status === "pending")?.total ?? 0;

  return [
    `📊 <b>Today — ${escapeHtml(day)}</b>`,
    "",
    `New orders: <b>${totalPlaced}</b> — ${taka(placedValue)}`,
    `Delivered today: <b>${delivered[0]?.total ?? 0}</b> — ${taka(delivered[0]?.value ?? 0)}`,
    "",
    pending > 0
      ? `⚠️ <b>${pending}</b> waiting for a call. Send /pending`
      : "✅ Nothing waiting for a call.",
  ].join("\n");
}

async function pendingReport(): Promise<string> {
  const rows = await getDb()
    .select({
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      phone: orders.phone,
      grandTotal: orders.grandTotal,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.status, "pending"))
    .orderBy(desc(orders.createdAt))
    .limit(10);

  if (rows.length === 0) return "✅ <b>Nothing waiting for a call.</b>";

  return [
    `📞 <b>${rows.length} waiting for a call</b>`,
    "",
    ...rows.map(
      (row) =>
        `<b>${escapeHtml(row.orderNumber)}</b> — ${escapeHtml(row.customerName)}\n` +
        `<a href="tel:${escapeHtml(row.phone)}">${escapeHtml(row.phone)}</a> · ${taka(row.grandTotal)}`,
    ),
  ].join("\n\n");
}

async function orderReport(orderNumber: string): Promise<string> {
  const rows = await getDb()
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber.toUpperCase()))
    .limit(1);

  const order = rows[0];
  if (!order) return `Nothing found for <b>${escapeHtml(orderNumber)}</b>.`;

  return [
    `<b>${escapeHtml(order.orderNumber)}</b> — ${escapeHtml(order.status)}`,
    "",
    `${escapeHtml(order.customerName)}`,
    `<a href="tel:${escapeHtml(order.phone)}">${escapeHtml(order.phone)}</a>`,
    `📍 ${escapeHtml(order.address)}, ${escapeHtml(order.areaText)}`,
    "",
    `Collect on delivery: <b>${taka(order.grandTotal)}</b>`,
  ].join("\n");
}

async function stockReport(): Promise<string> {
  const rows = await getDb()
    .select({
      name: products.name,
      stockQuantity: products.stockQuantity,
      threshold: products.lowStockThreshold,
    })
    .from(products)
    .where(
      and(
        eq(products.status, "active"),
        sql`${products.stockQuantity} <= ${products.lowStockThreshold}`,
      ),
    )
    .orderBy(products.stockQuantity)
    .limit(15);

  if (rows.length === 0) return "✅ <b>Every live product has stock.</b>";

  return [
    `📦 <b>${rows.length} product${rows.length === 1 ? "" : "s"} low or out</b>`,
    "",
    ...rows.map(
      (row) =>
        `${escapeHtml(row.name)} — <b>${row.stockQuantity}</b> left` +
        (row.stockQuantity === 0 ? " ⛔" : ""),
    ),
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Handling                                                                   */
/* -------------------------------------------------------------------------- */

async function handleCommand(
  settings: telegram.TelegramConfig,
  chatId: string,
  text: string,
): Promise<void> {
  /* `/today@shopbot` is what Telegram sends in a group, so the bot's own
     username has to be stripped before matching. */
  const [rawCommand = "", ...rest] = text.trim().split(/\s+/);
  const command = rawCommand.split("@")[0]?.toLowerCase() ?? "";

  let reply: string;

  switch (command) {
    case "/start":
    case "/help":
      reply = HELP;
      break;
    case "/today":
      reply = await todayReport();
      break;
    case "/pending":
      reply = await pendingReport();
      break;
    case "/order":
      reply = rest[0]
        ? await orderReport(rest[0])
        : "Give me an order number, like <code>/order GNG-10001</code>";
      break;
    case "/stock":
      reply = await stockReport();
      break;
    default:
      /* Silent on anything that is not a command: this bot lives in a group
         where people also talk to each other, and replying to every message
         would make it unusable. */
      if (!command.startsWith("/")) return;
      reply = `I do not know <code>${escapeHtml(command)}</code>. Send /help`;
  }

  await telegram.sendToChat(settings, chatId, reply);
}

/**
 * Applies a button tap.
 *
 * Every exit path answers the callback, including the failures — Telegram spins
 * the button until it is answered, and a spinner that never stops reads as the
 * shop being broken.
 */
async function handleCallback(
  settings: telegram.TelegramConfig,
  query: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const data = query.data ?? "";
  const chatId = query.message ? String(query.message.chat.id) : "";
  const messageId = query.message?.message_id;

  const actor: Actor = { name: `${personName(query.from)} (Telegram)` };

  const [action = "", orderNumber = ""] = data.split(":");
  if (orderNumber === "") {
    await telegram.answerCallback(settings, query.id, "That button is no longer valid.");
    return;
  }

  const rows = await getDb()
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);

  const order = rows[0];
  if (!order) {
    await telegram.answerCallback(settings, query.id, `${orderNumber} no longer exists.`, true);
    return;
  }

  try {
    switch (action) {
      case "c": {
        await orderService.updateStatus(order.id, { status: "confirmed" }, actor);
        await telegram.answerCallback(settings, query.id, `${orderNumber} confirmed ✅`);
        if (chatId && messageId !== undefined) {
          await telegram.editMessageButtons(settings, chatId, messageId, [
            [{ text: `✅ Confirmed by ${personName(query.from)}`, callbackData: "noop" }],
          ]);
        }
        break;
      }

      case "x": {
        /* First tap only asks. Cancelling releases stock and is permanent, and
           this button sits a thumb's width from Confirm. */
        await telegram.answerCallback(settings, query.id, "Tap again to confirm cancelling.");
        if (chatId && messageId !== undefined) {
          await telegram.editMessageButtons(settings, chatId, messageId, [
            [
              { text: "⚠️ Yes, cancel it", callbackData: `X:${orderNumber}` },
              { text: "↩️ Keep", callbackData: `k:${orderNumber}` },
            ],
          ]);
        }
        break;
      }

      case "X": {
        await orderService.cancel(
          order.id,
          { reason: `Cancelled from Telegram by ${personName(query.from)}` },
          actor,
        );
        await telegram.answerCallback(settings, query.id, `${orderNumber} cancelled`);
        if (chatId && messageId !== undefined) {
          await telegram.editMessageButtons(settings, chatId, messageId, [
            [{ text: `❌ Cancelled by ${personName(query.from)}`, callbackData: "noop" }],
          ]);
        }
        break;
      }

      case "k": {
        await telegram.answerCallback(settings, query.id, "Kept.");
        if (chatId && messageId !== undefined) {
          await telegram.editMessageButtons(
            settings,
            chatId,
            messageId,
            telegram.orderButtons(orderNumber),
          );
        }
        break;
      }

      default:
        await telegram.answerCallback(settings, query.id, "");
    }
  } catch (error) {
    /* The order service refuses illegal transitions — confirming something
       already shipped, for instance. That is a sentence worth showing rather
       than a silent failure. */
    const reason = error instanceof Error ? error.message : "Could not do that.";
    log.warn({ err: error, orderNumber, action }, "Telegram action refused");
    await telegram.answerCallback(settings, query.id, reason, true);
  }
}

/**
 * Entry point for one Telegram update.
 *
 * Never throws: an error answered to Telegram means a retry, and retrying a
 * button tap that already changed an order would apply it twice.
 */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const settings = await getSettings();

  try {
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = query.message ? String(query.message.chat.id) : "";

      if (!isAllowedChat(settings, chatId)) {
        log.warn({ chatId }, "Telegram callback from an unexpected chat — ignored");
        await telegram.answerCallback(settings, query.id, "Not allowed here.", true);
        return;
      }

      if (!isAllowedUser(settings, String(query.from.id))) {
        log.warn({ userId: query.from.id }, "Telegram callback from a user not on the list");
        await telegram.answerCallback(settings, query.id, "You are not allowed to do that.", true);
        return;
      }

      await handleCallback(settings, query);
      return;
    }

    if (update.message?.text) {
      const chatId = String(update.message.chat.id);

      if (!isAllowedChat(settings, chatId)) {
        /* Silent. Answering tells whoever found the bot that it is alive and
           which chat it belongs to. */
        log.warn({ chatId }, "Telegram message from an unexpected chat — ignored");
        return;
      }

      if (!isAllowedUser(settings, String(update.message.from?.id ?? ""))) {
        log.warn({ userId: update.message.from?.id }, "Telegram message from a user not on the list");
        return;
      }

      await handleCommand(settings, chatId, update.message.text);
    }
  } catch (error) {
    log.error({ err: error }, "Telegram update could not be handled");
  }
}
