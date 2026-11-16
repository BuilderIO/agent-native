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
import {
  getBrowserCookieSession,
  getBrowserSessionConfigurationError,
} from "./auth.js";
import {
  FULL_APP_EMBED_SCOPE,
  hasEmbedSessionRequestMarker,
  presentsFullAppEmbedBearer,
  resolveEmbedSessionFromRequest,
} from "./embed-session.js";
import { getH3App } from "./framework-request-handler.js";
import { publicFrameworkPath } from "./framework-route-prefix.js";
import { isHttpsRequest } from "./https-request.js";
import { hasSameOriginBrowserEvidence } from "./request-origin.js";
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
  let ownerEmail: string | undefined;
  const embedMarked = hasEmbedSessionRequestMarker(event);
  if (!embedMarked) {
    const session = getHeader(event, "authorization")
      ? null
      : await getBrowserCookieSession(event);
    ownerEmail = normalizedEmail(session?.email);
  }
  let panelBearer = false;
  if (!ownerEmail) {
    // A full-app panel is the app's own UI, run by its verified owner.
    const embedSession = await resolveEmbedSessionFromRequest(event);
    if (embedSession?.scope === FULL_APP_EMBED_SCOPE) {
      ownerEmail = normalizedEmail(embedSession.email);
      panelBearer =
        !!ownerEmail && presentsFullAppEmbedBearer(event, ownerEmail);
    } else if (embedMarked) {
      setResponseStatus(event, 403);
      return { error: "Browser cookie session required" };
    }
  }
  if (!ownerEmail) {
    setResponseStatus(event, 401);
    return {
      error: getBrowserSessionConfigurationError() ?? "Authentication required",
    };
  }

  // A panel runs on its MCP host's origin; its own token is its proof, and
  // its actions accept that header where this cookie cannot be kept.
  if (!panelBearer && !hasSameOriginBrowserEvidence(event)) {
    setResponseStatus(event, 403);
    return { error: "Same-origin request required" };
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
