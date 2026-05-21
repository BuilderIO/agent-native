import type { H3Event } from "h3";
import { defineEventHandler, getMethod, getQuery, setResponseHeader } from "h3";
import {
  consumeEmbedSessionTicket,
  normalizeEmbedTargetPath,
  setEmbedSessionCookie,
  signEmbedSessionToken,
} from "./embed-session.js";
import type { AuthSession } from "./auth.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_START_PATH,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";
import { withCollapsedAgentSidebarParam } from "../shared/agent-sidebar-url.js";

function withConfiguredBasePath(path: string): string {
  const base = getConfiguredAppBasePath();
  if (!base) return path;
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}

function appendEmbedParams(target: string, token: string): string {
  const url = new URL(target, "http://agent-native.invalid");
  url.searchParams.set(EMBED_MODE_QUERY_PARAM, "1");
  url.searchParams.set(EMBED_TOKEN_QUERY_PARAM, token);
  return `${url.pathname}${url.search}${url.hash}`;
}

function redirectWithStagedCookies(
  event: H3Event,
  location: string,
  status = 302,
): Response {
  const headers = new Headers({ Location: location });
  const staged = event.res?.headers?.getSetCookie?.() ?? [];
  for (const cookie of staged) headers.append("set-cookie", cookie);
  headers.set("Referrer-Policy", "no-referrer");
  return new Response("", { status, headers });
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function buildEmbedStartPath(ticket: string): string {
  const qs = new URLSearchParams({ ticket });
  return `${getConfiguredAppBasePath()}${EMBED_START_PATH}?${qs}`;
}

export interface EmbedStartRouteOptions {
  getExistingSession?: (event: H3Event) => Promise<AuthSession | null>;
}

export function createEmbedStartRouteHandler(
  options: EmbedStartRouteOptions = {},
) {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    if (method === "HEAD") {
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (method !== "GET") {
      return textResponse("Method not allowed", 405);
    }

    const rawTicket = getQuery(event)?.ticket;
    const ticket = Array.isArray(rawTicket) ? rawTicket[0] : rawTicket;
    const existingSession = await options
      .getExistingSession?.(event)
      .catch(() => null);
    const consumed = await consumeEmbedSessionTicket(ticket, {
      expectedOrgId: existingSession?.orgId ?? null,
    });
    if (!consumed) {
      return textResponse("Invalid or expired embed session.", 401);
    }

    const target = normalizeEmbedTargetPath(consumed.targetPath);
    if (!target) {
      return textResponse("Invalid embed target.", 400);
    }

    const token = signEmbedSessionToken({
      ownerEmail: consumed.ownerEmail,
      orgId: consumed.orgId,
      targetPath: target,
      scope: consumed.scope,
    });
    setEmbedSessionCookie(event, token);
    setResponseHeader(event, "Referrer-Policy", "no-referrer");

    const location = withConfiguredBasePath(
      withCollapsedAgentSidebarParam(appendEmbedParams(target, token)),
    );
    return redirectWithStagedCookies(event, location);
  });
}
