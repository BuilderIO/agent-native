import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { verifyShortLivedToken } from "@agent-native/core/server";
import { getDb, schema } from "../../../db/index.js";
import {
  buildDesignHandoffMarkdown,
  buildDesignHandoffPayload,
  normalizeHandoffFormat,
} from "../../../lib/coding-handoff.js";

function notFound(event: H3Event) {
  setResponseStatus(event, 404);
  return { error: "Not found" };
}

export default defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design ID is required" };
  }

  const q = getQuery(event) as {
    token?: string;
    t?: string;
    format?: string;
  };
  const token =
    typeof q.token === "string" ? q.token : typeof q.t === "string" ? q.t : "";

  const verified = verifyShortLivedToken(token, id);
  if (!verified.ok) {
    setResponseStatus(event, 403);
    return { error: "Invalid or expired handoff link" };
  }

  const db = getDb();
  // guard:allow-unscoped — this unauthenticated endpoint is gated by a signed, expiring handoff token bound to the design id.
  const [design] = await db
    .select()
    .from(schema.designs)
    .where(eq(schema.designs.id, id))
    .limit(1);
  if (!design) return notFound(event);

  const files = await db
    .select({
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
    })
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, id));
  if (files.length === 0) return notFound(event);

  const payload = buildDesignHandoffPayload({ design, files });
  const format = normalizeHandoffFormat(q.format);

  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");

  if (format === "json") {
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    return payload;
  }

  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
  return buildDesignHandoffMarkdown(payload);
});
