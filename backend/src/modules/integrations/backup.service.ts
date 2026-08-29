import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { config } from "../../config/index.js";
import { createLogger } from "../../core/logger.js";
import { getSettings } from "../settings/settings.service.js";
import * as telegram from "./telegram.service.js";

/**
 * A copy of the database, sent to the owner's Telegram.
 *
 * WHY THIS EXISTS WHEN THERE IS ALREADY A GIT BACKUP
 * Because the git one had never run. It needs a repository created, a token
 * minted and a setup script executed, and a backup that depends on three
 * manual steps is a backup that does not exist until somebody does them — this
 * shop lost its database once already while that was still true. This one needs
 * a chat id and nothing else, and the bot is already configured for order
 * alerts, so it starts working the moment the id is filled in.
 *
 * They are not alternatives. Telegram holds recent copies where the owner can
 * find them on their phone; the git repository holds history somewhere neither
 * this server nor Telegram controls. Both should be on.
 *
 * WHAT IS AND IS NOT IN IT
 * The database only: orders, customers, products, settings. Product photos are
 * not — they live in a Docker volume, they are already public on the storefront,
 * and they would turn a fifty-kilobyte nightly message into fifty megabytes.
 * The restore instructions in deploy/RESTORE.md say the same.
 *
 * IT IS NOT ENCRYPTED, AND THAT IS A CHOICE
 * The git backup is, because a repository is permanent and a repository made
 * public by accident is permanent too. This one goes to one private chat, and
 * encrypting it would need a key — which, kept on this server, would be lost in
 * exactly the event the backup exists for. A file the owner cannot open after
 * losing the server is not a backup. The chat must therefore stay private, and
 * the panel says so where the id is entered.
 */

const log = createLogger("backup");

/** Past this the dump is almost certainly a runaway, not a shop. */
const MAX_DUMP_BYTES = 200 * 1024 * 1024;

/** A dump under this is a failed pg_dump, not an empty shop. */
const MIN_DUMP_BYTES = 1024;

/**
 * Above this the file is gzipped rather than sent as readable SQL.
 *
 * Twenty megabytes of SQL is a shop with tens of thousands of orders. Below
 * that, being readable is worth more than the bytes saved — the owner opening
 * the file and recognising their own orders in it is the only check on a
 * backup that anybody actually performs.
 */
const PLAIN_LIMIT_BYTES = 20 * 1024 * 1024;

export interface BackupOutcome {
  sent: boolean;
  bytes?: number;
  reason?: string;
}

/**
 * Runs pg_dump against the configured database and returns the SQL.
 *
 * Spawned rather than piped through a shell: the password is passed in the
 * environment, and a connection string on a command line is visible to every
 * process on the box for as long as the dump runs.
 */
async function dumpDatabase(): Promise<Buffer> {
  /* Only reached when the driver is `postgres`, which the caller has already
     checked — and that setting is what makes the URL required. */
  if (!config.database.url) throw new Error("No DATABASE_URL is configured.");
  const url = new URL(config.database.url);

  return new Promise((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      [
        "--host",
        url.hostname,
        "--port",
        url.port || "5432",
        "--username",
        decodeURIComponent(url.username),
        "--dbname",
        url.pathname.replace(/^\//, ""),
        /* Plain SQL, so a restore needs nothing but psql — the format most
           likely to still be readable by whoever has to use it. */
        "--format",
        "plain",
        "--no-owner",
        "--no-privileges",
      ],
      {
        env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const chunks: Buffer[] = [];
    let stderr = "";
    let size = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_DUMP_BYTES) {
        child.kill();
        reject(new Error("The dump grew past the size this job will send."));
        return;
      }
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`pg_dump could not be run: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pg_dump exited ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

/** `hinar-2026-08-30-0230.sql` — sortable, and says what it is. */
function backupName(storeName: string, at: Date, gzipped: boolean): string {
  const slug = (storeName || "shop").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stamp = at.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  return `${slug || "shop"}-${stamp}.sql${gzipped ? ".gz" : ""}`;
}

/**
 * What is in the file, in a sentence.
 *
 * The point of this is not decoration. A backup that silently captured an empty
 * database looks exactly like a good one until the day it is needed, and the
 * owner is the only person who can tell "3 products, 12 orders" is wrong at a
 * glance. Cheap counts, read from the same database that was just dumped.
 */
async function summarise(): Promise<string> {
  try {
    const rows = await getDb().execute(sql`
      select
        (select count(*) from products)                              as products,
        (select count(*) from orders where deleted_at is null)       as orders,
        (select count(distinct phone) from orders
          where deleted_at is null)                                  as customers,
        (select count(*) from admins)                                as admins,
        (select order_number from orders where deleted_at is null
          order by created_at desc limit 1)                          as newest
    `);

    const row = rows.rows[0];
    if (!row) return "";

    const n = (key: string): number => Number(row[key] ?? 0);
    const parts = [
      `${n("products")} products`,
      `${n("orders")} orders`,
      `${n("customers")} customers`,
      `${n("admins")} admin accounts`,
    ];

    const newest = typeof row.newest === "string" ? row.newest : "";
    return parts.join(" · ") + (newest ? `
Newest order ${newest}` : "");
  } catch {
    /* A summary that cannot be read must not stop the backup being sent. The
       file is the thing that matters; this is a label on it. */
    return "";
  }
}

/**
 * Takes a backup and sends it.
 *
 * Every failure is returned rather than thrown: this runs on a schedule with
 * nobody watching, and a rejected promise in a timer is a backup that stopped
 * silently — which is how the previous one managed to fail every night for
 * days without anyone noticing.
 */
export async function backupToTelegram(): Promise<BackupOutcome> {
  const settings = await getSettings();

  if (settings.telegramBackupChatId.trim() === "") {
    return { sent: false, reason: "No backup chat is configured." };
  }
  if (settings.telegramBotToken.trim() === "") {
    return { sent: false, reason: "No bot token is configured." };
  }

  /* pglite has no pg_dump and is development-only, so this simply does not run
     there rather than failing loudly every night on a developer's laptop. */
  if (config.database.driver !== "postgres") {
    return { sent: false, reason: "Backups run against a real Postgres, not the embedded one." };
  }

  let dump: Buffer;
  try {
    dump = await dumpDatabase();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The dump failed.";
    log.error({ err: error }, "Database dump failed");
    return { sent: false, reason };
  }

  if (dump.byteLength < MIN_DUMP_BYTES) {
    /* A pg_dump that dies part way still exits with something on stdout. A
       backup that is quietly empty is worse than no backup, because it looks
       like one until the day it is needed. */
    return { sent: false, reason: "The dump came back too small to be real." };
  }

  /* Sent as plain SQL, not as an archive.
     The owner should be able to open the file and see their own shop in it —
     a `.gz` is something you have to go and find a tool for, and a backup
     nobody can look inside is a backup nobody checks. Compression only starts
     when the file would otherwise be awkward to send, and the name says which
     one it is. */
  const plain = dump.byteLength <= PLAIN_LIMIT_BYTES;
  const bytes = plain ? dump : gzipSync(dump, { level: 9 });
  const at = new Date();
  const name = backupName(settings.storeName, at, !plain);

  const shopTime = at.toLocaleString("en-GB", {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const contents = await summarise();

  /* Telegram caps a caption at 1024 characters, so this stays short on
     purpose: what it is, what is inside it, and the one command that puts it
     back. Anything longer is a document nobody reads at 3am. */
  const restore = plain
    ? `<code>docker compose exec -T postgres psql -U gng -d gng &lt; ${name}</code>`
    : `<code>gunzip -c ${name} | docker compose exec -T postgres psql -U gng -d gng</code>`;

  const caption = [
    `🗄 <b>${settings.storeName || "Shop"}</b> — database backup`,
    shopTime,
    "",
    contents,
    "",
    plain
      ? "Plain SQL. Open it in any text editor and you can read every row."
      : "Gzipped — the plain file had grown too large to send.",
    "",
    "To put it back, on this server or a new one:",
    restore,
    "",
    "Full steps: deploy/RESTORE.md",
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");

  const outcome = await telegram.sendBackupDocument(settings, { name, bytes }, caption);

  if (outcome.sent) {
    log.info({ bytes: bytes.byteLength, name, plain }, "Database backup sent to Telegram");
    return { sent: true, bytes: bytes.byteLength };
  }

  log.error({ reason: outcome.reason }, "Database backup not sent");
  return {
    sent: false,
    bytes: bytes.byteLength,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
}
