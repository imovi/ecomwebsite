import { createLogger } from "../../core/logger.js";
import { isConfigured as mailConfigured, sendMail } from "../../lib/mail/mailer.js";
import { getSettings } from "../settings/settings.service.js";
import { sendToChat } from "../integrations/telegram.service.js";

/**
 * Getting a reset code to the owner.
 *
 * Two channels, both tried, neither trusted.
 *
 * Email is the channel people expect, and it is the one most likely to fail
 * quietly: a shop's own VPS sending a six-digit number to Gmail is close to the
 * textbook shape of a phishing message, and it lands in spam often enough that
 * betting account recovery on it alone would be careless. Telegram is already
 * running on this shop and already delivering order alerts, so its delivery is
 * proven daily — but it needs the phone.
 *
 * So the code goes to both, and the caller is told what actually happened. The
 * one thing this must never do is report success when nobody was told.
 */

const log = createLogger("auth:reset-delivery");

export interface DeliveryResult {
  email: boolean;
  telegram: boolean;
  /** True when the code reached nobody. The only outcome worth failing on. */
  nowhere: boolean;
}

/** A channel that threw where it promised not to counts as not delivered. */
function settled(result: PromiseSettledResult<boolean>, channel: string): boolean {
  if (result.status === "fulfilled") return result.value;
  log.error({ err: result.reason, channel }, "Reset code channel threw unexpectedly");
  return false;
}

/**
 * Whether this deployment can deliver a code at all.
 *
 * Deliberately says nothing about any account — the answer is identical for a
 * real admin address, a made-up one, and an empty string, because it depends
 * only on this server's configuration. That is what makes it safe to tell the
 * caller, while "does this address belong to an admin" never can be.
 *
 * It matters most on a shop that has neither channel set up. Telegram is
 * configured FROM the panel the owner is now locked out of, so a fresh install
 * can sit in a state where every reset request answers encouragingly and no
 * code can possibly arrive. Without this check, nothing on the outside ever
 * says so.
 */
export async function isDeliveryConfigured(): Promise<boolean> {
  if (mailConfigured()) return true;

  try {
    const settings = await getSettings();
    return settings.telegramBotToken.trim() !== "" && settings.telegramChatId.trim() !== "";
  } catch (error) {
    /* The database is unreachable, which is not the same as "not configured".
       Claim it is configured so the caller answers normally: a database outage
       should surface as the 500 it is, from the code path that actually needs
       the database, not as a misleading "reset is not available here". */
    log.error({ err: error }, "Could not read settings while checking delivery channels");
    return true;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function deliverResetCode(input: {
  email: string;
  name: string;
  code: string;
  expiresInMinutes: number;
}): Promise<DeliveryResult> {
  const { code, expiresInMinutes } = input;

  /* Both sends at once. Sequentially, a mail server that takes thirty seconds
     to time out would hold up the Telegram message that was going to arrive
     anyway.
     `allSettled`, not `all`: both helpers are written never to throw, but that
     is a convention spread across three files rather than a guarantee. With
     `all`, one unexpected throw would discard the other channel's result — so
     a Telegram message that HAD been delivered would be reported as a total
     failure. Settling each independently makes that impossible by
     construction. */
  const [emailResult, telegramResult] = await Promise.allSettled([
    sendEmail(input),
    sendTelegram({ code, expiresInMinutes }),
  ]);

  const email = settled(emailResult, "email");
  const telegram = settled(telegramResult, "telegram");

  const result = { email, telegram, nowhere: !email && !telegram };

  if (result.nowhere) {
    log.error("Password reset code could not be delivered on any channel");
  } else {
    log.info({ email, telegram }, "Password reset code sent");
  }

  return result;
}

async function sendEmail(input: {
  email: string;
  name: string;
  code: string;
  expiresInMinutes: number;
}): Promise<boolean> {
  if (!mailConfigured()) return false;

  const { name, code, expiresInMinutes } = input;

  /* Deliberately plain. No logo, no marketing footer, no tracking pixel, one
     paragraph and a number — the shapes that get a one-time-code email filed as
     spam are exactly the decorative ones. */
  const text = [
    `Hello ${name},`,
    "",
    `Your admin password reset code is: ${code}`,
    "",
    `It expires in ${expiresInMinutes} minutes and can be used once.`,
    "",
    "If you did not ask to reset your password, you can ignore this message —",
    "your password has not changed. Nobody can use this code without it.",
  ].join("\n");

  const html = [
    `<p>Hello ${escapeHtml(name)},</p>`,
    "<p>Your admin password reset code is:</p>",
    `<p style="font-size:28px;font-weight:700;letter-spacing:4px;font-family:monospace">${escapeHtml(code)}</p>`,
    `<p>It expires in ${expiresInMinutes} minutes and can be used once.</p>`,
    "<p>If you did not ask to reset your password, you can ignore this message — your password has not changed.</p>",
  ].join("");

  const outcome = await sendMail({
    to: input.email,
    subject: `${code} is your admin password reset code`,
    text,
    html,
  });

  if (!outcome.sent) log.warn({ reason: outcome.reason }, "Reset code email failed");
  return outcome.sent;
}

async function sendTelegram(input: {
  code: string;
  expiresInMinutes: number;
}): Promise<boolean> {
  try {
    const settings = await getSettings();

    /* Not gated on `telegramEnabled`. That switch governs whether the shop
       wants order alerts; being locked out of the panel is not the moment to
       honour a preference about notification volume. A token and a chat are
       all this needs. */
    if (settings.telegramBotToken.trim() === "" || settings.telegramChatId.trim() === "") {
      return false;
    }

    const text = [
      "<b>Admin password reset</b>",
      "",
      `Your code is <code>${input.code}</code>`,
      "",
      `Expires in ${input.expiresInMinutes} minutes. Works once.`,
      "",
      "If this was not you, ignore it — nothing has changed. But someone knows",
      "your admin email address, so it is worth keeping an eye on.",
    ].join("\n");

    const outcome = await sendToChat(settings, settings.telegramChatId, text);
    if (!outcome.sent) log.warn({ reason: outcome.reason }, "Reset code Telegram send failed");
    return outcome.sent;
  } catch (error) {
    /* Reading settings hits the database, which can fail. Email may still have
       worked, so this is a degraded channel and not a failed reset. */
    log.error({ err: error }, "Reset code Telegram send threw");
    return false;
  }
}
