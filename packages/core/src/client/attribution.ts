import { hasAttributionSource } from "../shared/attribution-source.js";
import { isSyntheticTrafficValue } from "../shared/test-traffic.js";

const FIRST_TOUCH_STORAGE_KEY = "an_attribution";
const FIRST_TOUCH_COOKIE_NAME = "an_ft";
const FIRST_TOUCH_COOKIE_MAX_AGE_SECONDS = 2592000;
const FIRST_TOUCH_MAX_FIELD_LENGTH = 120;
const FIRST_TOUCH_MAX_COOKIE_BYTES = 1500;
const FIRST_TOUCH_QUERY_FIELDS = [
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
  "site_referrer",
  "site_landing_path",
] as const;
const FIRST_TOUCH_COOKIE_FIELD_PRIORITY = [
  "gclid",
  "msclkid",
  "vector_source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "ref",
  "via",
  "utm_content",
  "utm_term",
  "landing_path",
  "landing_referrer",
  "site_referrer",
  "site_landing_path",
  "landed_at",
] as const satisfies readonly (keyof FirstTouchAttribution)[];
const LAST_TOUCH_STORAGE_KEY = "an_last_touch";
const LAST_TOUCH_COOKIE_NAME = "an_lt";
// Small enough that both cookies still fit the signup handoff header.
const LAST_TOUCH_MAX_COOKIE_BYTES = 700;
// What a sourced visit keeps as last touch, besides its path and time.
const LAST_TOUCH_SOURCE_FIELDS = [
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
  "landing_referrer",
  "site_referrer",
] as const satisfies readonly (keyof LastTouchAttribution)[];
// Which fields the cookie keeps first when they don't all fit.
const LAST_TOUCH_COOKIE_FIELD_PRIORITY = [
  "ref",
  "gclid",
  "msclkid",
  "vector_source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "via",
  "utm_content",
  "utm_term",
  "landing_referrer",
  "site_referrer",
  "landing_path",
  "touched_at",
  "site_landing_path",
] as const satisfies readonly (keyof LastTouchAttribution)[];
// The marketing site forwards its own last touch under these names when it
// differs from the first touch it forwards as plain campaign params.
const FORWARDED_LAST_TOUCH_FIELDS = {
  last_ref: "ref",
  last_via: "via",
  last_utm_source: "utm_source",
  last_utm_medium: "utm_medium",
  last_utm_campaign: "utm_campaign",
  last_utm_content: "utm_content",
  last_utm_term: "utm_term",
  last_gclid: "gclid",
  last_msclkid: "msclkid",
  last_vector_source: "vector_source",
  last_referrer: "site_referrer",
  last_landing_path: "site_landing_path",
} as const satisfies Record<string, keyof LastTouchAttribution>;
// When the site's latest sourced visit happened, so an older site visit can't
// replace a newer one the app already has.
const FORWARDED_LAST_TOUCH_AT_PARAM = "last_at";

interface AttributionCookieSpec {
  name: string;
  maxBytes: number;
  priority: readonly string[];
}

const FIRST_TOUCH_COOKIE: AttributionCookieSpec = {
  name: FIRST_TOUCH_COOKIE_NAME,
  maxBytes: FIRST_TOUCH_MAX_COOKIE_BYTES,
  priority: FIRST_TOUCH_COOKIE_FIELD_PRIORITY,
};
const LAST_TOUCH_COOKIE: AttributionCookieSpec = {
  name: LAST_TOUCH_COOKIE_NAME,
  maxBytes: LAST_TOUCH_MAX_COOKIE_BYTES,
  priority: LAST_TOUCH_COOKIE_FIELD_PRIORITY,
};

let _firstTouchCaptured = false;

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

/** The latest visit that had a source; see `captureLastTouchAttribution`. */
export interface LastTouchAttribution {
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
  landing_referrer?: string;
  site_referrer?: string;
  site_landing_path?: string;
  landing_path?: string;
  touched_at?: string;
  capture_truncated?: string;
}

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private browsing / storage disabled — best-effort
  }
}

function truncateFirstTouchField(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, FIRST_TOUCH_MAX_FIELD_LENGTH);
}

function scrubReferrerHost(referrer: string | undefined): string {
  if (!referrer) return "";
  try {
    const url = new URL(referrer);
    const host = url.host;
    if (!host) return "";
    if (
      typeof window !== "undefined" &&
      host.toLowerCase() === window.location.host.toLowerCase()
    ) {
      return "";
    }
    return truncateFirstTouchField(host);
  } catch {
    return "";
  }
}

function buildFirstTouchAttribution(
  landingPathname: string,
): FirstTouchAttribution {
  const attribution: FirstTouchAttribution = {};
  let params: URLSearchParams | null = null;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    params = null;
  }
  if (params) {
    for (const field of FIRST_TOUCH_QUERY_FIELDS) {
      const value = truncateFirstTouchField(params.get(field));
      if (value) attribution[field] = value;
    }
  }
  const landingPath = truncateFirstTouchField(landingPathname);
  if (landingPath) attribution.landing_path = landingPath;
  const landingReferrer =
    typeof document !== "undefined" ? scrubReferrerHost(document.referrer) : "";
  if (landingReferrer) attribution.landing_referrer = landingReferrer;
  attribution.landed_at = new Date().toISOString();
  return attribution;
}

function readAttributionCookie(cookieName: string): string | null {
  if (typeof document === "undefined") return null;
  try {
    const cookies = document.cookie ? document.cookie.split(";") : [];
    for (const part of cookies) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const name = part.slice(0, eq).trim();
      if (name === cookieName) {
        return part.slice(eq + 1).trim();
      }
    }
  } catch {
    // document.cookie can throw in sandboxed iframes — best-effort.
  }
  return null;
}

function attributionCookieAssignment(
  cookieName: string,
  encodedValue: string,
): string {
  return (
    `${cookieName}=${encodedValue}; path=/; ` +
    `max-age=${FIRST_TOUCH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
  );
}

function fitAttributionCookieValue(
  value: string,
  spec: AttributionCookieSpec,
): string {
  const source = JSON.parse(value) as Record<string, unknown>;
  const compact: Record<string, string> = {};
  let truncated = false;
  const fits = (encoded: string) =>
    attributionCookieAssignment(spec.name, encoded).length <= spec.maxBytes;

  for (const field of spec.priority) {
    const rawValue = source[field];
    if (typeof rawValue !== "string" || !rawValue) continue;
    const candidate = {
      ...compact,
      [field]: rawValue.slice(0, FIRST_TOUCH_MAX_FIELD_LENGTH),
    };
    if (fits(encodeURIComponent(JSON.stringify(candidate)))) {
      compact[field] = candidate[field];
    } else {
      truncated = true;
    }
  }

  if (truncated) {
    compact.capture_truncated = "1";
    // Keep the auth handoff under its 4 KB header limit after re-encoding.
    for (const field of [...spec.priority].reverse()) {
      const encoded = encodeURIComponent(JSON.stringify(compact));
      if (fits(encoded)) return encoded;
      delete compact[field];
    }
  }

  const encoded = encodeURIComponent(JSON.stringify(compact));
  if (!fits(encoded)) {
    throw new Error(`Attribution exceeded the ${spec.name} cookie budget`);
  }
  return encoded;
}

function writeAttributionCookie(
  value: string,
  spec: AttributionCookieSpec,
): void {
  if (typeof document === "undefined") return;
  const encodedValue = fitAttributionCookieValue(value, spec);
  try {
    document.cookie = attributionCookieAssignment(spec.name, encodedValue);
  } catch {
    // best-effort
  }
}

function storeAttribution(
  storageKey: string,
  spec: AttributionCookieSpec,
  attribution: object,
): void {
  const json = JSON.stringify(attribution);
  safeStorageSet(storageKey, json);
  writeAttributionCookie(json, spec);
}

/**
 * Restore a cookie that expired or was cleared from its stored value, so the
 * signup boundary still sees it.
 */
function backfillAttributionCookie(
  storageKey: string,
  spec: AttributionCookieSpec,
): void {
  if (readAttributionCookie(spec.name)) return;
  const stored = safeStorageGet(storageKey);
  if (!stored) return;
  try {
    writeAttributionCookie(stored, spec);
  } catch {
    // coercion-ok: localStorage still holds the value; only this page's
    // signup handoff goes without it.
  }
}

/**
 * Capture the visitor's referral attribution once per page load, into both
 * `localStorage` and a first-party cookie the signup boundary reads. Fully
 * defensive and SSR-safe — any failure is swallowed so it can never break app
 * boot.
 *
 * First touch (`an_attribution` / `an_ft`) is first-write-wins, except over a
 * visit that had no source: the first visit that says where this person came
 * from replaces it. Without that, an untagged first visit would hide every
 * tagged visit after it.
 */
function captureFirstTouchAttribution(
  options: CaptureAttributionOptions,
): void {
  if (_firstTouchCaptured) return;
  _firstTouchCaptured = true;
  if (typeof window === "undefined") return;
  try {
    const current = buildFirstTouchAttribution(
      options.landingPath ?? window.location.pathname,
    );
    const existing = getFirstTouchAttribution();
    if (
      existing &&
      (hasAttributionSource(existing) || !hasAttributionSource(current))
    ) {
      backfillAttributionCookie(FIRST_TOUCH_STORAGE_KEY, FIRST_TOUCH_COOKIE);
    } else {
      storeAttribution(FIRST_TOUCH_STORAGE_KEY, FIRST_TOUCH_COOKIE, current);
    }
    captureLastTouchAttribution(current);
  } catch {
    // Attribution is best-effort telemetry; never let it break boot.
  }
}

/**
 * Last touch (`an_last_touch` / `an_lt`) is the latest visit that had a
 * source. When the marketing site forwards its own last touch, that visit is
 * the one to keep, not the site's first touch riding on the same link. A site
 * visit keeps the time it happened, and loses to a newer visit the app has
 * already recorded.
 */
function captureLastTouchAttribution(current: FirstTouchAttribution): void {
  const forwarded = readForwardedLastTouch();
  const source = forwarded ?? (hasAttributionSource(current) ? current : null);
  const forwardedAt = readForwardedLastTouchAt();
  const existing = getLastTouchAttribution();
  const existingAt = Date.parse(existing?.touched_at ?? "");
  if (
    !source ||
    (forwardedAt &&
      hasAttributionSource(existing) &&
      existingAt > Date.parse(forwardedAt))
  ) {
    backfillAttributionCookie(LAST_TOUCH_STORAGE_KEY, LAST_TOUCH_COOKIE);
    return;
  }
  const lastTouch: LastTouchAttribution = {};
  for (const field of LAST_TOUCH_SOURCE_FIELDS) {
    const value = source[field];
    if (value) lastTouch[field] = value;
  }
  // As for first touch, `landing_path` is where the visitor entered this app
  // and `site_landing_path` the marketing-site page the touch landed on.
  if (current.landing_path) lastTouch.landing_path = current.landing_path;
  if (source.site_landing_path) {
    lastTouch.site_landing_path = source.site_landing_path;
  }
  lastTouch.touched_at = forwardedAt ?? current.landed_at;
  storeAttribution(LAST_TOUCH_STORAGE_KEY, LAST_TOUCH_COOKIE, lastTouch);
}

function readForwardedLastTouchAt(): string | undefined {
  const raw = new URLSearchParams(window.location.search).get(
    FORWARDED_LAST_TOUCH_AT_PARAM,
  );
  const time = Date.parse(raw ?? "");
  // A visit can't be in the future; a bad clock or value means "now".
  if (!Number.isFinite(time) || time > Date.now()) return undefined;
  return new Date(time).toISOString();
}

function readForwardedLastTouch(): LastTouchAttribution | null {
  const params = new URLSearchParams(window.location.search);
  const forwarded: LastTouchAttribution = {};
  for (const [param, field] of Object.entries(FORWARDED_LAST_TOUCH_FIELDS)) {
    const value = truncateFirstTouchField(params.get(param));
    if (value) forwarded[field] = value;
  }
  return hasAttributionSource(forwarded) ? forwarded : null;
}

function readStoredAttribution<T>(storageKey: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = safeStorageGet(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export function getFirstTouchAttribution(): FirstTouchAttribution | null {
  return readStoredAttribution<FirstTouchAttribution>(FIRST_TOUCH_STORAGE_KEY);
}

export function getLastTouchAttribution(): LastTouchAttribution | null {
  return readStoredAttribution<LastTouchAttribution>(LAST_TOUCH_STORAGE_KEY);
}

export interface CaptureAttributionOptions {
  /**
   * The app path this visit entered, when the page isn't it. The sign-in page
   * stands in front of the path the visitor asked for, and `landing_path`
   * must name that path, not the sign-in page.
   */
  landingPath?: string;
}

/**
 * Store the visitor's first and last touch now instead of in
 * `configureTracking()`, for a page that reads them before tracking starts,
 * or that never starts tracking, like the sign-in page. It runs once per page
 * load, so tracking's own capture is then a no-op.
 */
export function captureAttribution(
  options: CaptureAttributionOptions = {},
): void {
  if (isSyntheticBrowserTraffic()) return;
  captureFirstTouchAttribution(options);
}

function isSyntheticBrowserTraffic(): boolean {
  return (
    typeof window !== "undefined" &&
    isSyntheticTrafficValue(window.__AGENT_NATIVE_SYNTHETIC_TRAFFIC__)
  );
}
