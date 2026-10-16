import {
  defineEventHandler,
  getHeader,
  getMethod,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";

import {
  CONSENT_COOKIE_NAME,
  isConsentRegionCountry,
  parseConsent,
  type ConsentCategory,
} from "../shared/consent.js";
import { parseCookieHeader } from "./attribution.js";

/** The visitor's country from the host's geo header, if it sent one. */
export function requestCountry(event: H3Event): string | undefined {
  const direct =
    getHeader(event, "x-country") ??
    getHeader(event, "cf-ipcountry") ??
    getHeader(event, "x-vercel-ip-country");
  if (direct) return direct;
  const geo = getHeader(event, "x-nf-geo");
  if (!geo) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(geo, "base64").toString("utf8"));
    const code = parsed?.country?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    // coercion-ok: an unreadable geo header is an unknown country; the
    // browser falls back to its time zone.
    return undefined;
  }
}

/**
 * Whether this request may store `category` cookies: always outside the
 * consent region, and inside it only once the visitor opted in.
 */
export function requestAllowsConsentCategory(
  event: H3Event,
  category: ConsentCategory,
): boolean {
  if (!isConsentRegionCountry(requestCountry(event))) return true;
  const consent = parseConsent(
    parseCookieHeader(getHeader(event, "cookie"))[CONSENT_COOKIE_NAME],
  );
  return consent?.[category] === true;
}

/**
 * `GET /_agent-native/auth/consent-region`: `consent` when the visitor's
 * country gets the banner, `none` when it doesn't, `unknown` when the host
 * sent no country. The SSR shell is cached for everyone, so the browser asks
 * here instead of reading it from the page.
 */
export function createConsentRegionHandler() {
  return defineEventHandler((event) => {
    setResponseHeader(event, "cache-control", "no-store");
    if (getMethod(event) !== "GET") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }
    const country = requestCountry(event);
    if (!country) return { region: "unknown" };
    return { region: isConsentRegionCountry(country) ? "consent" : "none" };
  });
}
