import { config } from "../../config/index.js";
import { LocalStorageDriver } from "./local-storage.js";
import type { StorageDriver } from "./storage.types.js";

/**
 * Storage driver resolution.
 *
 * One place decides which implementation is live. Feature modules import
 * `getStorage()` and never a concrete driver, so adding S3 is a new class plus
 * a branch here.
 */

let driver: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  driver ??= new LocalStorageDriver();
  return driver;
}

/**
 * Prepares storage during bootstrap — creates the upload root so the first
 * upload of a fresh deployment does not fail on a missing directory.
 */
export async function initStorage(): Promise<void> {
  const instance = getStorage();
  if (instance instanceof LocalStorageDriver) {
    await instance.init();
  }
}

/** Test seam, mirroring the database module. */
export function __setStorageDriver(instance: StorageDriver | undefined): void {
  driver = instance;
}

export { config as storageConfig };
export * from "./storage.types.js";
export * from "./file-types.js";
export { LocalStorageDriver } from "./local-storage.js";
