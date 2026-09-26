import { getSession } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getMethod,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "./db/index.js";
import { resolvePlanAccessContext } from "./lib/local-identity.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable, stale-while-revalidate=604800";

async function resolveAssetSession(
  event: H3Event,
): Promise<{ email: string } | null> {
  const session = await getSession(event).catch(() => null);
  if (session?.email) return session;
  return null;
}

export function createPlanAssetHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      setResponseStatus(event, 405);
      setResponseHeader(event, "Allow", "GET, HEAD");
      return { error: "Method not allowed" };
    }

    const rawPath = (event.url?.pathname || "").replace(/^\/+/, "");
    const slashIdx = rawPath.indexOf("/");
    const assetId = slashIdx >= 0 ? rawPath.slice(0, slashIdx) : rawPath;

    if (!assetId || !/^[A-Za-z0-9_-]+$/.test(assetId)) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }

    const db = getDb();

    // guard:allow-unscoped -- we immediately check access on the parent plan
    const [asset] = await db
      .select()
      .from(schema.planAssets)
      .where(eq(schema.planAssets.id, assetId))
      .limit(1);

    if (!asset) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }

    const session = await resolveAssetSession(event);
    const ctx = resolvePlanAccessContext({ userEmail: session?.email });
    const access = await resolveAccess("plan", asset.planId, ctx).catch(
      () => null,
    );

    if (
      !access ||
      (access.resource as typeof schema.plans.$inferSelect).deletedAt
    ) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(asset.data, "base64");
    } catch {
      setResponseStatus(event, 500);
      return { error: "Asset data corrupted" };
    }

    const mimeType = ALLOWED_MIME_TYPES.has(asset.mimeType)
      ? asset.mimeType
      : "application/octet-stream";

    const headers: Record<string, string> = {
      "Content-Type": mimeType,
      "Cache-Control": ASSET_CACHE_CONTROL,
      "CDN-Cache-Control": ASSET_CACHE_CONTROL,
      "Content-Length": String(bytes.byteLength),
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
    };
    for (const [name, value] of Object.entries(headers)) {
      setResponseHeader(event, name, value);
    }

    if (method === "HEAD") return "";

    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, { headers });
  });
}
