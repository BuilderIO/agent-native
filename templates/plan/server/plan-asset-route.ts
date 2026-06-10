/**
 * Serving route for plan asset images stored in the `plan_assets` table.
 *
 *   GET /_agent-native/plan-asset/<assetId>/<filename>
 *
 * Access control:
 *   - Public plan  → anonymous fetch OK (no auth required)
 *   - Private/org plan → same session/bearer check as the action surface
 *
 * Cache: long immutable for private plans (asset ID is a stable content
 * address); same for public plans. The asset bytes never change for a given ID.
 */
import {
  defineEventHandler,
  getMethod,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import { getSession } from "@agent-native/core/server";
import { resolvePlanAccessContext } from "./lib/local-identity.js";

/** Allowed image MIME types. SVG is intentionally served as octet-stream to
 * prevent script execution in browsers that treat SVG as HTML. */
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Long immutable cache — the bytes for a given asset ID never change. */
const ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable, stale-while-revalidate=604800";

/**
 * Resolve session for asset GET requests.
 * `getSession` handles browser cookies, legacy bearer tokens, and MCP OAuth
 * bearer tokens in one call — no custom auth logic needed here.
 */
async function resolveAssetSession(
  event: H3Event,
): Promise<{ email: string } | null> {
  const session = await getSession(event).catch(() => null);
  if (session?.email) return session;
  return null;
}

/**
 * Combined handler for the plan-asset routes. Mount as a PREFIX handler at
 * `/_agent-native/plan-asset`; the framework strips the mount prefix, so:
 *   - `event.url.pathname === "/<assetId>/<filename>"` → GET serve
 */
export function createPlanAssetHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      setResponseStatus(event, 405);
      setResponseHeader(event, "Allow", "GET, HEAD");
      return { error: "Method not allowed" };
    }

    // Path: "/<assetId>/<filename>" (mount prefix already stripped by h3)
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

    // Resolve the parent plan's access. Public plans allow anonymous reads;
    // private/org plans require the same session as the action surface.
    const session = await resolveAssetSession(event);
    const ctx = resolvePlanAccessContext({ userEmail: session?.email });
    const access = await resolveAccess("plan", asset.planId, ctx).catch(
      () => null,
    );

    if (!access) {
      // Could not resolve access — either plan not found or requester has no
      // rights. Return 404 to avoid leaking plan existence.
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }

    // Decode the base64 data and serve it.
    let bytes: Buffer;
    try {
      bytes = Buffer.from(asset.data, "base64");
    } catch {
      setResponseStatus(event, 500);
      return { error: "Asset data corrupted" };
    }

    // Serve SVG as octet-stream to prevent inline script execution.
    const mimeType = ALLOWED_MIME_TYPES.has(asset.mimeType)
      ? asset.mimeType
      : "application/octet-stream";

    const headers: Record<string, string> = {
      "Content-Type": mimeType,
      "Cache-Control": ASSET_CACHE_CONTROL,
      "CDN-Cache-Control": ASSET_CACHE_CONTROL,
      "Content-Length": String(bytes.byteLength),
      "Cross-Origin-Resource-Policy": "cross-origin",
      // Prevent embedding in untrusted contexts when serving images that could
      // contain script payloads. SVG is already forced to octet-stream above.
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
