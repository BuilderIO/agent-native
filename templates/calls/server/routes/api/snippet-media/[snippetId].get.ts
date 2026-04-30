/**
 * Redirect to the parent call's media URL with a media-fragment `#t=s,e`
 * bounding the playback range. Browsers honor the fragment when it's part of
 * the <video src> URL — this is the cheapest way to "play just this snippet"
 * without re-encoding or a second blob.
 *
 * Access is checked against the snippet itself (which is registered as a
 * separately shareable resource in db/index.ts). If the parent call has a
 * password, it's preserved in the redirected URL so the <video> element can
 * load the bytes.
 *
 * Route: GET /api/snippet-media/:snippetId
 */

import {
  defineEventHandler,
  getRouterParam,
  getRequestHeader,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  sendRedirect,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  getSession,
  runWithRequestContext,
  signShortLivedToken,
} from "@agent-native/core/server";

interface SnippetRow {
  id: string;
  callId: string;
  startMs?: number | null;
  endMs?: number | null;
  password?: string | null;
  expiresAt?: string | null;
}

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

export default defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event).catch(() => null);
  return runWithRequestContext(
    { userEmail: session?.email, orgId: session?.orgId },
    async () => {
      const snippetId = getRouterParam(event, "snippetId");
      if (!snippetId) {
        setResponseStatus(event, 400);
        return { error: "Missing snippetId" };
      }

      const access = await resolveAccess("snippet", snippetId);
      if (!access) {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
      const snippet = access.resource as SnippetRow;

      if (snippet.expiresAt) {
        const expires = new Date(snippet.expiresAt).getTime();
        if (Number.isFinite(expires) && expires < Date.now()) {
          setResponseStatus(event, 410);
          return { error: "Snippet has expired" };
        }
      }

      if (snippet.password && access.role !== "owner") {
        const headerPassword = getRequestHeader(event, "x-password");
        const q = getQuery(event) as { p?: string; password?: string };
        const supplied =
          (typeof headerPassword === "string" ? headerPassword : "") ||
          (typeof q.p === "string" ? q.p : "") ||
          (typeof q.password === "string" ? q.password : "");
        if (!supplied || supplied !== snippet.password) {
          setResponseStatus(event, 404);
          return { error: "Not found" };
        }
      }

      const db = getDb();
      const [call] = await db
        .select({
          id: schema.calls.id,
          mediaUrl: schema.calls.mediaUrl,
          password: schema.calls.password,
        })
        .from(schema.calls)
        .where(eq(schema.calls.id, snippet.callId))
        .limit(1);

      if (!call) {
        setResponseStatus(event, 404);
        return { error: "Parent call not found" };
      }

      const startSec = Math.max(0, (snippet.startMs ?? 0) / 1000);
      const endSec = Math.max(startSec, (snippet.endMs ?? 0) / 1000);
      const fragment = `#t=${startSec.toFixed(3)},${endSec.toFixed(3)}`;

      const base =
        call.mediaUrl && /^https?:\/\//i.test(call.mediaUrl)
          ? call.mediaUrl
          : `/api/call-media/${call.id}`;

      // For password-protected first-party media URLs, mint a short-lived
      // HMAC token bound to the parent call id and redirect the viewer
      // through `?t=<token>` instead of `?p=<password>`. The downstream
      // call-media route still accepts `?p=<password>` as a legacy
      // fallback. (audit 11 F-07)
      let target = base;
      if (call.password && !/^https?:\/\//i.test(base)) {
        const token = signShortLivedToken({ resourceId: call.id });
        const sep = target.includes("?") ? "&" : "?";
        target = `${target}${sep}t=${encodeURIComponent(token)}`;
      }

      // Don't leak the parent-call URL (which carries a short-lived token)
      // into the Referer of any outbound link.
      setResponseHeader(event, "Referrer-Policy", "no-referrer");

      return sendRedirect(
        event,
        `${target.startsWith("/") ? appPath(target) : target}${fragment}`,
        302,
      );
    },
  );
});
