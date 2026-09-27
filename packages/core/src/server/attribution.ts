import {
  ANALYTICS_ANONYMOUS_ID_COOKIE_NAME,
  normalizeAnalyticsAnonymousId,
} from "../shared/analytics-anonymous-id.js";

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
  ref?: string;
  via?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  landing_path?: string;
  landing_referrer?: string;
  landed_at?: string;
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

export function decodeFirstTouchValue(
  value: string | null | undefined,
): FirstTouchAttribution | null {
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

export function deriveReferralSource(ft: FirstTouchAttribution | null): string {
  if (ft?.ref && ft.ref.trim()) return ft.ref.trim();
  const path = ft?.landing_path ?? "";
  if (path.startsWith("/share/")) return "clip_share";
  if (
    path.includes("/p/") ||
    path.includes("/plan/") ||
    path.includes("/plans/") ||
    path.includes("/recaps/") ||
    path.includes("/share-plan/")
  ) {
    return "plan_share";
  }
  if (isExternalReferrerHost(ft?.landing_referrer)) return "external";
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
  const anonymousId = readAnalyticsAnonymousId(cookieHeader);
  if (!firstTouch && !anonymousId) return undefined;
  return {
    attribution: deriveSignupAttribution(firstTouch),
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
