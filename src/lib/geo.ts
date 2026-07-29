import type { DeliveryZone } from "@/types";

/**
 * Delivery-zone resolution from free-typed area text.
 *
 * WHY THIS FILE IS CAREFUL
 * ------------------------
 * A naive `text.includes("dhaka")` check is wrong in both directions and each
 * mistake costs real money at the doorstep:
 *
 *   false negative  "Dhanmondi" / "Mirpur 10" / "Uttara Sector 7"
 *                   → inside Dhaka, but the word "Dhaka" never appears.
 *   false positive  "Savar, Dhaka" / "Keraniganj, Dhaka" / "Tongi, Gazipur"
 *                   → contains "Dhaka" (they are in Dhaka *district*) but
 *                     couriers bill these at the outside-city rate.
 *
 * So the order of checks below is deliberate: district-level exclusions are
 * tested BEFORE the inside-Dhaka area list, which is tested before the generic
 * "contains dhaka" fallback.
 *
 * IMPORTANT: this only ever produces a *suggestion*. The zone stored on the
 * order is whatever the customer confirmed in the UI. See `ZoneSelector`.
 */

/* -------------------------------------------------------------------------- */
/* Reference data                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Inside Dhaka City Corporation (DNCC + DSCC), plus the neighbourhood names
 * customers actually type — people write "Banasree", not "Rampura Thana".
 */
const INSIDE_DHAKA = [
  // Thanas
  "adabor", "badda", "bangshal", "banani", "bimanbandar", "cantonment",
  "chalkbazar", "chawkbazar", "dakshinkhan", "darus salam", "demra",
  "dhanmondi", "gendaria", "gulshan", "hazaribagh", "jatrabari", "kadamtali",
  "kafrul", "kalabagan", "kamrangirchar", "khilgaon", "khilkhet", "kotwali",
  "lalbagh", "mirpur", "mohammadpur", "motijheel", "mugda", "new market",
  "newmarket", "pallabi", "paltan", "ramna", "rampura", "rupnagar",
  "sabujbagh", "shah ali", "shahbagh", "sher e bangla nagar", "shahjahanpur",
  "shyampur", "sutrapur", "tejgaon", "turag", "uttara", "uttarkhan", "vatara",
  "bhatara", "wari", "bhashantek", "hatirjheel", "gulshan 1", "gulshan 2",

  // Neighbourhoods and landmarks people type instead of a thana
  "agargaon", "aftabnagar", "azimpur", "banasree", "baridhara", "bashundhara",
  "bosundhara", "dohs", "elephant road", "eskaton", "farmgate", "gabtoli",
  "green road", "ibrahimpur", "islampur", "jigatola", "kakrail", "kallyanpur",
  "kalyanpur", "kazipara", "kuril", "lalmatia", "malibagh", "manikdi",
  "maghbazar", "moghbazar", "mohakhali", "monipur", "mouchak", "nakhalpara",
  "niketan", "nikunja", "panthapath", "pink city", "purbachal road",
  "segunbagicha", "shantinagar", "shewrapara", "shukrabad", "shyamoli",
  "sobhanbagh", "tolarbagh", "shahjadpur", "nadda", "notun bazar",
  "natun bazar", "merul", "meradia", "goran", "basabo", "bashabo",
  "dholaikhal", "postogola", "zigatola", "science lab", "kathalbagan",
  "mohanagar", "north badda", "south badda", "middle badda", "west dhanmondi",
  "old dhaka", "purana paltan", "dilkusha", "arambagh", "fakirapool",
  "gopibagh", "swamibagh", "tikatuli", "narinda", "bakshibazar",
  "chankharpul", "polashi", "nilkhet", "katabon", "hatirpool", "kawran bazar",
  "karwan bazar", "tejkunipara", "mohammadia housing", "adabar", "sheikhertek",
  "chandrima", "ring road", "college gate", "asad gate", "mirpur dohs",
  "baridhara dohs", "banani dohs", "diabari", "rupnagar r a", "duaripara",
];

/**
 * In Dhaka *district* or adjacent, but billed at the outside-Dhaka rate by
 * every major courier. These must be tested first — most of them are written
 * with ", Dhaka" appended by customers.
 */
const OUTSIDE_OVERRIDES = [
  "savar", "ashulia", "dhamrai", "keraniganj", "kerani ganj", "dohar",
  "nawabganj", "hemayetpur", "birulia", "amin bazar", "aminbazar", "zirabo",
  "nabinagar", "baipail", "jirani", "gazipur", "tongi", "board bazar",
  "chowrasta", "konabari", "kaliakair", "sreepur", "kapasia", "kaliganj",
  "narayanganj", "narayangonj", "siddhirganj", "fatullah", "rupganj",
  "araihazar", "sonargaon", "bandar", "munshiganj", "munshigonj",
  "manikganj", "manikgonj", "narsingdi", "purbachal",
];

/** All 64 districts. Anything matching here that isn't Dhaka city is outside. */
const DISTRICTS = [
  "bagerhat", "bandarban", "barguna", "barisal", "barishal", "bhola", "bogra",
  "bogura", "brahmanbaria", "chandpur", "chapainawabganj", "chattogram",
  "chittagong", "chuadanga", "comilla", "cumilla", "coxs bazar", "cox bazar",
  "dinajpur", "faridpur", "feni", "gaibandha", "gazipur", "gopalganj",
  "habiganj", "jamalpur", "jessore", "jashore", "jhalokati", "jhenaidah",
  "joypurhat", "khagrachari", "khulna", "kishoreganj", "kurigram", "kushtia",
  "lakshmipur", "lalmonirhat", "madaripur", "magura", "manikganj", "meherpur",
  "moulvibazar", "munshiganj", "mymensingh", "naogaon", "narail",
  "narayanganj", "narsingdi", "natore", "netrokona", "nilphamari", "noakhali",
  "pabna", "panchagarh", "patuakhali", "pirojpur", "rajbari", "rajshahi",
  "rangamati", "rangpur", "satkhira", "shariatpur", "sherpur", "sirajganj",
  "sunamganj", "sylhet", "tangail", "thakurgaon",
];

/**
 * Bangla script → the Latin token we already match on. Customers switch
 * keyboards mid-address constantly, so this is not an edge case.
 */
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

/** Misspellings common enough to be worth hardcoding. */
const ALIASES: Record<string, string> = {
  dacca: "dhaka",
  daka: "dhaka",
  dhakha: "dhaka",
  dahka: "dhaka",
  dhaca: "dhaka",
  dkaka: "dhaka",
  dhanmandi: "dhanmondi",
  dhanmondhi: "dhanmondi",
  danmondi: "dhanmondi",
  mirpore: "mirpur",
  mirpure: "mirpur",
  uttora: "uttara",
  uttar: "uttara",
  gulsan: "gulshan",
  gushan: "gulshan",
  bananee: "banani",
  mohakhalii: "mohakhali",
  savarr: "savar",
  shavar: "savar",
  sabar: "savar",
  narayangang: "narayanganj",
  gazipour: "gazipur",
};

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

function normalize(input: string): string {
  let text = input.toLowerCase();

  // Replace Bangla words before stripping non-Latin characters.
  for (const [bn, en] of Object.entries(BANGLA_MAP)) {
    if (text.includes(bn)) text = text.replaceAll(bn, ` ${en} `);
  }

  return text
    // Apostrophes are deleted, not spaced — "Cox's Bazar" must normalise to
    // "coxs bazar", not "cox s bazar".
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ") // punctuation, remaining Bangla, dashes
    .replace(/\b(thana|upazila|upazilla|po|p o|dist|district|area|road|rd|block|sector|house|flat)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyAliases(text: string): string {
  return text
    .split(" ")
    .map((token) => ALIASES[token] ?? token)
    .join(" ");
}

/** True when `needle` appears in `haystack` on word boundaries. */
function hasPhrase(haystack: string, needle: string): boolean {
  if (needle.includes(" ")) return haystack.includes(needle);
  return new RegExp(`(^|\\s)${needle}(\\s|$|\\d)`).test(haystack);
}

function findMatch(text: string, list: string[]): string | undefined {
  // Longest entries first so "north badda" wins over "badda".
  return [...list]
    .sort((a, b) => b.length - a.length)
    .find((entry) => hasPhrase(text, entry));
}

/** Title-cases a matched token for display back to the customer. */
function label(match: string): string {
  return match
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export interface ZoneSuggestion {
  zone: DeliveryZone;
  /** The token we matched on, shown so the customer can sanity-check us. */
  matched: string;
  /** How much to trust it. "low" still renders, but nudges manual selection. */
  confidence: "high" | "low";
}

/**
 * Suggest a delivery zone from free text. Returns null when nothing matches,
 * in which case the UI must ask the customer to pick manually.
 */
export function suggestZone(areaText: string): ZoneSuggestion | null {
  const raw = normalize(areaText);
  if (raw.length < 3) return null;
  const text = applyAliases(raw);

  // 1. Dhaka-district-but-outside-city names win over everything.
  const override = findMatch(text, OUTSIDE_OVERRIDES);
  if (override) {
    return { zone: "outside_dhaka", matched: label(override), confidence: "high" };
  }

  // 2. Known inside-Dhaka thanas and neighbourhoods.
  const inside = findMatch(text, INSIDE_DHAKA);
  if (inside) {
    return { zone: "inside_dhaka", matched: label(inside), confidence: "high" };
  }

  // 3. Any other district → outside.
  const district = findMatch(text, DISTRICTS);
  if (district) {
    return { zone: "outside_dhaka", matched: label(district), confidence: "high" };
  }

  // 4. Bare "dhaka" with no recognisable area. Probably inside the city, but
  //    we flag it low-confidence so the UI asks for confirmation.
  if (hasPhrase(text, "dhaka")) {
    return { zone: "inside_dhaka", matched: "Dhaka", confidence: "low" };
  }

  return null;
}

/** Autocomplete source for the area field. */
export function searchAreas(query: string, limit = 6): string[] {
  const q = normalize(query);
  if (q.length < 2) return [];

  const pool = [
    ...INSIDE_DHAKA.map((a) => ({ name: label(a), suffix: "Dhaka" })),
    ...OUTSIDE_OVERRIDES.map((a) => ({ name: label(a), suffix: "" })),
    ...DISTRICTS.map((a) => ({ name: label(a), suffix: "" })),
  ];

  const seen = new Set<string>();
  const results: string[] = [];

  // Prefix matches rank above substring matches.
  for (const pass of [0, 1]) {
    for (const { name, suffix } of pool) {
      const lower = name.toLowerCase();
      const isMatch = pass === 0 ? lower.startsWith(q) : lower.includes(q);
      if (!isMatch) continue;

      const display = suffix && lower !== suffix.toLowerCase() ? `${name}, ${suffix}` : name;
      if (seen.has(display)) continue;
      seen.add(display);
      results.push(display);
      if (results.length >= limit) return results;
    }
  }

  return results;
}
