/**
 * Cookie consent for the regions that need it. The regions and categories
 * follow builder.io's consent banner: visitors in these countries opt in, and
 * every other visitor is tracked as before, with no banner.
 */

/**
 * Countries that see the banner: builder.io's "GDPR" rule, i.e. the EU, the
 * rest of the EEA, Monaco, San Marino, Åland and France's overseas regions.
 * The UK and Switzerland are not on it, matching builder.io.
 */
const CONSENT_REGION_COUNTRY_CODES = new Set([
  "AT",
  "AX",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GF",
  "GP",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MC",
  "MF",
  "MQ",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RE",
  "RO",
  "SE",
  "SI",
  "SK",
  "SM",
  "YT",
]);

/** The IANA zones of those countries, for a request with no country header. */
const CONSENT_REGION_TIME_ZONES = new Set([
  "Africa/Ceuta",
  "America/Cayenne",
  "America/Guadeloupe",
  "America/Marigot",
  "America/Martinique",
  "Asia/Famagusta",
  "Asia/Nicosia",
  "Atlantic/Azores",
  "Atlantic/Canary",
  "Atlantic/Madeira",
  "Atlantic/Reykjavik",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Bratislava",
  "Europe/Brussels",
  "Europe/Bucharest",
  "Europe/Budapest",
  "Europe/Busingen",
  "Europe/Copenhagen",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Lisbon",
  "Europe/Ljubljana",
  "Europe/Luxembourg",
  "Europe/Madrid",
  "Europe/Malta",
  "Europe/Mariehamn",
  "Europe/Monaco",
  "Europe/Nicosia",
  "Europe/Oslo",
  "Europe/Paris",
  "Europe/Prague",
  "Europe/Riga",
  "Europe/Rome",
  "Europe/San_Marino",
  "Europe/Sofia",
  "Europe/Stockholm",
  "Europe/Tallinn",
  "Europe/Vaduz",
  "Europe/Vienna",
  "Europe/Vilnius",
  "Europe/Warsaw",
  "Europe/Zagreb",
  "Indian/Mayotte",
  "Indian/Reunion",
  "CET",
  "EET",
  "Eire",
  "Iceland",
  "MET",
  "Poland",
  "Portugal",
  "WET",
]);

/** For the inline bootstrap the server writes into each page. */
export const CONSENT_REGION_TIME_ZONE_LIST: readonly string[] = [
  ...CONSENT_REGION_TIME_ZONES,
];

export function isConsentRegionCountry(code: string | null | undefined) {
  return CONSENT_REGION_COUNTRY_CODES.has(code?.trim().toUpperCase() ?? "");
}

export function isConsentRegionTimeZone(timeZone: string | null | undefined) {
  return !!timeZone && CONSENT_REGION_TIME_ZONES.has(timeZone);
}

/**
 * What the banner asks about. `performance` covers analytics (Google
 * Analytics, Amplitude); `targeting` covers advertising and attribution (Tag
 * Manager's ad tags, the referral attribution cookies). Strictly necessary
 * cookies need no consent.
 */
export type ConsentCategory = "performance" | "targeting";

export type ConsentChoice = Record<ConsentCategory, boolean>;

/** `consent` shows the banner; `none` tracks as before. */
export type ConsentRegion = "consent" | "none";

export const CONSENT_COOKIE_NAME = "an_consent";
/** Asked again a year later, like builder.io. */
export const CONSENT_COOKIE_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
export const CONSENT_REGION_PATH = "/_agent-native/auth/consent-region";

const CONSENT_COOKIE_VERSION = "1";

/** `1.p1.t0`: version, then one flag per category. */
export function serializeConsent(choice: ConsentChoice): string {
  return [
    CONSENT_COOKIE_VERSION,
    `p${choice.performance ? 1 : 0}`,
    `t${choice.targeting ? 1 : 0}`,
  ].join(".");
}

/** The stored choice, or `null` when there is none this version can read. */
export function parseConsent(
  value: string | null | undefined,
): ConsentChoice | null {
  const match = /^1\.p([01])\.t([01])$/.exec(value?.trim() ?? "");
  if (!match) return null;
  return { performance: match[1] === "1", targeting: match[2] === "1" };
}
