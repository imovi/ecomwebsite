import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestServer, type TestContext } from "./helpers/test-server.js";

/**
 * The date filter every report is built on.
 *
 * The reports used to ask `(created_at at time zone 'Asia/Dhaka')::date between
 * from and to`, which no index can answer because the column sits inside a
 * conversion. They now compare the raw column against two computed instants.
 *
 * Same question, different sentence — and this file is the proof, because
 * "different sentence" is exactly how a report quietly starts reporting the
 * wrong day. Every assertion below runs BOTH forms against the same rows and
 * requires them to agree, at the instants where a mistake would show: the
 * midnights, and the microsecond either side of them.
 *
 * Dhaka is UTC+6 with no daylight saving, so a shop day is always the same 24
 * hours of UTC. That is the fact the rewrite depends on, and the first test
 * pins it.
 */

let ctx: TestContext;
let db: Awaited<ReturnType<typeof loadDb>>;
let shopDayRange: (r: { from: string; to: string }) => { start: Date; end: Date };

async function loadDb() {
  const { getDb } = await import("../src/db/client.js");
  return getDb();
}

before(async () => {
  ctx = await startTestServer();
  db = await loadDb();

  const profit = await import("../src/modules/reports/profit.service.js");
  shopDayRange = profit.shopDayRange;

  /* A table of nothing but instants, so the two forms can be compared without
     dragging orders, stock and settings into it. */
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`create table if not exists instant_probe (at timestamptz not null)`);
});

after(async () => {
  await ctx.close();
});

/** Rows the OLD predicate keeps. */
async function oldWay(from: string, to: string): Promise<string[]> {
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute(sql`
    select at from instant_probe
     where (at at time zone 'Asia/Dhaka')::date between ${from}::date and ${to}::date
     order by at
  `);
  return rows.rows.map((row) => new Date(String(row.at)).toISOString());
}

/** Rows the NEW predicate keeps. */
async function newWay(from: string, to: string): Promise<string[]> {
  const { sql } = await import("drizzle-orm");
  const { start, end } = shopDayRange({ from, to });
  const rows = await db.execute(sql`
    select at from instant_probe
     where at >= ${start} and at < ${end}
     order by at
  `);
  return rows.rows.map((row) => new Date(String(row.at)).toISOString());
}

async function seed(instants: string[]): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`delete from instant_probe`);
  for (const at of instants) {
    await db.execute(sql`insert into instant_probe (at) values (${at})`);
  }
}

/* -------------------------------------------------------------------------- */

describe("report date filter — the two forms must agree", () => {
  it("puts a Dhaka day on the UTC hours it actually occupies", () => {
    const { start, end } = shopDayRange({ from: "2026-08-30", to: "2026-08-30" });

    /* 30 August in Dhaka begins at 18:00 UTC on the 29th and ends at 18:00 UTC
       on the 30th. If this ever stops being true — a country adopting daylight
       saving — the whole rewrite is invalid and this is the test that says so. */
    assert.equal(start.toISOString(), "2026-08-29T18:00:00.000Z");
    assert.equal(end.toISOString(), "2026-08-30T18:00:00.000Z");
  });

  it("agrees at the midnight that separates two days", async () => {
    await seed([
      "2026-08-29T17:59:59.000Z", // 29 Aug 23:59:59 Dhaka
      "2026-08-29T18:00:00.000Z", // 30 Aug 00:00:00 Dhaka
      "2026-08-30T17:59:59.000Z", // 30 Aug 23:59:59 Dhaka
      "2026-08-30T18:00:00.000Z", // 31 Aug 00:00:00 Dhaka
    ]);

    const range = { from: "2026-08-30", to: "2026-08-30" };
    const before = await oldWay(range.from, range.to);
    const after = await newWay(range.from, range.to);

    assert.deepEqual(after, before);
    /* And it is the right two, not merely the same two. */
    assert.deepEqual(after, ["2026-08-29T18:00:00.000Z", "2026-08-30T17:59:59.000Z"]);
  });

  it("keeps the last microsecond of the last day", async () => {
    /* The reason the new form is half-open. `<= '2026-08-30'` on a converted
       date happened to work; a naive `<= end-of-day at 23:59:59` would have
       dropped this row, and nobody would have noticed until a month's takings
       were one order short. */
    await seed(["2026-08-30T17:59:59.999999Z"]);

    const before = await oldWay("2026-08-30", "2026-08-30");
    const after = await newWay("2026-08-30", "2026-08-30");

    assert.equal(after.length, 1);
    assert.deepEqual(after, before);
  });

  it("agrees across a month boundary", async () => {
    await seed([
      "2026-07-31T17:59:59.000Z", // 31 Jul 23:59:59 Dhaka
      "2026-07-31T18:00:00.000Z", // 1 Aug 00:00:00 Dhaka
      "2026-08-31T17:59:59.000Z", // 31 Aug 23:59:59 Dhaka
      "2026-08-31T18:00:00.000Z", // 1 Sep 00:00:00 Dhaka
    ]);

    const before = await oldWay("2026-08-01", "2026-08-31");
    const after = await newWay("2026-08-01", "2026-08-31");

    assert.deepEqual(after, before);
    assert.equal(after.length, 2);
  });

  it("agrees on the hours that used to be reported as yesterday", async () => {
    /* Midnight to 6am Dhaka is the window the original UTC bug got wrong — a
       parcel delivered at 1am read as the previous day's income. Both forms
       must now agree that it belongs to today. */
    await seed([
      "2026-08-29T18:30:00.000Z", // 30 Aug 00:30 Dhaka
      "2026-08-29T20:00:00.000Z", // 30 Aug 02:00 Dhaka
      "2026-08-29T23:59:00.000Z", // 30 Aug 05:59 Dhaka
    ]);

    const before = await oldWay("2026-08-30", "2026-08-30");
    const after = await newWay("2026-08-30", "2026-08-30");

    assert.equal(after.length, 3);
    assert.deepEqual(after, before);
  });

  it("agrees when nothing falls inside the range", async () => {
    await seed(["2026-08-29T17:59:59.000Z", "2026-08-30T18:00:00.000Z"]);

    const before = await oldWay("2026-08-30", "2026-08-30");
    const after = await newWay("2026-08-30", "2026-08-30");

    assert.equal(after.length, 0);
    assert.deepEqual(after, before);
  });

  it("agrees across a whole span of instants, hour by hour", async () => {
    /* Sixty hours in one-hour steps across three Dhaka days. If any single hour
       lands on a different side of a boundary between the two forms, this
       catches it — which the hand-picked cases above might not. */
    const instants: string[] = [];
    const first = Date.parse("2026-08-28T12:00:00.000Z");
    for (let hour = 0; hour < 60; hour += 1) {
      instants.push(new Date(first + hour * 3_600_000).toISOString());
    }
    await seed(instants);

    for (const range of [
      { from: "2026-08-28", to: "2026-08-28" },
      { from: "2026-08-29", to: "2026-08-29" },
      { from: "2026-08-30", to: "2026-08-30" },
      { from: "2026-08-28", to: "2026-08-30" },
      { from: "2026-08-29", to: "2026-08-30" },
    ]) {
      const before = await oldWay(range.from, range.to);
      const after = await newWay(range.from, range.to);
      assert.deepEqual(
        after,
        before,
        `disagreed for ${range.from}..${range.to}`,
      );
    }
  });
});
