import type { H3Event } from "h3";
import {
  defineEventHandler,
  getCookie,
  getHeader,
  getMethod,
  setCookie,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  getConfiguredAppBasePath,
  normalizeAppBasePath,
} from "./app-base-path.js";
import { getSession } from "./auth.js";
import { getH3App } from "./framework-request-handler.js";
import { publicFrameworkPath } from "./framework-route-prefix.js";
import {
  signShortLivedToken,
  verifyShortLivedToken,
} from "./short-lived-token.js";

export const UI_ACTION_CAPABILITY_COOKIE = "agent-native-ui-capability";
export const UI_ACTION_CAPABILITY_PATH = "/ui-capability";

const UI_ACTION_CAPABILITY_RESOURCE = "ui-action";
const UI_ACTION_CAPABILITY_TTL_SECONDS = 10 * 60;
const mountedApps = new WeakSet<object>();

function normalizedEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function isHttpsRequest(event: H3Event): boolean {
  const forwarded = getHeader(event, "x-forwarded-proto");
  if (forwarded?.split(",")[0]?.trim() === "https") return true;
  return event.url?.protocol === "https:";
}

function capabilityCookiePath(appBasePath?: string): string {
  return publicFrameworkPath(
    `${normalizeAppBasePath(appBasePath ?? getConfiguredAppBasePath())}/_agent-native/actions`,
  );
}

export function hasUiActionCapability(
  event: H3Event,
  ownerEmail?: string,
): boolean {
  try {
    const verified = verifyShortLivedToken(
      getCookie(event, UI_ACTION_CAPABILITY_COOKIE) ?? "",
      UI_ACTION_CAPABILITY_RESOURCE,
    );
    if (!verified.ok) return false;
    const expectedOwner = normalizedEmail(ownerEmail);
    return (
      !expectedOwner || normalizedEmail(verified.viewerEmail) === expectedOwner
    );
  } catch {
    // coercion-ok: an invalid capability must fail closed as unauthorized.
    return false;
  }
}

async function issueUiActionCapability(event: H3Event, appBasePath?: string) {
  const session = await getSession(event);
  const ownerEmail = normalizedEmail(session?.email);
  if (!ownerEmail) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }

  const token = signShortLivedToken({
    resourceId: UI_ACTION_CAPABILITY_RESOURCE,
    viewerEmail: ownerEmail,
    ttlSeconds: UI_ACTION_CAPABILITY_TTL_SECONDS,
  });
  setCookie(event, UI_ACTION_CAPABILITY_COOKIE, token, {
    httpOnly: true,
    sameSite: isHttpsRequest(event) ? "none" : "lax",
    secure: isHttpsRequest(event),
    ...(isHttpsRequest(event) ? { partitioned: true } : {}),
    path: capabilityCookiePath(appBasePath),
    maxAge: UI_ACTION_CAPABILITY_TTL_SECONDS,
  });
  setResponseHeader(event, "Cache-Control", "no-store");
  return { ok: true };
}

export function mountUiActionCapabilityRoute(
  nitroApp: any,
  routePrefix = "/_agent-native",
  appBasePath?: string,
): void {
  if (
    !nitroApp ||
    (typeof nitroApp !== "object" && typeof nitroApp !== "function") ||
    mountedApps.has(nitroApp)
  ) {
    return;
  }
  mountedApps.add(nitroApp);

  getH3App(nitroApp).use(
    `${routePrefix}${UI_ACTION_CAPABILITY_PATH}`,
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed. Use GET." };
      }
      return issueUiActionCapability(event, appBasePath);
    }),
  );
}
