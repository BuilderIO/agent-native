/**
 * Serve a call's thumbnail. If `calls.thumbnail_url` is set, redirect to it.
 * Otherwise return a neutral monochrome SVG placeholder with the call's
 * initials — good enough for library grids without requiring real art.
 *
 * Route: GET /api/call-thumbnail/:callId
 */

import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  sendRedirect,
  type H3Event,
} from "h3";
import {
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  resolveAccess,
  ForbiddenError,
} from "@agent-native/core/sharing";
import "../../../db/index.js"; // ensure registerShareableResource runs

function initialsFor(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "C";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function placeholderSvg(initials: string): string {
  const safe = initials.replace(/[<>&"']/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice"><rect width="640" height="360" fill="#171717"/><rect x="0" y="0" width="640" height="360" fill="url(#g)" opacity="0.2"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#525252"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient></defs><text x="320" y="200" text-anchor="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-weight="600" font-size="120" fill="#e5e5e5">${safe}</text></svg>`;
}

export default defineEventHandler(async (event: H3Event) => {
  const callId = getRouterParam(event, "callId");
  if (!callId) {
    setResponseStatus(event, 400);
    return { error: "Missing callId" };
  }

  const session = await getSession(event).catch(() => null);
  return runWithRequestContext(
    { userEmail: session?.email, orgId: session?.orgId },
    async () => {
      let access;
      try {
        access = await resolveAccess("call", callId);
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 404);
          return { error: "Not found" };
        }
        throw err;
      }

      if (!access) {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }

      const call = access.resource as {
        thumbnailUrl?: string | null;
        title?: string | null;
      };

      if (call.thumbnailUrl) {
        return sendRedirect(event, call.thumbnailUrl, 302);
      }

      const initials = initialsFor(call.title ?? "Call");
      setResponseHeader(event, "Content-Type", "image/svg+xml; charset=utf-8");
      setResponseHeader(event, "Cache-Control", "private, max-age=3600");
      return placeholderSvg(initials);
    },
  );
});
