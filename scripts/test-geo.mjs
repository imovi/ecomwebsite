/**
 * Sanity checks for the delivery-zone resolver.
 *
 *   node --experimental-strip-types scripts/test-geo.mjs
 *
 * These are the cases that cost money if they regress: neighbourhoods that
 * don't contain the word "Dhaka", and places that do contain it but are billed
 * at the outside-city rate.
 */

import { suggestZone, searchAreas } from "../src/lib/geo.ts";

const CASES = [
  // Inside Dhaka city, no "Dhaka" in the string.
  ["Dhanmondi 27", "inside_dhaka"],
  ["Mirpur 10, Block C", "inside_dhaka"],
  ["Uttara Sector 7", "inside_dhaka"],
  ["Bashundhara R/A, Block K", "inside_dhaka"],
  ["banasree block D", "inside_dhaka"],
  ["Mohakhali DOHS", "inside_dhaka"],
  ["shyamoli", "inside_dhaka"],
  ["Gulshan 2", "inside_dhaka"],

  // Contains "Dhaka" but must NOT be billed as inside.
  ["Savar, Dhaka", "outside_dhaka"],
  ["Keraniganj, Dhaka", "outside_dhaka"],
  ["Ashulia, Dhaka", "outside_dhaka"],
  ["Dhamrai, Dhaka", "outside_dhaka"],
  ["Tongi, Gazipur", "outside_dhaka"],
  ["Narayanganj Sadar", "outside_dhaka"],

  // Other districts.
  ["Chattogram, Agrabad", "outside_dhaka"],
  ["Sylhet Sadar", "outside_dhaka"],
  ["Cox's Bazar", "outside_dhaka"],
  ["Bogura", "outside_dhaka"],

  // Bangla script.
  ["ধানমন্ডি, ঢাকা", "inside_dhaka"],
  ["সাভার, ঢাকা", "outside_dhaka"],
  ["চট্টগ্রাম", "outside_dhaka"],
  ["মিরপুর ১০", "inside_dhaka"],

  // Misspellings.
  ["Dhanmondhi, Daka", "inside_dhaka"],
  ["shavar", "outside_dhaka"],
  ["mirpore 12", "inside_dhaka"],

  // Bare city name — low confidence but still inside.
  ["Dhaka", "inside_dhaka"],

  // Unrecognisable — must return null so the UI asks the customer.
  ["asdfgh", null],
  ["", null],
];

let failed = 0;

for (const [input, expected] of CASES) {
  const result = suggestZone(input);
  const actual = result?.zone ?? null;
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${JSON.stringify(input).padEnd(28)} → ${
      actual ?? "null"
    }${result ? `  (matched "${result.matched}", ${result.confidence})` : ""}${
      ok ? "" : `   EXPECTED ${expected ?? "null"}`
    }`,
  );
}

console.log("\nAutocomplete samples:");
for (const q of ["dha", "mir", "utt", "sav", "chat"]) {
  console.log(`  ${q.padEnd(6)} → ${searchAreas(q).join(" | ")}`);
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
process.exit(failed ? 1 : 0);
