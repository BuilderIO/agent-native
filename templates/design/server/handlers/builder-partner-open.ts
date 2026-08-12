/**
 * Exchange Builder's signed connect token for a one-time embed-start URL.
 * A non-action route because it runs before any session exists, so the connect
 * token is the only thing between a caller and a branch's capability.
 */

import { getOrigin } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import {
  defineEventHandler,
  getHeader,
  getMethod,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import openBuilderVisualEdit from "../../actions/open-builder-visual-edit.js";
import {
  BuilderConnectTokenError,
  BuilderPartnerNotConfiguredError,
  verifyBuilderConnectToken,
} from "../lib/builder-connect-token.js";

/**
 * Builder's webapp calls this cross-origin, so a mismatched `Origin` is not by
 * itself suspicious — the token is the real gate. Rejecting unknown browser
 * origins only narrows who can burn a valid token they somehow obtained.
 */
const ALLOWED_ORIGIN_SUFFIXES = [".builder.io", ".builder.my"];
const ALLOWED_ORIGIN_HOSTS = new Set(["builder.io", "builder.my"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isAllowedBrowserOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  let host: string;
  let protocol: string;
  try {
    const url = new URL(origin);
    host = url.hostname.toLowerCase();
    protocol = url.protocol;
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (protocol !== "https:") return false;
  return (
    ALLOWED_ORIGIN_HOSTS.has(host) ||
    ALLOWED_ORIGIN_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** Caller-supplied, so bounded: a screen is a live iframe of the container. */
const MAX_REQUESTED_ROUTES = 24;

function parseRequestedRoutes(
  value: unknown,
): { path: string; title?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const paths = new Set<string>();
  for (const entry of value) {
    const path =
      typeof entry === "string"
        ? entry
        : typeof (entry as { path?: unknown })?.path === "string"
          ? (entry as { path: string }).path
          : null;
    // A dynamic segment has no single URL to render, so it cannot be a screen.
    if (!path?.startsWith("/") || /[[:*]/.test(path)) continue;
    paths.add(path);
    if (paths.size >= MAX_REQUESTED_ROUTES) break;
  }
  return paths.size > 0 ? [...paths].map((path) => ({ path })) : undefined;
}

export const builderPartnerOpen = defineEventHandler(async (event) => {
  const origin = getHeader(event, "origin");
  const originAllowed = isAllowedBrowserOrigin(origin);

  // Builder calls this from its own origin, so the browser preflights it. No
  // credentials: the connect token travels in the body, never as a cookie.
  if (origin && originAllowed) {
    setResponseHeader(event, "access-control-allow-origin", origin);
    setResponseHeader(event, "vary", "origin");
    setResponseHeader(event, "access-control-allow-methods", "POST, OPTIONS");
    setResponseHeader(event, "access-control-allow-headers", "content-type");
    setResponseHeader(event, "access-control-max-age", "600");
  }

  if (getMethod(event) === "OPTIONS") {
    setResponseStatus(event, originAllowed ? 204 : 403);
    return null;
  }

  if (!originAllowed) {
    setResponseStatus(event, 403);
    return { error: "Origin is not allowed to open a Builder design." };
  }

  const body = (await readBody(event).catch(() => null)) as {
    token?: unknown;
    previewUrl?: unknown;
    contentId?: unknown;
    routes?: unknown;
  } | null;

  let claims;
  try {
    claims = await verifyBuilderConnectToken(body?.token);
  } catch (error) {
    if (
      error instanceof BuilderConnectTokenError ||
      error instanceof BuilderPartnerNotConfiguredError
    ) {
      setResponseStatus(event, error.statusCode);
      return { error: error.message };
    }
    throw error;
  }

  // The branch identity comes from the signed claims; only the preview URL is
  // caller-supplied, and the action validates it against the host allowlist.
  const result = await runWithRequestContext({}, () =>
    openBuilderVisualEdit.run({
      previewUrl: String(body?.previewUrl ?? ""),
      builderOrgId: claims.builderOrgId,
      projectId: claims.projectId,
      branchName: claims.branchName,
      contentId: typeof body?.contentId === "string" ? body.contentId : null,
      routes: parseRequestedRoutes(body?.routes),
      // Only the request knows this app's public origin, and screen URLs must
      // be absolute for the canvas to accept them.
      appOrigin: getOrigin(event),
    }),
  );

  return {
    designId: result.designId,
    urlPath: result.urlPath,
    embedUrl: result.embedUrl,
  };
});
