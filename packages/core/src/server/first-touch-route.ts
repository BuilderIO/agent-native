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
  decodeLastTouchValue,
  encodeFirstTouchServerCookieValue,
  parseCookieHeader,
  type FirstTouchAttribution,
} from "./attribution.js";
import { requestAllowsConsentCategory } from "./consent-route.js";
import {
  getForwardedRequestOrigin,
  isSameOriginPost,
} from "./request-origin.js";

const MAX_BODY_BYTES = 8 * 1024;
/** How long the browser's own `an_ft` and `an_lt` copies last. */
const BROWSER_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const BROWSER_COOKIES = [
  { name: FIRST_TOUCH_COOKIE_NAME, decode: decodeFirstTouchValue },
  { name: LAST_TOUCH_COOKIE_NAME, decode: decodeLastTouchValue },
];
// What `encodeURIComponent` emits, so a value echoed into Set-Cookie can't
// carry an attribute or a header break.
const ENCODED_COOKIE_VALUE = /^[A-Za-z0-9\-_.!~*'()%]{1,1500}$/;

export type FirstTouchSyncResult =
  | { stored: true; firstTouch: FirstTouchAttribution }
  | { stored: false; reason: "consent_required" | "expired" };

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

/**
 * Safari keeps a cookie page JavaScript wrote for seven days at most, so write
 * the browser's own `an_ft` and `an_lt` again from here, for their full 30
 * days. Only values that decode as touches are echoed back.
 */
function resetBrowserCookies(event: H3Event): void {
  const cookies = parseCookieHeader(getHeader(event, "cookie"));
  for (const { name, decode } of BROWSER_COOKIES) {
    const value = cookies[name];
    if (!value || !ENCODED_COOKIE_VALUE.test(value) || !decode(value)) {
      continue;
    }
    appendResponseHeader(
      event,
      "set-cookie",
      `${name}=${value}; Max-Age=${BROWSER_COOKIE_MAX_AGE_SECONDS}; ${cookieAttributes(event)}`,
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
 * nothing and clears every attribution cookie. Elsewhere it also writes the
 * browser's `an_ft` and `an_lt` again, so Safari keeps them their 30 days.
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

    resetBrowserCookies(event);
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
