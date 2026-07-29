/**
 * Storage abstraction.
 *
 * Call sites depend on this interface, never on a filesystem path or an S3
 * client. Moving product images to S3/R2/Spaces later means adding one
 * implementation and changing one config value — no feature module changes.
 *
 * Local disk is what ships in Phase 1. It is genuinely correct for a
 * single-VPS deployment, which is where most Bangladeshi stores start; it
 * stops being correct the moment there are two app servers, at which point the
 * S3 driver becomes necessary rather than merely nicer.
 */

export interface StoredFile {
  /** Storage key, e.g. `products/2026/07/a1b2c3.webp`. The canonical handle. */
  key: string;
  /** Absolute URL for a client to fetch. */
  url: string;
  size: number;
  mimeType: string;
  /** Original client filename, sanitised. Display only — never a path. */
  originalName: string;
  checksum: string;
}

export interface PutObjectInput {
  /** Logical folder, e.g. `products`. No leading or trailing slash. */
  folder: string;
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export interface StorageDriver {
  readonly name: string;

  put(input: PutObjectInput): Promise<StoredFile>;

  /** Must resolve — not throw — when the key does not exist. Deleting an
   *  already-deleted object is a success, not an error. */
  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /** Public URL for a stored key. */
  url(key: string): string;
}
