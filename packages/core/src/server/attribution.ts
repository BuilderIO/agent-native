import {
  ANALYTICS_ANONYMOUS_ID_COOKIE_NAME,
  ANALYTICS_ANONYMOUS_ID_MAX_LENGTH,
  normalizeAnalyticsAnonymousId,
} from "../shared/analytics-anonymous-id.js";
import { shareLandingSource } from "../shared/attribution-source.js";

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
 * The browser also keeps the visitor's *last* visit that had a source in an
 * `an_lt` cookie. First touch answers "how did they find us?" and credits
 * acquisition; last touch answers "what brought them to sign up?" and credits
 * the post, video, or person that converted them.
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
  ref?: string;
  via?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  msclkid?: string;
  vector_source?: string;
  landing_path?: string;
  landing_referrer?: string;
  site_referrer?: string;
  site_landing_path?: string;
  landed_at?: string;
  capture_truncated?: string;
}

/** The decoded `an_lt` cookie: the latest visit that had a source. */
export interface LastTouchAttribution {
  ref?: string;
  via?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  landing_referrer?: string;
  site_referrer?: string;
  landing_path?: string;
  touched_at?: string;
}

export type SignupOrigin =
  | "browser_signup"
  /** The framework's Google OAuth callback owns this event. */
  | "google_oauth"
  /** Federated SSO provisioning an identity into a sibling app. */
  | "sso_jit";

export interface SignupAttributionContext {
  attribution: Record<string, string>;
  anonymousId?: string;
}

export const SIGNUP_ATTRIBUTION_HEADER_NAME =
  "x-agent-native-signup-attribution";
const SIGNUP_ATTRIBUTION_HEADER_MAX_LENGTH = 4096;

export const FIRST_TOUCH_COOKIE_NAME = "an_ft";
export const LAST_TOUCH_COOKIE_NAME = "an_lt";

const STRING_FIELDS: Array<keyof FirstTouchAttribution> = [
  "ref",
  "via",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "msclkid",
  "vector_source",
  "landing_path",
  "landing_referrer",
  "site_referrer",
  "site_landing_path",
  "landed_at",
  "capture_truncated",
];

const LAST_TOUCH_STRING_FIELDS: Array<keyof LastTouchAttribution> = [
  "ref",
  "via",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "landing_referrer",
  "site_referrer",
  "landing_path",
  "touched_at",
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

export function decodeFirstTouchValue(
  value: string | null | undefined,
): FirstTouchAttribution | null {
  return decodeAttributionCookieValue(value, STRING_FIELDS);
}

export function decodeLastTouchValue(
  value: string | null | undefined,
): LastTouchAttribution | null {
  return decodeAttributionCookieValue(value, LAST_TOUCH_STRING_FIELDS);
}

function decodeAttributionCookieValue<T extends object>(
  value: string | null | undefined,
  fields: ReadonlyArray<keyof T & string>,
): T | null {
  if (!value || typeof value !== "string") return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
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
  const result: Record<string, string> = {};
  let any = false;
  for (const field of fields) {
    const raw = source[field];
    if (typeof raw === "string" && raw.length > 0) {
      result[field] = raw.slice(0, 120);
      any = true;
    }
  }
  return any ? (result as T) : null;
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

/**
 * Read the `an_lt` last-touch attribution out of a raw `Cookie:` header.
 * Returns `null` when the cookie is absent or unparseable. Never throws.
 */
export function readLastTouchAttribution(
  cookieHeader: string | null | undefined,
): LastTouchAttribution | null {
  const cookies = parseCookieHeader(cookieHeader);
  return decodeLastTouchValue(cookies[LAST_TOUCH_COOKIE_NAME]);
}

export function readAnalyticsAnonymousId(
  cookieHeader: string | null | undefined,
): string | undefined {
  try {
    return normalizeAnalyticsAnonymousId(
      parseCookieHeader(cookieHeader)[ANALYTICS_ANONYMOUS_ID_COOKIE_NAME],
    );
  } catch {
    return undefined;
  }
}

function isExternalReferrerHost(host: string | undefined): boolean {
  const trimmed = host?.trim();
  return !!trimmed && trimmed.length > 0;
}

export function deriveReferralSource(
  ft: FirstTouchAttribution | LastTouchAttribution | null,
): string {
  if (ft?.ref && ft.ref.trim()) return ft.ref.trim();
  const shareSource = shareLandingSource(ft?.landing_path);
  if (shareSource) return shareSource;
  if (
    isExternalReferrerHost(ft?.landing_referrer) ||
    isExternalReferrerHost(ft?.site_referrer)
  ) {
    return "external";
  }
  return "direct";
}

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
  setIf("gclid", ft.gclid);
  setIf("msclkid", ft.msclkid);
  setIf("vector_source", ft.vector_source);
  setIf("first_touch_path", ft.landing_path);
  setIf("landing_referrer", ft.landing_referrer);
  setIf("site_referrer", ft.site_referrer);
  setIf("site_landing_path", ft.site_landing_path);
  if (ft.capture_truncated === "1") out.attribution_truncated = "true";

  return out;
}

export function deriveLastTouchAttribution(
  lt: LastTouchAttribution | null,
): Record<string, string> {
  if (!lt) return {};
  const out: Record<string, string> = {
    last_touch_source: deriveReferralSource(lt),
  };
  const setIf = (key: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  };

  setIf("last_touch_ref", lt.ref);
  setIf("last_touch_utm_source", lt.utm_source);
  setIf("last_touch_utm_medium", lt.utm_medium);
  setIf("last_touch_utm_campaign", lt.utm_campaign);
  setIf("last_touch_utm_content", lt.utm_content);
  setIf("last_touch_referrer", lt.landing_referrer);
  setIf("last_touch_site_referrer", lt.site_referrer);
  setIf("last_touch_path", lt.landing_path);
  setIf("last_touch_at", lt.touched_at);

  return out;
}

/**
 * Add last touch only while the handoff still fits its header. An oversized
 * header is dropped whole, which would lose first touch with it.
 */
function withLastTouchAttribution(
  attribution: Record<string, string>,
  lt: LastTouchAttribution | null,
): Record<string, string> {
  const lastTouch = deriveLastTouchAttribution(lt);
  if (Object.keys(lastTouch).length === 0) return attribution;
  const merged = { ...attribution, ...lastTouch };
  const largest = encodeSignupAttributionContext({
    attribution: merged,
    anonymousId: "a".repeat(ANALYTICS_ANONYMOUS_ID_MAX_LENGTH),
  });
  if (largest.length <= SIGNUP_ATTRIBUTION_HEADER_MAX_LENGTH) return merged;
  return { ...attribution, last_touch_truncated: "true" };
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
    return withLastTouchAttribution(
      deriveSignupAttribution(readFirstTouchAttribution(cookieHeader)),
      readLastTouchAttribution(cookieHeader),
    );
  } catch {
    return { referral_source: "direct" };
  }
}

/**
 * Capture all browser attribution needed by the server-side signup event.
 * Keep this as one boundary helper so every signup entry point carries the
 * same values into Better Auth's user-create hook.
 *
 * Returns `undefined` when the request carried neither cookie. A browser that
 * ran our client script always has `an_ft`, so "no cookies at all" means no
 * browser — a server-side backfill or provisioning call. Reporting that as
 * `referral_source: "direct"` is the coercion that made this metric unusable:
 * it renders "we never saw a visitor" identical to "a visitor arrived with no
 * campaign", and only the second one is direct traffic.
 */
export function signupAttributionContextFromCookieHeader(
  cookieHeader: string | null | undefined,
): SignupAttributionContext | undefined {
  const firstTouch = readFirstTouchAttribution(cookieHeader);
  const lastTouch = readLastTouchAttribution(cookieHeader);
  const anonymousId = readAnalyticsAnonymousId(cookieHeader);
  if (!firstTouch && !lastTouch && !anonymousId) return undefined;
  return {
    attribution: withLastTouchAttribution(
      deriveSignupAttribution(firstTouch),
      lastTouch,
    ),
    ...(anonymousId ? { anonymousId } : {}),
  };
}

export function encodeSignupAttributionContext(
  context: SignupAttributionContext,
): string {
  return encodeURIComponent(JSON.stringify(context));
}

export function decodeSignupAttributionContext(
  value: string | null | undefined,
): SignupAttributionContext | undefined {
  if (!value || value.length > SIGNUP_ATTRIBUTION_HEADER_MAX_LENGTH) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Record<
      string,
      unknown
    >;
    const rawAttribution = parsed?.attribution;
    if (
      !rawAttribution ||
      typeof rawAttribution !== "object" ||
      Array.isArray(rawAttribution)
    ) {
      return undefined;
    }
    const attribution: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(rawAttribution)) {
      if (
        /^[A-Za-z0-9_]+$/.test(key) &&
        key.length <= 64 &&
        typeof rawValue === "string" &&
        rawValue.length > 0
      ) {
        attribution[key] = rawValue.slice(0, 120);
      }
    }
    if (Object.keys(attribution).length === 0) return undefined;
    const anonymousId = normalizeAnalyticsAnonymousId(parsed?.anonymousId);
    return {
      attribution,
      ...(anonymousId ? { anonymousId } : {}),
    };
  } catch (error) {
    void error;
    return undefined;
  }
}

/**
 * Stamp the explicit handoff onto a Better Auth request/API header set.
 *
 * This is the only writer of the handoff header, and it always writes: with a
 * context it sets ours, without one it deletes whatever was there. The header
 * is unsigned and outranks the request cookie when the hook reads it, so an
 * inbound copy from the public internet is an attacker-supplied `anonymous_id`
 * and campaign for someone else's signup row. Never merge — replace.
 */
export function addSignupAttributionHeader(
  headers: HeadersInit | undefined,
  context: SignupAttributionContext | undefined,
): Headers {
  const result = new Headers(headers);
  if (!context) {
    result.delete(SIGNUP_ATTRIBUTION_HEADER_NAME);
    return result;
  }
  result.set(
    SIGNUP_ATTRIBUTION_HEADER_NAME,
    encodeSignupAttributionContext(context),
  );
  return result;
}

export function signupAttributionContextFromHeaders(
  headers: Headers | null | undefined,
): SignupAttributionContext | undefined {
  return decodeSignupAttributionContext(
    headers?.get(SIGNUP_ATTRIBUTION_HEADER_NAME),
  );
}
