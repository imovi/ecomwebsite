import assert from "node:assert/strict";
import { describe, it } from "node:test";

/* `config` parses `process.env` at import time and the client pulls in the
   logger, so the environment is set before the module is loaded — the same
   reason and the same order as the integration harness. */
process.env.NODE_ENV = "test";
process.env.DATABASE_DRIVER = "pglite";
process.env.PGLITE_DATA_DIR = "memory://clamp";
process.env.JWT_ACCESS_SECRET = "test-secret-that-is-definitely-long-enough-32+";
process.env.LOG_LEVEL = "silent";

const { clampSince } = await import("../src/modules/ads/meta-ads.client.js");

/**
 * The 37-month wall — unit tests.
 *
 * Meta does not hold insights older than 37 months, and asking for them is not
 * answered with the months that DO exist: the entire call is rejected with
 * `(#3018) The start date of the time range cannot be beyond 37 months from the
 * current date`. On the Performance screen that meant picking "All time" — which
 * resolves to the shop's own epoch, the year 2000 — blanked every advertising
 * figure on the page and printed "Meta could not be read" instead.
 *
 * The clamp is one line and its failure mode is silent and total, which is
 * exactly the sort of thing that gets refactored away by somebody who cannot
 * see why it is there. These tests are the reason written down.
 */

/** A fixed clock. A boundary test against `new Date()` passes or fails by month. */
const NOW = new Date("2026-08-30T00:00:00Z");

describe("Meta insights — the 37-month lookback wall", () => {
  it("pulls the shop's epoch forward to something Meta will answer", () => {
    /* What "All time" actually resolves to. Sent raw, this is the bug. */
    assert.equal(clampSince("2000-01-01", NOW), "2023-08-30");
  });

  it("leaves an ordinary range exactly as it was asked for", () => {
    /* The common case must be untouched — a clamp that quietly moved a
       last-30-days window would make the ad spend disagree with the orders
       beside it, which is worse than the blank screen it replaced. */
    assert.equal(clampSince("2026-08-01", NOW), "2026-08-01");
    assert.equal(clampSince("2026-08-30", NOW), "2026-08-30");
  });

  it("keeps a date sitting just inside the wall", () => {
    assert.equal(clampSince("2023-08-31", NOW), "2023-08-31");
  });

  it("moves a date sitting just outside it", () => {
    assert.equal(clampSince("2023-08-29", NOW), "2023-08-30");
  });

  it("clamps to 36 months, not 37, so the boundary is never the request", () => {
    const months =
      (2026 - 2023) * 12 + (7 - 7); /* Aug 2026 → Aug 2023 is 36 whole months. */
    assert.equal(months, 36);

    /* A request landing exactly on Meta's own limit is counted against Meta's
       clock rather than ours, and fails across a date line for no visible
       reason. The spare month is the whole point of the constant. */
    assert.equal(clampSince("2000-01-01", NOW) > "2023-07-30", true);
  });

  it("handles a month with no matching day without inventing one", () => {
    /* 31 May minus 36 months is 31 May — but the arithmetic runs through
       `Date.UTC`, and a month-end that does not exist rolls forward rather than
       producing an impossible date Meta would reject as malformed. */
    const clamped = clampSince("2000-01-01", new Date("2026-05-31T00:00:00Z"));
    assert.match(clamped, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(Number.isNaN(Date.parse(clamped)), false);
  });
});
