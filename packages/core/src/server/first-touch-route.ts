import {
  appendResponseHeader,
  defineEventHandler,
  getHeader,
  getMethod,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";

import {
  FIRST_TOUCH_SERVER_COOKIE_NAME,
  firstTouchServerExpiry,
  preferFirstTouch,
} from "../shared/first-touch-persistence.js";
import {
  FIRST_TOUCH_COOKIE_NAME,
  LAST_TOUCH_COOKIE_NAME,
  decodeFirstTouchServerValue,
  decodeFirstTouchValue,
  encodeFirstTouchServerCookieValue,
  parseCookieHeader,
  type FirstTouchAttribution,
} from "./attribution.js";
import { requestAllowsConsentCategory } from "./consent-route.js";
import { getForwardedRequestOrigin } from "./request-origin.js";

const MAX_BODY_BYTES = 8 * 1024;

export type FirstTouchSyncResult =
  | { stored: true; firstTouch: FirstTouchAttribution }
  | { stored: false; reason: "consent_required" | "expired" };

// Stricter than `isSameOriginRequest`: a request with neither header, or from
// a desktop shell's origin, can't prove it came from this site's pages.
function isSameOriginPost(event: H3Event): boolean {
  const fetchSite = getHeader(event, "sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const origin = getHeader(event, "origin");
  return !!origin && origin === getForwardedRequestOrigin(event);
}

function cookieAttributes(event: H3Event): string {
  const secure = getForwardedRequestOrigin(event).startsWith("https:");
  return `Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function clearAttributionCookies(event: H3Event): void {
  for (const name of [
    FIRST_TOUCH_SERVER_COOKIE_NAME,
    FIRST_TOUCH_COOKIE_NAME,
    LAST_TOUCH_COOKIE_NAME,
  ]) {
    appendResponseHeader(
      event,
      "set-cookie",
      `${name}=; Max-Age=0; ${cookieAttributes(event)}`,
    );
  }
}

function readCandidate(body: string): FirstTouchAttribution | null {
  const parsed = JSON.parse(body) as { firstTouch?: unknown };
  if (!parsed?.firstTouch || typeof parsed.firstTouch !== "object") {
    return null;
  }
  return decodeFirstTouchValue(JSON.stringify(parsed.firstTouch));
}

/**
 * `POST /_agent-native/auth/attribution` with `{ firstTouch }`: keep the
 * browser's first touch in the year-long `an_fts` cookie. Anyone may call it,
 * signed in or not, but only from this origin. The value already in the
 * cookie wins unless `preferFirstTouch` picks the new one, so a slow request
 * from another tab can't replace a better first touch it never saw. Where the
 * banner applies and the visitor hasn't accepted targeting cookies, it stores
 * nothing and clears every attribution cookie.
 */
export function createFirstTouchHandler() {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, "cache-control", "no-store");
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }
    if (!isSameOriginPost(event)) {
      setResponseStatus(event, 403);
      return { error: "Cross-origin request" };
    }
    if (Number(getHeader(event, "content-length") ?? 0) > MAX_BODY_BYTES) {
      setResponseStatus(event, 413);
      return { error: "Body too large" };
    }
    const body = (await readRawBody(event)) ?? "";
    if (body.length > MAX_BODY_BYTES) {
      setResponseStatus(event, 413);
      return { error: "Body too large" };
    }

    if (!requestAllowsConsentCategory(event, "targeting")) {
      clearAttributionCookies(event);
      return {
        stored: false,
        reason: "consent_required",
      } satisfies FirstTouchSyncResult;
    }

    let candidate: FirstTouchAttribution | null;
    try {
      candidate = readCandidate(body);
    } catch {
      setResponseStatus(event, 400);
      return { error: "Invalid JSON" };
    }
    if (!candidate) {
      setResponseStatus(event, 400);
      return { error: "Missing firstTouch" };
    }

    const existing = decodeFirstTouchServerValue(
      parseCookieHeader(getHeader(event, "cookie"))[
        FIRST_TOUCH_SERVER_COOKIE_NAME
      ],
    );
    const firstTouch = preferFirstTouch(existing, candidate)!;
    const expires = firstTouchServerExpiry(firstTouch);
    if (!expires) {
      return {
        stored: false,
        reason: "expired",
      } satisfies FirstTouchSyncResult;
    }
    if (firstTouch !== existing) {
      appendResponseHeader(
        event,
        "set-cookie",
        `${FIRST_TOUCH_SERVER_COOKIE_NAME}=${encodeFirstTouchServerCookieValue(firstTouch)}; ` +
          `Expires=${expires.toUTCString()}; ${cookieAttributes(event)}`,
      );
    }
    return { stored: true, firstTouch } satisfies FirstTouchSyncResult;
  });
}
