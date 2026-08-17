import { z } from "zod";

/** Customer request validation. */

export const listCustomersQuerySchema = z
  .object({
    /**
     * Two characters minimum, not one.
     *
     * A name search compiles to `ILIKE '%x%'`, and a leading wildcard cannot use
     * an index — so it scans every order and groups them. One character matches
     * most of the catalogue's customers for that cost, which makes it a cheap way
     * for a compromised staff login (or a retrying admin screen) to keep the
     * database busy. Two characters is still forgiving and much narrower.
     */
    search: z.string().trim().min(2).max(60).optional(),
    /** Customers with more than one order. */
    repeatOnly: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((value) => value === true || value === "true"),
    /** Customers who have ever had an order come back. */
    withReturnsOnly: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((value) => value === true || value === "true"),
    sort: z
      .enum(["recent", "oldest", "spent", "orders", "returns", "name"])
      .default("recent"),
    page: z.coerce.number().int().min(1).default(1),
    /* Same ceiling as every other admin listing — see lib/validation/schemas. */
    perPage: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/**
 * Export query: the same filters, no pagination.
 *
 * `page`/`perPage` are deliberately absent rather than optional. An export that
 * accepted a page would eventually be called with one, and a CSV that silently
 * contains one page of a customer list is worse than no CSV.
 */
export const exportCustomersQuerySchema = listCustomersQuerySchema
  .omit({ page: true, perPage: true })
  .extend({
    /** `csv` for Excel, `json` for anything else. */
    format: z.enum(["csv", "json"]).default("csv"),
  })
  .strict();

export type ExportCustomersQuery = z.infer<typeof exportCustomersQuerySchema>;

export const customerPhoneParamSchema = z.object({
  /* Digits, dashes and spaces: whatever the operator copied out of the list. */
  phone: z.string().trim().min(4).max(24),
});
