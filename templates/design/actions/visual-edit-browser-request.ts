import crypto from "node:crypto";

import { fail, type ActionRunContext } from "@agent-native/core/action";
import { signShortLivedToken } from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";
import {
  createLocalhostBridgeAudience,
  issueLocalhostBridgeOperationCapability,
} from "@agent-native/core/visual-edit-bridge-capability";

import {
  LOCALHOST_BRIDGE_RELAY_HEADER,
  LOCALHOST_BRIDGE_RELAY_MARKER,
  localhostBridgeRelayChallengeResourceId,
  type LocalhostBridgeRelay,
} from "../shared/visual-edit-bridge-relay.js";
import {
  ensureMotionLocalhostRelayChain,
  motionLocalhostRelayIdentity,
} from "./motion-localhost-relay.js";

export function isBrowserVisibleVisualEditRequest(
  ctx?: Pick<ActionRunContext, "caller" | "requestHeaders">,
): boolean {
  if (
    ctx?.caller === "frontend" ||
    ctx?.caller === "webmcp" ||
    ctx?.caller === "mcp-widget" ||
    ctx?.caller === "mcp-widget-write"
  ) {
    return true;
  }

  const headers = ctx?.requestHeaders;
  return Boolean(
    headers &&
    ["origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"].some(
      (name) => headers.has(name),
    ),
  );
}

export function rejectBrowserBridgeCredentials(
  ctx: Pick<ActionRunContext, "caller" | "requestHeaders"> | undefined,
  hasCredentials: boolean,
): void {
  if (!hasCredentials || !isBrowserVisibleVisualEditRequest(ctx)) return;
  return fail(
    "Browser visual-edit requests cannot include bridge credentials. Register the bridge through a trusted CLI or server action first.",
    {
      errorCode: "localhost_bridge_credentials_from_browser",
      statusCode: 400,
    },
  );
}

export function containsVisualEditBridgeCredentials(value: unknown): boolean {
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== "object") return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.some(visit);

    return Object.entries(candidate).some(([key, nested]) => {
      if (key === "bridgeToken" || key === "previewToken") return true;
      return visit(nested);
    });
  };

  return visit(value);
}

export function stripVisualEditBridgeCredentials<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (candidate: unknown): unknown => {
    if (!candidate || typeof candidate !== "object") return candidate;
    const cached = seen.get(candidate);
    if (cached) return cached;

    if (Array.isArray(candidate)) {
      const safe: unknown[] = [];
      seen.set(candidate, safe);
      safe.push(...candidate.map(visit));
      return safe;
    }

    const safe: Record<string, unknown> = {};
    seen.set(candidate, safe);
    for (const [key, nested] of Object.entries(candidate)) {
      if (key === "bridgeToken" || key === "previewToken") continue;
      safe[key] = visit(nested);
    }
    return safe;
  };

  return visit(value) as T;
}

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

export async function createLocalhostBridgeRelay(args: {
  relay: Omit<
    LocalhostBridgeRelay,
    | "__agentNativeLocalhostBridge"
    | "challenge"
    | "bridgeRequest"
    | "bridgeOperationCapability"
  >;
  context?: ActionRunContext;
  bridgeToken: string;
  rootPath: string | null;
  bridgeRequest: Record<string, unknown>;
}): Promise<never> {
  const { relay, context, bridgeToken, rootPath, bridgeRequest } = args;
  if (!rootPath) {
    return fail(
      "The connected local folder is missing. Reconnect this project before continuing.",
      {
        errorCode: "localhost_bridge_root_path_missing",
        statusCode: 409,
      },
    );
  }
  const issuedRelay = {
    __agentNativeLocalhostBridge: LOCALHOST_BRIDGE_RELAY_MARKER,
    ...relay,
  } as LocalhostBridgeRelay;
  let body = { ...bridgeRequest };
  if (relay.step) {
    const identity = motionLocalhostRelayIdentity(context);
    if (!identity || !(await ensureMotionLocalhostRelayChain(identity))) {
      return fail("The Motion relay chain is not active.", {
        errorCode: "localhost_bridge_relay_chain_expired",
        statusCode: 409,
      });
    }
    issuedRelay.chainId = identity.chainId;
    issuedRelay.actionName = identity.actionName;
    issuedRelay.inputHash = identity.inputHash;
    issuedRelay.challenge = issueLocalhostBridgeChallenge(issuedRelay);
    body = { ...body, motionRelayChallenge: issuedRelay.challenge };
  }
  const capability = issueLocalhostBridgeOperationCapability({
    bridgeToken,
    audience: createLocalhostBridgeAudience(rootPath),
    operation: `POST /${relay.operation}`,
    body,
  });
  issuedRelay.bridgeRequest = body;
  issuedRelay.bridgeOperationCapability = capability.capability;
  return issuedRelay as never;
}

export function issueLocalhostBridgeChallenge(
  relay: LocalhostBridgeRelay,
): string {
  return signShortLivedToken({
    resourceId: localhostBridgeRelayChallengeResourceId(relay),
    agentLabel: crypto.randomBytes(32).toString("hex"),
    ttlSeconds: 120,
  });
}
