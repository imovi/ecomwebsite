import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
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

/** `hinar-2026-08-30-0230.sql.gz` — sortable, and says what it is. */
function backupName(storeName: string, at: Date): string {
  const slug = (storeName || "shop").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stamp = at.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  return `${slug || "shop"}-${stamp}.sql.gz`;
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

  let sql: Buffer;
  try {
    sql = await dumpDatabase();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The dump failed.";
    log.error({ err: error }, "Database dump failed");
    return { sent: false, reason };
  }

  if (sql.byteLength < MIN_DUMP_BYTES) {
    /* A pg_dump that dies part way still exits with something on stdout. A
       backup that is quietly empty is worse than no backup, because it looks
       like one until the day it is needed. */
    return { sent: false, reason: "The dump came back too small to be real." };
  }

  const gz = gzipSync(sql, { level: 9 });
  const at = new Date();
  const name = backupName(settings.storeName, at);

  const kb = Math.max(1, Math.round(gz.byteLength / 1024));
  const caption =
    `🗄 Database backup — ${at.toISOString().slice(0, 16).replace("T", " ")} UTC\n` +
    `${kb} KB · restore with: gunzip -c ${name.replace(".gz", ".gz")} | psql`;

  const outcome = await telegram.sendBackupDocument(
    settings,
    { name, bytes: gz },
    caption,
  );

  if (outcome.sent) {
    log.info({ bytes: gz.byteLength, name }, "Database backup sent to Telegram");
    return { sent: true, bytes: gz.byteLength };
  }

  log.error({ reason: outcome.reason }, "Database backup not sent");
  return { sent: false, bytes: gz.byteLength, ...(outcome.reason ? { reason: outcome.reason } : {}) };
}
