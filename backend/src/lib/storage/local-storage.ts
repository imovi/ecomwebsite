import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config/index.js";
import { StorageError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import { extensionForMimeType } from "./file-types.js";
import type { PutObjectInput, StorageDriver, StoredFile } from "./storage.types.js";

/**
 * Local filesystem storage driver.
 *
 * Two security properties matter here and both are enforced, not assumed:
 *
 * 1. **The client never influences the stored path.** Filenames are generated
 *    from random bytes and an extension derived from the *sniffed* MIME type.
 *    An uploaded `../../.env` or `shell.php` cannot become a path or an
 *    executable name.
 *
 * 2. **Every resolved path is re-checked to be inside the upload root.** Even
 *    though keys are generated internally, the containment check is cheap
 *    insurance against a future caller passing a key through from a request.
 */

const log = createLogger("storage:local");

/** Date-partitioned so no single directory accumulates millions of entries. */
function datePrefix(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sanitizeFolder(folder: string): string {
  const cleaned = folder
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, "")
    .replace(/\.{2,}/g, "")
    .replace(/^\/+|\/+$/g, "");

  if (!cleaned) throw new StorageError("Invalid storage folder.");
  return cleaned;
}

/** Keeps the original name for display only — never used to build a path. */
function sanitizeOriginalName(name: string): string {
  return path.basename(name).replace(/[^\w. -]/g, "").slice(0, 255) || "file";
}

export class LocalStorageDriver implements StorageDriver {
  readonly name = "local";

  constructor(
    private readonly rootDir: string = config.upload.dir,
    private readonly publicPath: string = config.upload.publicPath,
    private readonly baseUrl: string = config.server.apiUrl,
  ) {}

  /**
   * Resolves a key to an absolute path, refusing anything that escapes the
   * upload root. `path.resolve` collapses `..` segments, so comparing the
   * result against the root catches traversal regardless of how it was encoded.
   */
  private resolveKey(key: string): string {
    const absolute = path.resolve(this.rootDir, key);
    const root = path.resolve(this.rootDir);

    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new StorageError("Resolved path escapes the storage root.");
    }
    return absolute;
  }

  async put(input: PutObjectInput): Promise<StoredFile> {
    const folder = sanitizeFolder(input.folder);
    const extension = extensionForMimeType(input.mimeType);
    const key = `${folder}/${datePrefix()}/${randomBytes(16).toString("hex")}${extension}`;

    const destination = this.resolveKey(key);

    try {
      await mkdir(path.dirname(destination), { recursive: true });
      /* `wx` fails rather than overwriting. With 128 bits of randomness a
         collision is impossible in practice, but silently destroying an
         existing object would be the worst possible failure mode. */
      await writeFile(destination, input.buffer, { flag: "wx" });
    } catch (error) {
      throw new StorageError("Failed to write the uploaded file.", error);
    }

    const stored: StoredFile = {
      key,
      url: this.url(key),
      size: input.buffer.byteLength,
      mimeType: input.mimeType,
      originalName: sanitizeOriginalName(input.originalName),
      checksum: createHash("sha256").update(input.buffer).digest("hex"),
    };

    log.debug({ key: stored.key, size: stored.size }, "Stored file");
    return stored;
  }

  async delete(key: string): Promise<void> {
    try {
      /* `force` makes a missing file a no-op, which is the contract. */
      await rm(this.resolveKey(key), { force: true });
      log.debug({ key }, "Deleted file");
    } catch (error) {
      throw new StorageError("Failed to delete the stored file.", error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const stats = await stat(this.resolveKey(key));
      return stats.isFile();
    } catch {
      return false;
    }
  }

  url(key: string): string {
    return `${this.baseUrl}${this.publicPath}/${key}`;
  }

  /** Creates the upload root at boot so the first upload does not fail. */
  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }
}
