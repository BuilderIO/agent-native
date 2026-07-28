/**
 * Country reference data for the Nomad app.
 *
 * Pure data — safe to import from both server actions and client components.
 * Every ISO 3166-1 country is supported everywhere (pickers, stays, rules,
 * map): names come from `Intl.DisplayNames` in the caller's locale, flags are
 * computed from regional-indicator codepoints, and `presetsForCountry()`
 * falls back to a sensible generic rule when a country has no curated preset.
 *
 * `CURATED` adds richer defaults (well-known visa/tax rules) for countries
 * nomads track most. Presets are starting points the user can edit — not
 * legal advice.
 */

import type { RuleKind } from "./types";

export interface RulePreset {
  /** Stable slug so re-running onboarding never duplicates a rule. */
  slug: string;
  name: string;
  kind: RuleKind;
  zone?: string;
  limitDays: number;
  windowDays?: number;
  description: string;
  /** Only seeded when the user marked this country as their fiscal home / PR. */
  fiscalHomeOnly?: boolean;
  prOnly?: boolean;
}

/** All 29 Schengen-area member states. */
export const SCHENGEN_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "CH",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

/**
 * ISO 3166-1 numeric → alpha-2, covering every assigned country code. Keys
 * match the feature ids in `world-atlas` TopoJSON, so the world map can
 * resolve any clicked country to the same alpha-2 codes the rest of the app
 * uses. Values double as the canonical list of selectable countries.
 */
export const ISO_ALPHA2_BY_NUMERIC: Record<string, string> = {
  "004": "AF",
  "008": "AL",
  "012": "DZ",
  "016": "AS",
  "020": "AD",
  "024": "AO",
  "028": "AG",
  "031": "AZ",
  "032": "AR",
  "036": "AU",
  "040": "AT",
  "044": "BS",
  "048": "BH",
  "050": "BD",
  "051": "AM",
  "052": "BB",
  "056": "BE",
  "060": "BM",
  "064": "BT",
  "068": "BO",
  "070": "BA",
  "072": "BW",
  "076": "BR",
  "084": "BZ",
  "090": "SB",
  "092": "VG",
  "096": "BN",
  "100": "BG",
  "104": "MM",
  "108": "BI",
  "112": "BY",
  "116": "KH",
  "120": "CM",
  "124": "CA",
  "132": "CV",
  "136": "KY",
  "140": "CF",
  "144": "LK",
  "148": "TD",
  "152": "CL",
  "156": "CN",
  "158": "TW",
  "170": "CO",
  "174": "KM",
  "175": "YT",
  "178": "CG",
  "180": "CD",
  "184": "CK",
  "188": "CR",
  "191": "HR",
  "192": "CU",
  "196": "CY",
  "203": "CZ",
  "204": "BJ",
  "208": "DK",
  "212": "DM",
  "214": "DO",
  "218": "EC",
  "222": "SV",
  "226": "GQ",
  "231": "ET",
  "232": "ER",
  "233": "EE",
  "238": "FK",
  "242": "FJ",
  "246": "FI",
  "250": "FR",
  "254": "GF",
  "258": "PF",
  "260": "TF",
  "262": "DJ",
  "266": "GA",
  "268": "GE",
  "270": "GM",
  "275": "PS",
  "276": "DE",
  "288": "GH",
  "292": "GI",
  "296": "KI",
  "300": "GR",
  "304": "GL",
  "308": "GD",
  "312": "GP",
  "316": "GU",
  "320": "GT",
  "324": "GN",
  "328": "GY",
  "332": "HT",
  "336": "VA",
  "340": "HN",
  "344": "HK",
  "348": "HU",
  "352": "IS",
  "356": "IN",
  "360": "ID",
  "364": "IR",
  "368": "IQ",
  "372": "IE",
  "376": "IL",
  "380": "IT",
  "384": "CI",
  "388": "JM",
  "392": "JP",
  "398": "KZ",
  "400": "JO",
  "404": "KE",
  "408": "KP",
  "410": "KR",
  "414": "KW",
  "417": "KG",
  "418": "LA",
  "422": "LB",
  "426": "LS",
  "428": "LV",
  "430": "LR",
  "434": "LY",
  "438": "LI",
  "440": "LT",
  "442": "LU",
  "446": "MO",
  "450": "MG",
  "454": "MW",
  "458": "MY",
  "462": "MV",
  "466": "ML",
  "470": "MT",
  "474": "MQ",
  "478": "MR",
  "480": "MU",
  "484": "MX",
  "492": "MC",
  "496": "MN",
  "498": "MD",
  "499": "ME",
  "500": "MS",
  "504": "MA",
  "508": "MZ",
  "512": "OM",
  "516": "NA",
  "520": "NR",
  "524": "NP",
  "528": "NL",
  "540": "NC",
  "548": "VU",
  "554": "NZ",
  "558": "NI",
  "562": "NE",
  "566": "NG",
  "570": "NU",
  "574": "NF",
  "578": "NO",
  "580": "MP",
  "581": "UM",
  "583": "FM",
  "584": "MH",
  "585": "PW",
  "586": "PK",
  "591": "PA",
  "598": "PG",
  "600": "PY",
  "604": "PE",
  "608": "PH",
  "612": "PN",
  "616": "PL",
  "620": "PT",
  "624": "GW",
  "626": "TL",
  "630": "PR",
  "634": "QA",
  "638": "RE",
  "642": "RO",
  "643": "RU",
  "646": "RW",
  "652": "BL",
  "654": "SH",
  "659": "KN",
  "660": "AI",
  "662": "LC",
  "663": "MF",
  "666": "PM",
  "670": "VC",
  "674": "SM",
  "678": "ST",
  "682": "SA",
  "686": "SN",
  "688": "RS",
  "690": "SC",
  "694": "SL",
  "702": "SG",
  "703": "SK",
  "704": "VN",
  "705": "SI",
  "706": "SO",
  "710": "ZA",
  "716": "ZW",
  "724": "ES",
  "728": "SS",
  "729": "SD",
  "732": "EH",
  "740": "SR",
  "744": "SJ",
  "748": "SZ",
  "752": "SE",
  "756": "CH",
  "760": "SY",
  "762": "TJ",
  "764": "TH",
  "768": "TG",
  "772": "TK",
  "776": "TO",
  "780": "TT",
  "784": "AE",
  "788": "TN",
  "792": "TR",
  "795": "TM",
  "796": "TC",
  "798": "TV",
  "800": "UG",
  "804": "UA",
  "807": "MK",
  "818": "EG",
  "826": "GB",
  "831": "GG",
  "832": "JE",
  "833": "IM",
  "834": "TZ",
  "840": "US",
  "850": "VI",
  "854": "BF",
  "858": "UY",
  "860": "UZ",
  "862": "VE",
  "876": "WF",
  "882": "WS",
  "887": "YE",
  "894": "ZM",
};

export const ALL_COUNTRY_CODES: string[] = [
  ...new Set(Object.values(ISO_ALPHA2_BY_NUMERIC)),
].sort();

const tax183 = (code: string, name: string): RulePreset => ({
  slug: `${code.toLowerCase()}-183-day-tax`,
  name: `${name} — 183-day tax`,
  kind: "calendar-year",
  limitDays: 183,
  description: "Physical presence in a calendar year triggers tax residency",
});

export const SCHENGEN_PRESET: RulePreset = {
  slug: "schengen-90-180",
  name: "Schengen 90/180",
  kind: "rolling-window",
  zone: "schengen",
  limitDays: 90,
  windowDays: 180,
  description: "Rolling 180-day window across all Schengen states",
};

interface CuratedCountry {
  code: string;
  rulePresets: RulePreset[];
}

const CURATED: CuratedCountry[] = [
  {
    code: "CA",
    rulePresets: [
      tax183("CA", "Canada"),
      {
        slug: "ca-pr-presence",
        name: "Canadian PR — presence",
        kind: "presence-minimum",
        limitDays: 730,
        windowDays: 1825,
        description: "730 days within any rolling 5-year period",
        prOnly: true,
      },
    ],
  },
  {
    code: "US",
    rulePresets: [
      {
        slug: "us-substantial-presence",
        name: "US — substantial presence",
        kind: "calendar-year",
        limitDays: 183,
        description:
          "Substantial-presence test (simplified calendar-year count)",
      },
      {
        slug: "us-green-card-presence",
        name: "US green card — presence",
        kind: "presence-minimum",
        limitDays: 913,
        windowDays: 1825,
        description: "Keep meaningful US ties (~6 months/year heuristic)",
        prOnly: true,
      },
    ],
  },
  {
    code: "MX",
    rulePresets: [
      {
        slug: "mx-visitor-180",
        name: "Mexico — 180-day visitor",
        kind: "rolling-window",
        limitDays: 180,
        windowDays: 365,
        description: "Visitor permit cap (simplified rolling year)",
      },
    ],
  },
  {
    code: "BR",
    rulePresets: [
      {
        slug: "br-visitor-90-180",
        name: "Brazil — 90/180 visitor",
        kind: "rolling-window",
        limitDays: 90,
        windowDays: 180,
        description: "90 days per rolling 180 for visa-exempt visitors",
      },
    ],
  },
  { code: "GB", rulePresets: [tax183("GB", "UK")] },
  {
    code: "GE",
    rulePresets: [
      {
        slug: "ge-365-visa-free",
        name: "Georgia — 1-year visa-free",
        kind: "rolling-window",
        limitDays: 365,
        windowDays: 365,
        description: "Full visa-free year for most passports",
      },
    ],
  },
  {
    code: "AE",
    rulePresets: [
      {
        slug: "ae-183-day-certificate",
        name: "UAE — 183-day certificate",
        kind: "calendar-year",
        limitDays: 183,
        description: "Days needed for a UAE tax-residency certificate",
      },
    ],
  },
  {
    code: "TH",
    rulePresets: [
      tax183("TH", "Thailand"),
      {
        slug: "th-dtv-180",
        name: "DTV visa — 180-day stay cap",
        kind: "rolling-window",
        limitDays: 180,
        windowDays: 365,
        description: "Per-entry stay cap (simplified rolling year)",
      },
    ],
  },
  {
    code: "JP",
    rulePresets: [
      {
        slug: "jp-90-180-visitor",
        name: "Japan — 90/180 visitor",
        kind: "rolling-window",
        limitDays: 90,
        windowDays: 180,
        description: "Temporary-visitor allowance (simplified)",
      },
    ],
  },
  {
    code: "ID",
    rulePresets: [
      tax183("ID", "Indonesia"),
      {
        slug: "id-b211-180",
        name: "Indonesia — visit-visa cap",
        kind: "rolling-window",
        limitDays: 180,
        windowDays: 365,
        description: "Visit-visa stay allowance (simplified rolling year)",
      },
    ],
  },
];

const curatedByCode = new Map(CURATED.map((c) => [c.code, c]));

/** Countries offered as one-tap shortcuts before searching. */
export const POPULAR_CODES = [
  "PT",
  "ES",
  "TH",
  "MX",
  "AE",
  "DE",
  "GB",
  "US",
  "CA",
  "JP",
  "ID",
  "GE",
];

export function isSchengen(code: string): boolean {
  return SCHENGEN_CODES.has(code.toUpperCase());
}

export function isKnownCountry(code: string): boolean {
  return ALL_COUNTRY_CODES.includes(code.toUpperCase());
}

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

function displayNames(locale: string): Intl.DisplayNames | null {
  if (!displayNamesCache.has(locale)) {
    try {
      displayNamesCache.set(
        locale,
        new Intl.DisplayNames([locale], { type: "region" }),
      );
    } catch {
      displayNamesCache.set(locale, null);
    }
  }
  return displayNamesCache.get(locale) ?? null;
}

/** Localized country name for ANY ISO alpha-2 code (falls back to the code). */
export function countryName(code: string, locale = "en"): string {
  const upper = code.toUpperCase();
  try {
    const name = displayNames(locale)?.of(upper);
    if (name && name !== upper) return name;
  } catch {
    // Unknown region codes throw RangeError — fall through to the code.
  }
  return upper;
}

/** Flag emoji computed from regional-indicator codepoints — works for any code. */
export function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "🌍";
  return String.fromCodePoint(
    ...[...upper].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

/**
 * Default rule presets for a country: curated ones when we have them, plus
 * the Schengen zone rule for member states, plus a generic 183-day
 * tax-residency counter for everywhere else — so tracking ANY country arms a
 * sensible, editable rule.
 */
export function presetsForCountry(code: string): RulePreset[] {
  const upper = code.toUpperCase();
  const presets: RulePreset[] = [];
  if (isSchengen(upper)) presets.push(SCHENGEN_PRESET);
  const curated = curatedByCode.get(upper);
  if (curated) {
    presets.push(...curated.rulePresets);
  } else {
    presets.push(tax183(upper, countryName(upper)));
  }
  return presets;
}
