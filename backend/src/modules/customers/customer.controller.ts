import type { RequestHandler } from "express";
import { sendPaginated } from "../../core/response.js";
import { validated } from "../../middleware/validate.js";
import * as service from "./customer.service.js";
import type { ExportCustomersQuery, ListCustomersQuery } from "./customer.validation.js";

/** Customer HTTP layer. Translation only. */

/**
 * The UTF-8 byte order mark, as an escape rather than the character itself.
 *
 * Excel on Windows reads a CSV without it in the system codepage and turns every
 * Bangla name into mojibake — that one byte is the difference between a working
 * export and one nobody can open. Written as `` because an invisible
 * character in source is one the next person deletes without seeing it.
 */
const BOM = String.fromCharCode(0xfeff);

export const list: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListCustomersQuery>(req);
  const { customers, pagination } = await service.list(query);
  sendPaginated(res, customers, pagination);
};

/**
 * The whole filtered list as a download.
 *
 * Server-side rather than built in the browser, unlike the other admin tables.
 * Those export what is on screen because what is on screen is everything; a
 * customer list is paginated, and a CSV that quietly stopped at row 20 is a file
 * somebody trusts. So the filter is re-run without a page.
 */
const exportCustomers: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ExportCustomersQuery>(req);
  const { customers, truncated } = await service.forExport(query);

  const stamp = new Date().toISOString().slice(0, 10);

  if (query.format === "json") {
    /* Downloaded rather than rendered: this is an export, and a browser handed
       JSON inline shows it as a wall of text in a tab. */
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="gng-customers-${stamp}.json"`);
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), truncated, customers }, null, 2));
    return;
  }

  const rows = customers.map((customer) =>
    service.EXPORT_COLUMNS.map((column) => column.value(customer)),
  );

  /**
   * Neutralises a spreadsheet formula before it becomes one.
   *
   * A customer types their own name into the public checkout, and that name ends
   * up in this file. Excel and Sheets treat a cell beginning `=`, `+`, `-` or
   * `@` as a formula and evaluate it on open — so `=cmd|'/c calc'!A1` typed as a
   * name is remote code execution against whoever opens the export, and
   * `=IMPORTXML(...)` quietly ships the sheet's contents to somebody else's
   * server. Quoting the field does not help; the quotes are stripped by the
   * parser before the formula is read.
   *
   * A leading apostrophe is the standard defence: the spreadsheet shows the text
   * and evaluates nothing. Tab and carriage return are included because both are
   * treated as leading whitespace and skipped over on the way to the trigger.
   *
   * `safeString` on the way IN strips control characters but knows nothing about
   * formulas, and it should not — this is a property of the file format, so it
   * belongs at the point the file is written.
   */
  const defuse = (value: string): string =>
    /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  /* The BOM is not decoration. Without it Excel on Windows reads the file in the
     system codepage and every Bangla name becomes mojibake — the same reason the
     browser-side helper in `lib/admin/csv.ts` writes one. CRLF for the same
     reason: some Excel locales treat a lone LF as one long row. */
  const csv = [
    service.EXPORT_COLUMNS.map((column) => column.header),
    ...rows,
  ]
    .map((row) =>
      row
        .map((cell) => `"${defuse(String(cell ?? "")).replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\r\n");

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="gng-customers-${stamp}.csv"`);
  /* Written as an escape, not as a literal BOM character: an invisible byte in
     source is a byte the next person deletes by accident. */
  res.send(BOM + csv);
};

export { exportCustomers as export };

/* No per-customer detail endpoint, deliberately. Everything known about a
   customer is on the list row, and their order history already has a screen —
   the orders list, searched by phone. A second place to read the same orders
   would be a second place for them to look different. */
