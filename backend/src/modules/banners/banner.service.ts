import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { banners, type BannerRow } from "../../db/schema/banners.js";
import { NotFoundError, BadRequestError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import { getStorage } from "../../lib/storage/index.js";
import { optimizeImage } from "../../lib/images/optimizer.js";

/**
 * Homepage banners.
 *
 * Small enough that repository and service are one file — there is no query here
 * more complex than "ordered list", and splitting it would be ceremony rather
 * than structure.
 *
 * Every write that replaces artwork deletes the file it replaced. Orphaned blobs
 * are invisible until the disk fills up, and on a single VPS that is the whole
 * shop going down.
 */

const log = createLogger("banners");

/**
 * Banners are wide, so the 200px product floor is too low to catch a mistake
 * here — 400px still rejects an accidental thumbnail while accepting any real
 * banner crop, including a tall phone one.
 */
const MIN_BANNER_DIMENSION = 400;

export interface BannerDto {
  id: string;
  imageUrl: string;
  /** Real size of the stored artwork, so the slider can take its shape. */
  imageWidth: number;
  imageHeight: number;
  /** Null when no phone-specific crop was uploaded; clients fall back. */
  imageMobileUrl: string | null;
  imageMobileWidth: number | null;
  imageMobileHeight: number | null;
  alt: string;
  href: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: BannerRow): BannerDto {
  const storage = getStorage();
  return {
    id: row.id,
    imageUrl: storage.url(row.imageKey),
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight,
    imageMobileUrl: row.imageMobileKey ? storage.url(row.imageMobileKey) : null,
    imageMobileWidth: row.imageMobileWidth,
    imageMobileHeight: row.imageMobileHeight,
    alt: row.alt,
    href: row.href,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function list(options: { includeInactive?: boolean } = {}): Promise<BannerDto[]> {
  const rows = await getDb()
    .select()
    .from(banners)
    .where(options.includeInactive ? undefined : eq(banners.isActive, true))
    .orderBy(asc(banners.sortOrder), asc(banners.createdAt));

  return rows.map(toDto);
}

async function findRow(id: string): Promise<BannerRow> {
  const rows = await getDb().select().from(banners).where(eq(banners.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Banner not found.");
  return row;
}

export async function get(id: string): Promise<BannerDto> {
  return toDto(await findRow(id));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

interface StoredImage {
  key: string;
  width: number;
  height: number;
}

async function storeImage(
  file: { buffer: Buffer; originalname: string },
  kind: "banner" | "mobile banner",
): Promise<StoredImage> {
  const optimized = await optimizeImage(file.buffer, {
    label: file.originalname,
    minDimension: MIN_BANNER_DIMENSION,
    kind: kind === "banner" ? "Banners" : "Mobile banners",
  });

  const stored = await getStorage().put({
    folder: "banners",
    buffer: optimized.buffer,
    mimeType: optimized.mimeType,
    originalName: file.originalname,
  });

  /* Dimensions come from the optimiser's output, not the original file: the
     stored image is what the browser lays out, and it may have been resized. */
  return { key: stored.key, width: optimized.width, height: optimized.height };
}

/** Best effort — a failed cleanup must not fail the request that caused it. */
async function deleteKey(key: string | null | undefined): Promise<void> {
  if (!key) return;
  await getStorage()
    .delete(key)
    .catch((error: unknown) => {
      log.error({ err: error, key }, "Failed to delete banner image");
    });
}

export interface CreateBannerInput {
  alt?: string;
  href?: string;
  isActive?: boolean;
  image: { buffer: Buffer; originalname: string };
  imageMobile?: { buffer: Buffer; originalname: string } | undefined;
}

export async function create(input: CreateBannerInput): Promise<BannerDto> {
  const wide = await storeImage(input.image, "banner");

  let mobile: StoredImage | null = null;
  if (input.imageMobile) {
    try {
      mobile = await storeImage(input.imageMobile, "mobile banner");
    } catch (error) {
      /* The wide image is already stored; leaving it behind on a rejected mobile
         crop would orphan it immediately. */
      await deleteKey(wide.key);
      throw error;
    }
  }

  /* Appended to the end. An operator adding a banner is not asking to change the
     order of the ones already there. */
  const nextRows = await getDb()
    .select({ next: sql<number>`coalesce(max(${banners.sortOrder}), -1) + 1`.mapWith(Number) })
    .from(banners);
  const next = nextRows[0]?.next ?? 0;

  const rows = await getDb()
    .insert(banners)
    .values({
      imageKey: wide.key,
      imageWidth: wide.width,
      imageHeight: wide.height,
      imageMobileKey: mobile?.key ?? null,
      imageMobileWidth: mobile?.width ?? null,
      imageMobileHeight: mobile?.height ?? null,
      alt: input.alt ?? "",
      href: input.href ?? "/",
      isActive: input.isActive ?? true,
      sortOrder: next,
    })
    .returning();

  const created = rows[0];
  if (!created) {
    await deleteKey(wide.key);
    await deleteKey(mobile?.key);
    throw new Error("Insert into banners returned no row");
  }

  log.info({ bannerId: created.id }, "Banner created");
  return toDto(created);
}

export interface UpdateBannerInput {
  alt?: string;
  href?: string;
  isActive?: boolean;
  image?: { buffer: Buffer; originalname: string } | undefined;
  imageMobile?: { buffer: Buffer; originalname: string } | undefined;
  /** Explicitly drops the phone crop, falling back to the wide image. */
  clearImageMobile?: boolean;
}

export async function update(id: string, input: UpdateBannerInput): Promise<BannerDto> {
  const existing = await findRow(id);

  const patch: Partial<BannerRow> = {};
  if (input.alt !== undefined) patch.alt = input.alt;
  if (input.href !== undefined) patch.href = input.href;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  /* New artwork is stored BEFORE the row is updated, so a rejected image leaves
     the banner exactly as it was rather than pointing at nothing. */
  let replacedImage: string | null = null;
  let replacedMobile: string | null = null;

  if (input.image) {
    const wide = await storeImage(input.image, "banner");
    patch.imageKey = wide.key;
    patch.imageWidth = wide.width;
    patch.imageHeight = wide.height;
    replacedImage = existing.imageKey;
  }

  if (input.imageMobile) {
    const mobile = await storeImage(input.imageMobile, "mobile banner");
    patch.imageMobileKey = mobile.key;
    patch.imageMobileWidth = mobile.width;
    patch.imageMobileHeight = mobile.height;
    replacedMobile = existing.imageMobileKey;
  } else if (input.clearImageMobile) {
    patch.imageMobileKey = null;
    patch.imageMobileWidth = null;
    patch.imageMobileHeight = null;
    replacedMobile = existing.imageMobileKey;
  }

  if (Object.keys(patch).length === 0) {
    throw new BadRequestError("Provide at least one field to update.");
  }

  const rows = await getDb()
    .update(banners)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(banners.id, id))
    .returning();

  const updated = rows[0];
  if (!updated) throw new NotFoundError("Banner not found.");

  /* Only after the row commits, and only when the key actually changed. */
  if (replacedImage && replacedImage !== updated.imageKey) await deleteKey(replacedImage);
  if (replacedMobile && replacedMobile !== updated.imageMobileKey) {
    await deleteKey(replacedMobile);
  }

  log.info({ bannerId: id, fields: Object.keys(patch) }, "Banner updated");
  return toDto(updated);
}

export async function remove(id: string): Promise<void> {
  const existing = await findRow(id);

  await getDb().delete(banners).where(eq(banners.id, id));

  await deleteKey(existing.imageKey);
  await deleteKey(existing.imageMobileKey);

  log.info({ bannerId: id }, "Banner deleted");
}

export async function reorder(order: { id: string; sortOrder: number }[]): Promise<BannerDto[]> {
  await getDb().transaction(async (tx) => {
    for (const entry of order) {
      await tx
        .update(banners)
        .set({ sortOrder: entry.sortOrder, updatedAt: sql`now()` })
        .where(eq(banners.id, entry.id));
    }
  });

  const rows = await getDb()
    .select()
    .from(banners)
    .orderBy(asc(banners.sortOrder), asc(banners.createdAt));

  return rows.map(toDto);
}
