/**
 * Public read endpoint for a shareable snippet (a bounded moment inside a
 * parent call). Unauthenticated viewers hit this from /share-snippet/:id.
 *
 * GET /api/public-snippet?snippetId=<id>[&password=<pw>|&p=<pw>]
 *
 * Returns the snippet + parent call metadata + media URL with the `#t=s,e`
 * media fragment already baked in. Same privacy rules as public-call.
 */

import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";

function notFound(event: H3Event) {
  setResponseStatus(event, 404);
  return { error: "Not found" };
}

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event) as {
    snippetId?: string;
    password?: string;
    p?: string;
  };
  const snippetId = q.snippetId;
  const password =
    typeof q.password === "string"
      ? q.password
      : typeof q.p === "string"
        ? q.p
        : "";

  if (!snippetId) {
    setResponseStatus(event, 400);
    return { error: "snippetId is required" };
  }

  const access = await resolveAccess("snippet", snippetId);
  if (!access) return notFound(event);
  const snippet = access.resource as typeof schema.snippets.$inferSelect;

  if (snippet.expiresAt) {
    const expires = new Date(snippet.expiresAt).getTime();
    if (Number.isFinite(expires) && expires < Date.now()) {
      return notFound(event);
    }
  }

  if (snippet.password && access.role !== "owner") {
    if (!password || password !== snippet.password) {
      setResponseStatus(event, 401);
      return { error: "Password required", passwordRequired: true };
    }
  }

  const db = getDb();
  const [call] = await db
    .select()
    .from(schema.calls)
    .where(eq(schema.calls.id, snippet.callId))
    .limit(1);
  if (!call) return notFound(event);

  // Bake the snippet fragment + parent password into the media URL so the
  // share player can drop it straight onto a <video src>.
  const startSec = Math.max(0, snippet.startMs / 1000);
  const endSec = Math.max(startSec, snippet.endMs / 1000);
  const fragment = `#t=${startSec.toFixed(3)},${endSec.toFixed(3)}`;

  let base =
    call.mediaUrl && /^https?:\/\//i.test(call.mediaUrl)
      ? call.mediaUrl
      : `/api/call-media/${call.id}`;

  if (call.password && !/^https?:\/\//i.test(base)) {
    const sep = base.includes("?") ? "&" : "?";
    base = `${base}${sep}p=${encodeURIComponent(call.password)}`;
  }

  const mediaUrl = `${base.startsWith("/") ? appPath(base) : base}${fragment}`;

  return {
    snippet: {
      id: snippet.id,
      callId: snippet.callId,
      title: snippet.title,
      description: snippet.description,
      startMs: snippet.startMs,
      endMs: snippet.endMs,
      hasPassword: Boolean(snippet.password),
      expiresAt: snippet.expiresAt,
      createdAt: snippet.createdAt,
      updatedAt: snippet.updatedAt,
    },
    call: {
      id: call.id,
      title: call.title,
      thumbnailUrl: call.thumbnailUrl,
      mediaKind: call.mediaKind,
      mediaFormat: call.mediaFormat,
      durationMs: call.durationMs,
      width: call.width,
      height: call.height,
      mediaUrl,
    },
  };
});
