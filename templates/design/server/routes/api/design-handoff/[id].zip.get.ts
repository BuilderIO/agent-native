import { verifyShortLivedToken } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../../db/index.js";
import {
  buildDesignHandoffPayload,
  buildDesignHandoffZip,
  buildHandoffZipFilename,
} from "../../../lib/coding-handoff.js";
import { buildDesignSnapshot } from "../../../lib/design-snapshot.js";

function notFound(event: H3Event) {
  setResponseStatus(event, 404);
  return { error: "Not found" };
}

function normalizeRouteId(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.endsWith(".zip") ? value.slice(0, -4) : value;
}

export default defineEventHandler(async (event: H3Event) => {
  const id = normalizeRouteId(getRouterParam(event, "id"));
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design ID is required" };
  }

  const q = getQuery(event) as {
    token?: string;
    t?: string;
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

  const snapshot = await buildDesignSnapshot(id, design.data);
  if (snapshot.files.length === 0) return notFound(event);

  const payload = buildDesignHandoffPayload({
    design,
    files: snapshot.files.map((f) => ({
      filename: f.filename,
      fileType: f.fileType,
      content: f.content,
    })),
    resolvedCssVars: snapshot.resolvedCssVars,
  });
  const zip = await buildDesignHandoffZip(payload);
  const filename = buildHandoffZipFilename(design.title);

  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Content-Type", "application/zip");
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );

  return zip;
});
