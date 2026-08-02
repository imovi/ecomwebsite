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

/** Quotes a value, doubling any quotes inside it. */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  /* Always quoted rather than only when needed: a customer name with a comma
     would otherwise split into two columns, and "when needed" is a rule that
     gets one case wrong eventually. */
  return `"${text.replace(/"/g, '""')}"`;
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
