import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { sendSuccess } from "../../core/response.js";
import { BadRequestError } from "../../core/errors.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate, validated } from "../../middleware/validate.js";
import { isProviderKey } from "./providers/index.js";
import * as service from "./fraud.service.js";

/**
 * Asking the couriers about a customer.
 *
 * READING is `manager` and above: it is the confirmation call's job, and the
 * whole point is that the person on the phone can see it.
 *
 * CONFIGURING is `super_admin` only. These are the shop's real courier
 * passwords — an account that can create parcels and see settlement — so
 * saving one is a higher bar than saving an API key, and matches the rank the
 * team screen already requires.
 */
export const fraudAdminRouter: Router = Router();

fraudAdminRouter.use(authenticate);

/** Bangladeshi mobile, the same shape orders and the storefront enforce. */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^01[3-9]\d{8}$/, "Must be a Bangladeshi mobile number.");

const phoneParams = z.object({ phone: phoneSchema });

const providerParams = z.object({
  provider: z.string().refine(isProviderKey, "Unknown courier."),
});

const saveAccountSchema = z
  .object({
    identifier: z.string().trim().max(200),
    /**
     * Absent leaves the stored password alone, so saving the form without
     * retyping it does not wipe it. An empty string is a deliberate clear.
     */
    secret: z.string().max(200).optional(),
    enabled: z.boolean(),
  })
  .strict()
  .refine(
    (value) => !value.enabled || value.identifier.length > 0,
    "A courier cannot be switched on without sign-in details.",
  );

const testSchema = z.object({ phone: phoneSchema }).strict();

/* --- Reading ------------------------------------------------------------- */

const getReport: RequestHandler = async (req, res) => {
  const { params, query } = validated<unknown, { refresh?: string }, { phone: string }>(req);
  const report = await service.report(params.phone, { force: query.refresh === "true" });
  sendSuccess(res, { report });
};

fraudAdminRouter.get(
  "/check/:phone",
  requireRole("manager"),
  validate({
    params: phoneParams,
    query: z.object({ refresh: z.enum(["true", "false"]).optional() }).strict(),
  }),
  getReport,
);

/**
 * POST because the list of numbers is the request, and putting fifty customer
 * phone numbers in a query string would write them into every access log and
 * proxy cache between here and the browser.
 */
const cachedSchema = z
  .object({ phones: z.array(phoneSchema).min(1).max(100) })
  .strict();

const getCached: RequestHandler = async (req, res) => {
  const { body } = validated<z.infer<typeof cachedSchema>>(req);
  sendSuccess(res, { reports: await service.cachedFor(body.phones) });
};

fraudAdminRouter.post(
  "/cached",
  requireRole("manager"),
  validate({ body: cachedSchema }),
  getCached,
);

/* --- Configuring --------------------------------------------------------- */

const listAccounts: RequestHandler = async (_req, res) => {
  sendSuccess(res, { accounts: await service.listAccounts() });
};

const saveAccount: RequestHandler = async (req, res) => {
  const { body, params } = validated<
    z.infer<typeof saveAccountSchema>,
    unknown,
    { provider: string }
  >(req);

  if (!isProviderKey(params.provider)) throw new BadRequestError("Unknown courier.");

  const accounts = await service.saveAccount(params.provider, body);
  sendSuccess(res, { accounts });
};

const testAccount: RequestHandler = async (req, res) => {
  const { body, params } = validated<{ phone: string }, unknown, { provider: string }>(req);

  if (!isProviderKey(params.provider)) throw new BadRequestError("Unknown courier.");

  const result = await service.testAccount(params.provider, body.phone);
  sendSuccess(res, { result });
};

fraudAdminRouter.get("/accounts", requireRole("super_admin"), listAccounts);

fraudAdminRouter.put(
  "/accounts/:provider",
  requireRole("super_admin"),
  validate({ params: providerParams, body: saveAccountSchema }),
  saveAccount,
);

/* A live sign-in, on demand. Nobody but the shop can prove these passwords
   work, so the proof has to be one click away from where they are typed. */
fraudAdminRouter.post(
  "/accounts/:provider/test",
  requireRole("super_admin"),
  validate({ params: providerParams, body: testSchema }),
  testAccount,
);
