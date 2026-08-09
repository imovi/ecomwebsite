import type { DeliveryZone } from "../../db/schema/order-enums.js";

/**
 * Delivery zone resolution from free-typed area text.
 *
 * WHY THIS IS NOT `text.includes("dhaka")`
 * ----------------------------------------
 * A substring check is wrong in both directions, and every mistake costs real
 * money at the doorstep:
 *
 *   false negative  "Dhanmondi", "Mirpur 10", "Uttara Sector 7"
 *                   → inside Dhaka, but the word "Dhaka" never appears.
 *   false positive  "Savar, Dhaka", "Keraniganj, Dhaka", "Tongi, Gazipur"
 *                   → contain "Dhaka" (they are in Dhaka *district*) but every
 *                     courier bills them at the outside-city rate.
 *
 * So the check order below is deliberate: district-level exclusions are tested
 * BEFORE the inside-Dhaka list, which is tested before the generic fallback.
 *
 * IMPORTANT: this produces a *suggestion*. The zone stored on an order is the
 * one the caller confirmed. Checkout accepts an explicit `deliveryZone`; this
 * resolver fills it in when the client did not, and powers the quote endpoint
 * so a customer sees the charge before committing.
 */

/** Inside Dhaka City Corporation, plus the neighbourhood names people type. */
const INSIDE_DHAKA = [
  "adabor", "adabar", "badda", "bangshal", "banani", "bimanbandar", "cantonment",
  "chalkbazar", "chawkbazar", "dakshinkhan", "darus salam", "demra", "dhanmondi",
  "gendaria", "gulshan", "hazaribagh", "jatrabari", "kadamtali", "kafrul",
  "kalabagan", "kamrangirchar", "khilgaon", "khilkhet", "kotwali", "lalbagh",
  "mirpur", "mohammadpur", "motijheel", "mugda", "new market", "newmarket",
  "pallabi", "paltan", "ramna", "rampura", "rupnagar", "sabujbagh", "shah ali",
  "shahbagh", "sher e bangla nagar", "shahjahanpur", "shyampur", "sutrapur",
  "tejgaon", "turag", "uttara", "uttarkhan", "vatara", "bhatara", "wari",
  "bhashantek", "hatirjheel",

  "agargaon", "aftabnagar", "azimpur", "banasree", "baridhara", "bashundhara",
  "bosundhara", "dohs", "elephant road", "eskaton", "farmgate", "gabtoli",
  "green road", "ibrahimpur", "islampur", "jigatola", "kakrail", "kallyanpur",
  "kalyanpur", "kazipara", "kuril", "lalmatia", "malibagh", "manikdi",
  "maghbazar", "moghbazar", "mohakhali", "monipur", "mouchak", "nakhalpara",
  "niketan", "nikunja", "panthapath", "segunbagicha", "shantinagar",
  "shewrapara", "shukrabad", "shyamoli", "sobhanbagh", "tolarbagh",
  "shahjadpur", "nadda", "notun bazar", "natun bazar", "merul", "meradia",
  "goran", "basabo", "bashabo", "dholaikhal", "postogola", "zigatola",
  "science lab", "kathalbagan", "north badda", "south badda", "middle badda",
  "old dhaka", "purana paltan", "dilkusha", "arambagh", "fakirapool",
  "gopibagh", "swamibagh", "tikatuli", "narinda", "bakshibazar", "chankharpul",
  "polashi", "nilkhet", "katabon", "hatirpool", "kawran bazar", "karwan bazar",
  "tejkunipara", "sheikhertek", "chandrima", "ring road", "college gate",
  "asad gate", "mirpur dohs", "baridhara dohs", "banani dohs", "diabari",
  "duaripara",
];

/**
 * In or beside Dhaka district, but billed at the outside-city rate.
 *
 * These must be tested first — customers almost always write them with
 * ", Dhaka" appended.
 */
const OUTSIDE_OVERRIDES = [
  "savar", "ashulia", "dhamrai", "keraniganj", "kerani ganj", "dohar",
  "nawabganj", "hemayetpur", "birulia", "amin bazar", "aminbazar", "zirabo",
  "nabinagar", "baipail", "jirani", "gazipur", "tongi", "board bazar",
  "chowrasta", "konabari", "kaliakair", "sreepur", "kapasia", "kaliganj",
  "narayanganj", "narayangonj", "siddhirganj", "fatullah", "rupganj",
  "araihazar", "sonargaon", "bandar", "munshiganj", "munshigonj", "manikganj",
  "manikgonj", "narsingdi", "purbachal",
];

/** All 64 districts. Anything here that is not Dhaka city is outside. */
const DISTRICTS = [
  "bagerhat", "bandarban", "barguna", "barisal", "barishal", "bhola", "bogra",
  "bogura", "brahmanbaria", "chandpur", "chapainawabganj", "chattogram",
  "chittagong", "chuadanga", "comilla", "cumilla", "coxs bazar", "cox bazar",
  "dinajpur", "faridpur", "feni", "gaibandha", "gazipur", "gopalganj",
  "habiganj", "jamalpur", "jessore", "jashore", "jhalokati", "jhenaidah",
  "joypurhat", "khagrachari", "khulna", "kishoreganj", "kurigram", "kushtia",
  "lakshmipur", "lalmonirhat", "madaripur", "magura", "manikganj", "meherpur",
  "moulvibazar", "munshiganj", "mymensingh", "naogaon", "narail", "narayanganj",
  "narsingdi", "natore", "netrokona", "nilphamari", "noakhali", "pabna",
  "panchagarh", "patuakhali", "pirojpur", "rajbari", "rajshahi", "rangamati",
  "rangpur", "satkhira", "shariatpur", "sherpur", "sirajganj", "sunamganj",
  "sylhet", "tangail", "thakurgaon",
];

/** Customers switch keyboards mid-address constantly; this is not an edge case. */
const BANGLA_MAP: Record<string, string> = {
  "ঢাকা": "dhaka",
  "ধানমন্ডি": "dhanmondi",
  "মিরপুর": "mirpur",
  "উত্তরা": "uttara",
  "গুলশান": "gulshan",
  "বনানী": "banani",
  "মোহাম্মদপুর": "mohammadpur",
  "বাড্ডা": "badda",
  "যাত্রাবাড়ী": "jatrabari",
  "মতিঝিল": "motijheel",
  "তেজগাঁও": "tejgaon",
  "রামপুরা": "rampura",
  "খিলগাঁও": "khilgaon",
  "বসুন্ধরা": "bashundhara",
  "সাভার": "savar",
  "গাজীপুর": "gazipur",
  "নারায়ণগঞ্জ": "narayanganj",
  "টঙ্গী": "tongi",
  "কেরানীগঞ্জ": "keraniganj",
  "চট্টগ্রাম": "chattogram",
  "সিলেট": "sylhet",
  "রাজশাহী": "rajshahi",
  "খুলনা": "khulna",
  "বরিশাল": "barishal",
  "রংপুর": "rangpur",
  "ময়মনসিংহ": "mymensingh",
  "কুমিল্লা": "cumilla",
  "নরসিংদী": "narsingdi",
  "মুন্সিগঞ্জ": "munshiganj",
};

/** Misspellings frequent enough to be worth hardcoding. */
const ALIASES: Record<string, string> = {
  dacca: "dhaka", daka: "dhaka", dhakha: "dhaka", dahka: "dhaka",
  dhaca: "dhaka", dkaka: "dhaka",
  dhanmandi: "dhanmondi", dhanmondhi: "dhanmondi", danmondi: "dhanmondi",
  mirpore: "mirpur", mirpure: "mirpur",
  uttora: "uttara", uttar: "uttara",
  gulsan: "gulshan", gushan: "gulshan",
  bananee: "banani",
  savarr: "savar", shavar: "savar", sabar: "savar",
  narayangang: "narayanganj", gazipour: "gazipur",
};

/* -------------------------------------------------------------------------- */

const CONTROL_AND_PUNCT = new RegExp("['’`]", "g");

function normalize(input: string): string {
  let text = input.toLowerCase();

  for (const [bengali, latin] of Object.entries(BANGLA_MAP)) {
    if (text.includes(bengali)) text = text.replaceAll(bengali, ` ${latin} `);
  }

  return text
    /* Apostrophes are deleted, not spaced: "Cox's Bazar" must normalise to
       "coxs bazar" to match the district list, not "cox s bazar". */
    .replace(CONTROL_AND_PUNCT, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(thana|upazila|upazilla|po|p o|dist|district|area|road|rd|block|sector|house|flat)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function applyAliases(text: string): string {
  return text
    .split(" ")
    .map((token) => ALIASES[token] ?? token)
    .join(" ");
}

function hasPhrase(haystack: string, needle: string): boolean {
  if (needle.includes(" ")) return haystack.includes(needle);
  return new RegExp(`(^|\\s)${needle}(\\s|$|\\d)`).test(haystack);
}

function findMatch(text: string, list: string[]): string | undefined {
  /* Longest first, so "north badda" wins over "badda". */
  return [...list]
    .sort((a, b) => b.length - a.length)
    .find((entry) => hasPhrase(text, entry));
}

function label(match: string): string {
  return match
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface ZoneSuggestion {
  zone: DeliveryZone;
  /** The token matched, so a UI can show the customer what we recognised. */
  matched: string;
  /** `low` means "probably right, but confirm" — a bare "Dhaka" with no area. */
  confidence: "high" | "low";
}

/**
 * Suggests a delivery zone. Returns null when nothing is recognised, in which
 * case the caller must supply the zone explicitly.
 */
export function suggestDeliveryZone(areaText: string): ZoneSuggestion | null {
  const raw = normalize(areaText);
  if (raw.length < 3) return null;
  const text = applyAliases(raw);

  /* 1. Dhaka-district-but-outside-city names beat everything else. */
  const override = findMatch(text, OUTSIDE_OVERRIDES);
  if (override) {
    return { zone: "outside_dhaka", matched: label(override), confidence: "high" };
  }

  /* 2. Known inside-Dhaka thanas and neighbourhoods. */
  const inside = findMatch(text, INSIDE_DHAKA);
  if (inside) {
    return { zone: "inside_dhaka", matched: label(inside), confidence: "high" };
  }

  /* 3. Any other district. */
  const district = findMatch(text, DISTRICTS);
  if (district) {
    return { zone: "outside_dhaka", matched: label(district), confidence: "high" };
  }

  /* 4. Bare "dhaka" with no recognisable area — probably the city, but say so. */
  if (hasPhrase(text, "dhaka")) {
    return { zone: "inside_dhaka", matched: "Dhaka", confidence: "low" };
  }

  return null;
}

/**
 * The city an order belongs to, as a plain lowercase token.
 *
 * For ad platforms, which match a customer on a CITY and not on the line of an
 * address. `area_text` is whatever the customer typed — "Dhanmondi 27, Dhaka",
 * "savar,dhaka", "কুমিল্লা" — and handing that over raw matches nothing at all,
 * because the receiving end lowercases it, strips the spaces and compares the
 * result to a list of real city names. `dhanmondi27dhaka` is on no such list.
 *
 * So it is resolved through the same normalisation the zone suggestion uses,
 * which already knows the sixty-four districts, the Bangla spellings and the
 * usual misspellings.
 *
 * Inside Dhaka the answer is always "dhaka" whatever neighbourhood was written:
 * Gulshan is not a city, it is part of one. Outside, the district IS the city
 * for this purpose — that is the granularity a courier and an ad platform both
 * work at.
 *
 * Returns null rather than guessing. An unmatched city is a field better left
 * off the event than filled with something that cannot be true.
 */
export function resolveCity(areaText: string, zone: DeliveryZone): string | null {
  if (zone === "inside_dhaka") return "dhaka";

  const raw = normalize(areaText);
  if (raw.length < 3) return null;
  const text = applyAliases(raw);

  /* A district named outright wins — it is the most specific thing the
     customer could have written. */
  const district = findMatch(text, DISTRICTS);
  if (district) return district;

  /* Otherwise a town from the outside-overrides list. Several of those ARE
     districts (Gazipur, Narayanganj, Munshiganj); the rest — Savar, Ashulia,
     Tongi — are real towns an ad platform knows by name, so they are worth
     sending as they stand. */
  const override = findMatch(text, OUTSIDE_OVERRIDES);
  if (override) return override;

  return null;
}

/** Autocomplete source for an address field. */
export function searchAreas(query: string, limit = 8): string[] {
  const normalized = normalize(query);
  if (normalized.length < 2) return [];

  const pool = [
    ...INSIDE_DHAKA.map((area) => ({ name: label(area), suffix: "Dhaka" })),
    ...OUTSIDE_OVERRIDES.map((area) => ({ name: label(area), suffix: "" })),
    ...DISTRICTS.map((area) => ({ name: label(area), suffix: "" })),
  ];

  const seen = new Set<string>();
  const results: string[] = [];

  /* Prefix matches rank above substring matches. */
  for (const pass of [0, 1]) {
    for (const { name, suffix } of pool) {
      const lower = name.toLowerCase();
      const matches = pass === 0 ? lower.startsWith(normalized) : lower.includes(normalized);
      if (!matches) continue;

      const display = suffix && lower !== suffix.toLowerCase() ? `${name}, ${suffix}` : name;
      if (seen.has(display)) continue;
      seen.add(display);
      results.push(display);
      if (results.length >= limit) return results;
    }
  }

  return results;
}
