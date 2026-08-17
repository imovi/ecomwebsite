"use client";

/**
 * CSV downloads for the admin tables.
 *
 * Built in the browser rather than asked of the API: the rows are already here,
 * and a round trip could only return the same data.
 *
 * TWO DETAILS THAT DECIDE WHETHER THE FILE IS USABLE
 *
 *  - **The UTF-8 BOM.** Without it Excel on Windows reads the file as the system
 *    codepage and turns every Bangla name into mojibake. That single byte is the
 *    difference between a working export and one nobody can open.
 *  - **CRLF line endings.** Excel treats a lone LF as one long row in some
 *    locales; CRLF is what the format actually specifies.
 */

/**
 * Neutralises a spreadsheet formula before it becomes one.
 *
 * Excel and Sheets evaluate any cell beginning `=`, `+`, `-` or `@` when the
 * file is opened. Customer names and addresses in these exports were typed into
 * the PUBLIC checkout by whoever placed the order, so `=cmd|'/c calc'!A1` as a
 * name is code running on the machine of whoever opens the file, and
 * `=IMPORTXML(...)` quietly posts the sheet's contents to somebody else's
 * server. Quoting does not help — the parser strips the quotes before it reads
 * the formula.
 *
 * A leading apostrophe is the standard defence: the text shows, nothing runs.
 * Tab and carriage return count as leading whitespace on the way to the
 * trigger, so they are covered too.
 */
function defuse(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Quotes a value, doubling any quotes inside it. */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  /* Always quoted rather than only when needed: a customer name with a comma
     would otherwise split into two columns, and "when needed" is a rule that
     gets one case wrong eventually. */
  return `"${defuse(text).replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))].join(
    "\r\n",
  );
}

/** Hands the browser a file. Named with today's date so downloads do not collide. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}
