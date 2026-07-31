import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { uploadImageFields } from "../../middleware/upload.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendCreated, sendNoContent, sendSuccess } from "../../core/response.js";
import { BadRequestError } from "../../core/errors.js";
import { safeString, uuidSchema } from "../../lib/validation/schemas.js";
import * as service from "./banner.service.js";

/**
 * Banner routes.
 *
 *   /api/v1/banners        public, read-only, active banners in order
 *   /api/v1/admin/banners  authenticated, all writes
 *
 * The split mirrors categories and products, so the security boundary is legible
 * from the mount points in `routes/v1.ts` rather than by auditing handlers.
 *
 * Writes are `admin` rather than `manager`: the homepage banner is the shop's
 * most visible surface and an advertising decision, not daily catalogue upkeep.
 */

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where the banner links to.
 *
 * Site-relative paths only. An absolute URL here would let whoever controls the
 * admin panel turn the shop's own homepage into a redirect to anywhere, and the
 * banner is the single most-clicked element on the site.
 */
const hrefField = z
  .string()
  .trim()
  .max(300)
  .refine(
    (value) => value.startsWith("/") && !value.startsWith("//"),
    "The link must be a path on this site, like /category/audio.",
  );

/* Multipart bodies arrive as strings — "false" is truthy, so the flags need
   parsing rather than casting. */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : ["true", "1", "yes", "on"].includes(value.trim().toLowerCase()),
  );

const createBannerSchema = z
  .object({
    alt: safeString({ max: 200 }).optional(),
    href: hrefField.optional(),
    isActive: booleanish.optional(),
  })
  .strict();

const updateBannerSchema = z
  .object({
    alt: safeString({ max: 200 }).optional(),
    href: hrefField.optional(),
    isActive: booleanish.optional(),
    /** Drops the phone crop so the wide image is used on every screen. */
    clearImageMobile: booleanish.optional(),
  })
  .strict();

const bannerIdParamSchema = z.object({ id: uuidSchema });

const reorderSchema = z
  .object({
    order: z
      .array(z.object({ id: uuidSchema, sortOrder: z.number().int().min(0).max(999) }).strict())
      .min(1)
      .max(50)
      .refine(
        (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
        "Each banner may appear only once.",
      ),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

type UploadedFiles = Record<string, Express.Multer.File[] | undefined>;

/** `multer.fields` puts each field's file in a one-element array. */
function pickFile(
  req: { files?: unknown },
  field: string,
): { buffer: Buffer; originalname: string } | undefined {
  const files = req.files as UploadedFiles | undefined;
  const file = files?.[field]?.[0];
  return file ? { buffer: file.buffer, originalname: file.originalname } : undefined;
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export const bannerPublicRouter: Router = Router();

bannerPublicRouter.get("/", async (_req, res) => {
  sendSuccess(res, { banners: await service.list() });
});

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export const bannerAdminRouter: Router = Router();

bannerAdminRouter.use(authenticate, requireRole("admin"));

/** Includes inactive banners, which the public list hides. */
const listAdmin: RequestHandler = async (_req, res) => {
  sendSuccess(res, { banners: await service.list({ includeInactive: true }) });
};

const create: RequestHandler = async (req, res) => {
  const image = pickFile(req, "image");
  if (!image) {
    throw new BadRequestError('A banner image is required. Send it in the "image" field.');
  }

  const { body } = validated<z.infer<typeof createBannerSchema>>(req);

  const banner = await service.create({
    ...(body.alt !== undefined ? { alt: body.alt } : {}),
    ...(body.href !== undefined ? { href: body.href } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    image,
    imageMobile: pickFile(req, "imageMobile"),
  });

  sendCreated(res, { banner });
};

const update: RequestHandler = async (req, res) => {
  const { body, params } = validated<
    z.infer<typeof updateBannerSchema>,
    unknown,
    { id: string }
  >(req);

  const banner = await service.update(params.id, {
    ...(body.alt !== undefined ? { alt: body.alt } : {}),
    ...(body.href !== undefined ? { href: body.href } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    ...(body.clearImageMobile !== undefined
      ? { clearImageMobile: body.clearImageMobile }
      : {}),
    image: pickFile(req, "image"),
    imageMobile: pickFile(req, "imageMobile"),
  });

  sendSuccess(res, { banner });
};

const remove: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await service.remove(params.id);
  sendNoContent(res);
};

const reorder: RequestHandler = async (req, res) => {
  const { body } = validated<z.infer<typeof reorderSchema>>(req);
  sendSuccess(res, { banners: await service.reorder(body.order) });
};

bannerAdminRouter.get("/", listAdmin);

/* Literal path before the `/:id` routes — Express matches in declaration order
   and would otherwise read "reorder" as a banner id. */
bannerAdminRouter.patch("/reorder", validate({ body: reorderSchema }), reorder);

/* Multer runs before validation: the multipart body has to be parsed before
   anything can inspect the text fields alongside the files. */
bannerAdminRouter.post(
  "/",
  uploadImageFields(["image", "imageMobile"]),
  validate({ body: createBannerSchema }),
  create,
);

bannerAdminRouter.patch(
  "/:id",
  uploadImageFields(["image", "imageMobile"]),
  validate({ params: bannerIdParamSchema, body: updateBannerSchema }),
  update,
);

bannerAdminRouter.delete("/:id", validate({ params: bannerIdParamSchema }), remove);
