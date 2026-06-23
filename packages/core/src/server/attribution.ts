/**
 * First-touch referral attribution — server side.
 *
 * The browser captures an anonymous visitor's *first* landing context (referral
 * source, UTM params, referring host, landing path) and persists it across the
 * signup boundary in a first-party cookie named `an_ft` (see
 * `client/analytics.ts`). On signup, the auth hook reads that cookie off the
 * request and enriches the canonical server-side `signup` event so we can
 * measure where new users came from and how apps spread (virality).
 *
 * This module is intentionally pure and dependency-free so it is trivially
 * unit-testable and can never throw into the signup path. The single hard rule:
 * parsing untrusted cookie input must NEVER throw — every accessor is defensive.
 */

/**
 * The decoded first-touch attribution object. Mirrors the compact JSON the
 * client writes into the `an_ft` cookie / `an_attribution` localStorage key.
 * Every field is optional — the client omits empty fields to keep the cookie
 * small, and a malformed/absent cookie yields `null`.
 */
export interface FirstTouchAttribution {
  /** Referral source bucket, e.g. "clip_share", "plan_share". */
  ref?: string;
  /** Referrer's stable user id (the clip/plan owner who shared the link). */
  via?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  /** `window.location.pathname` of the first page the visitor landed on. */
  landing_path?: string;
  /** Host of `document.referrer` (scrubbed; host only, never a full URL). */
  landing_referrer?: string;
  /** ISO timestamp of when the visitor first landed. */
  landed_at?: string;
}

/** Cookie name written by the client (non-HttpOnly; non-sensitive). */
export const FIRST_TOUCH_COOKIE_NAME = "an_ft";

const STRING_FIELDS: Array<keyof FirstTouchAttribution> = [
  "ref",
  "via",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "landing_path",
  "landing_referrer",
  "landed_at",
];

/**
 * Parse a raw `Cookie:` header into a flat name→value map. Tolerates missing
 * input, extra whitespace, `=` inside values, and malformed pairs. Never throws.
 */
export function parseCookieHeader(
  cookieHeader: string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return out;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const rawValue = part.slice(eq + 1).trim();
    // First write wins so a duplicate cookie name can't clobber the first.
    if (name in out) continue;
    out[name] = rawValue;
  }
  return out;
}

/**
 * Decode a single cookie value into a `FirstTouchAttribution`. The value is the
 * URL-encoded compact JSON written by the client. Returns `null` for empty,
 * malformed, or non-object input. Only known string fields are copied through,
 * each clamped to a sane max length as a defense against an oversized cookie.
 */
export function decodeFirstTouchValue(
  value: string | null | undefined,
): FirstTouchAttribution | null {
  if (!value || typeof value !== "string") return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Not valid percent-encoding — fall back to the raw value and let the JSON
    // parse below decide whether it's usable.
    decoded = value;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const source = parsed as Record<string, unknown>;
  const result: FirstTouchAttribution = {};
  let any = false;
  for (const field of STRING_FIELDS) {
    const raw = source[field];
    if (typeof raw === "string" && raw.length > 0) {
      result[field] = raw.slice(0, 120);
      any = true;
    }
  }
  return any ? result : null;
}

/**
 * Read the `an_ft` first-touch attribution out of a raw `Cookie:` header.
 * Returns `null` when the cookie is absent or unparseable. Never throws.
 */
export function readFirstTouchAttribution(
  cookieHeader: string | null | undefined,
): FirstTouchAttribution | null {
  try {
    const cookies = parseCookieHeader(cookieHeader);
    return decodeFirstTouchValue(cookies[FIRST_TOUCH_COOKIE_NAME]);
  } catch {
    return null;
  }
}

function isExternalReferrerHost(host: string | undefined): boolean {
  const trimmed = host?.trim();
  return !!trimmed && trimmed.length > 0;
}

/**
 * Derive the `referral_source` bucket from first-touch attribution per the
 * contract:
 *   1. explicit `ref` wins;
 *   2. landing path under `/share/` => "clip_share";
 *   3. landing path that looks like a public plan page
 *      (contains `/p/`, `/plan/`, or `/share-plan/`) => "plan_share";
 *   4. a non-empty external referring host => "external";
 *   5. otherwise => "direct".
 */
export function deriveReferralSource(ft: FirstTouchAttribution | null): string {
  if (ft?.ref && ft.ref.trim()) return ft.ref.trim();
  const path = ft?.landing_path ?? "";
  if (path.startsWith("/share/")) return "clip_share";
  if (
    path.includes("/p/") ||
    path.includes("/plan/") ||
    path.includes("/share-plan/")
  ) {
    return "plan_share";
  }
  if (isExternalReferrerHost(ft?.landing_referrer)) return "external";
  return "direct";
}

/**
 * Compute the snake_case signup-event properties from first-touch attribution.
 * Returns a clean object with `undefined` values omitted, ready to merge into
 * the `signup` track call. Always sets `referral_source` (defaults to "direct").
 *
 * Pure and total — given any (or no) input it returns a well-formed object and
 * never throws.
 */
export function deriveSignupAttribution(
  ft: FirstTouchAttribution | null,
): Record<string, string> {
  const out: Record<string, string> = {
    referral_source: deriveReferralSource(ft),
  };
  if (!ft) return out;

  const setIf = (key: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  };

  setIf("referrer_user", ft.via);
  setIf("referral_medium", ft.utm_medium);
  setIf("referral_campaign", ft.utm_campaign);
  setIf("utm_source", ft.utm_source);
  setIf("utm_medium", ft.utm_medium);
  setIf("utm_campaign", ft.utm_campaign);
  setIf("utm_content", ft.utm_content);
  setIf("utm_term", ft.utm_term);
  setIf("first_touch_path", ft.landing_path);
  setIf("landing_referrer", ft.landing_referrer);

  return out;
}

/**
 * Convenience: read the cookie header and derive signup attribution in one
 * call. Never throws; falls back to `{ referral_source: "direct" }` on any
 * error.
 */
export function signupAttributionFromCookieHeader(
  cookieHeader: string | null | undefined,
): Record<string, string> {
  try {
    return deriveSignupAttribution(readFirstTouchAttribution(cookieHeader));
  } catch {
    return { referral_source: "direct" };
  }
}
