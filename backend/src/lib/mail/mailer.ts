import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../../config/index.js";
import { createLogger } from "../../core/logger.js";

/**
 * Outbound email.
 *
 * Exactly one message is sent from this system today — the password-reset code
 * — and that shapes every decision here.
 *
 * WHY THE CONFIGURATION IS IN THE ENVIRONMENT, NOT IN STORE SETTINGS
 * ------------------------------------------------------------------
 * Every other integration in this codebase — Telegram, Meta, Google Sheets —
 * is configured from the admin panel and stored in the settings row, and
 * consistency would argue for doing the same here. It is deliberately not.
 *
 * This transport exists to get an owner back INTO the panel. Putting its
 * configuration behind the panel makes the recovery path depend on the thing it
 * is recovering: one bad edit to an SMTP field and the way back in is gone,
 * with no way to fix it that does not require the login you have lost. It is
 * infrastructure, like the database URL, and it belongs beside the database URL.
 *
 * OPTIONAL BY DESIGN
 * ------------------
 * With no SMTP host configured this module reports "not configured" and sends
 * nothing. That is not a broken deployment: the reset code also goes to
 * Telegram, which is already running on this shop, so email is the second
 * channel rather than the only one. `isConfigured` exists so the caller can
 * tell "nobody was told" from "one of the two channels was quiet".
 *
 * NOTHING HERE THROWS
 * -------------------
 * A refused connection, a DNS failure, a provider rejecting the sender — all of
 * it comes back as `{ sent: false, reason }`. The caller decides what to do,
 * and what it does is carry on with the other channel. An unreachable mail
 * server must never turn a password reset into a 500.
 */

const log = createLogger("mailer");

export interface MailOutcome {
  sent: boolean;
  reason?: string;
}

let transporter: Transporter | null = null;

/** True when a host is configured. Says nothing about whether it works. */
export function isConfigured(): boolean {
  return config.mail.host !== "";
}

/**
 * Built once and reused, so a pooled connection is not renegotiated per send.
 *
 * Created lazily rather than at boot: an unconfigured shop should not pay for a
 * transport it will never use, and a misconfigured one should fail at the point
 * of sending — where the failure is reported to somebody — rather than during
 * startup, where it would take the whole API down over a feature nobody was
 * using yet.
 */
function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    /* Implicit TLS on 465; STARTTLS everywhere else. This is the rule every
       provider follows, so it is derived rather than made into one more
       setting somebody has to get right. */
    secure: config.mail.port === 465,
    ...(config.mail.user
      ? { auth: { user: config.mail.user, pass: config.mail.password } }
      : {}),
  });

  return transporter;
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<MailOutcome> {
  if (!isConfigured()) {
    return { sent: false, reason: "No SMTP host is configured." };
  }

  try {
    await getTransporter().sendMail({
      from: config.mail.from,
      to: input.to,
      subject: input.subject,
      /* Both parts. A plain-text alternative is what stops a one-link,
         one-number email from scoring as spam, and it is what a phone's
         notification preview actually shows. */
      text: input.text,
      html: input.html,
    });

    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown mail error";
    /* The address is deliberately not logged. This is only ever called with an
       admin's address, and a log line is a wider audience than the inbox. */
    log.error({ err: error }, "Email not delivered");
    return { sent: false, reason };
  }
}
