import type { ActionRunContext } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server/request-context";

import {
  LOCALHOST_BRIDGE_RELAY_HEADER,
  LOCALHOST_BRIDGE_RELAY_MARKER,
  type LocalhostBridgeRelay,
} from "../shared/visual-edit-bridge-relay.js";

export function isSameOriginVisualEditBrowserRequest(
  ctx?: Pick<ActionRunContext, "caller" | "requestHeaders">,
): boolean {
  if (ctx?.caller !== "frontend" && ctx?.caller !== "webmcp") return false;
  const headers = ctx.requestHeaders;
  if (!headers) return false;

  const fetchSite = headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = headers.get("origin");
  const requestOrigin = getRequestContext()?.requestOrigin;
  if (!origin || !requestOrigin) return false;
  if (!URL.canParse(origin) || !URL.canParse(requestOrigin)) return false;
  if (new URL(origin).origin !== new URL(requestOrigin).origin) return false;

  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

/**
 * The browser relay is only a transport handoff. Keep every access, scope,
 * consent, and path check in the action before returning this marker. A
 * same-origin GET may omit Origin, so the optional browser metadata is
 * checked without making that normal fetch shape unusable.
 */
export function isLocalhostBridgeRelayRequest(
  ctx?: Pick<ActionRunContext, "caller" | "requestHeaders">,
): boolean {
  if (ctx?.caller !== "frontend" && ctx?.caller !== "webmcp") return false;
  const headers = ctx.requestHeaders;
  if (headers?.get(LOCALHOST_BRIDGE_RELAY_HEADER) !== "1") return false;

  const fetchSite = headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = headers.get("origin");
  const requestOrigin = getRequestContext()?.requestOrigin;
  if (origin && requestOrigin) {
    if (!URL.canParse(origin) || !URL.canParse(requestOrigin)) return false;
    if (new URL(origin).origin !== new URL(requestOrigin).origin) {
      return false;
    }
  }

  return true;
}

export function createLocalhostBridgeRelay(
  relay: Omit<LocalhostBridgeRelay, "__agentNativeLocalhostBridge">,
): never {
  return {
    __agentNativeLocalhostBridge: LOCALHOST_BRIDGE_RELAY_MARKER,
    ...relay,
  } as never;
}
