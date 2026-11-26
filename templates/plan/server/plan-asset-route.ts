import {
  PRIVATE_MEDIA_SVG_CSP,
  PrivateMediaValidationError,
  openPrivateMediaForAuthorizedReader,
  readPrivateMediaUploadFormData,
} from "@agent-native/core/private-media";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { ForbiddenError, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getMethod,
  sendRedirect,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "./db/index.js";
import { resolvePlanAccessContext } from "./lib/local-identity.js";
import {
  PlanAssetStorageUnavailableError,
  PlanAssetTooLargeError,
  privatePlanAssetMediaId,
  storePlanAsset,
} from "./lib/plan-assets.js";
import { assertPlanEditor } from "./plans.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

// An asset loads only for people who can open its plan, so no shared cache
// may keep a copy to hand the next person who asks for the same URL.
const ASSET_CACHE_CONTROL = "private, no-store";

async function resolveAssetSession(
  event: H3Event,
): Promise<{ email: string; orgId?: string | null } | null> {
  const session = await getSession(event).catch(() => null);
  if (session?.email) return session;
  return null;
}

/**
 * Adds an image to a plan the caller can edit: a multipart form with the
 * image as `file` and the plan's id as `planId`. The image loads only for
 * people who can open the plan.
 */
async function uploadPlanAsset(event: H3Event) {
  setResponseHeader(event, "Cache-Control", "no-store");
  const session = await resolveAssetSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { error: "Sign in to add images" };
  }
  try {
    const form = await readPrivateMediaUploadFormData(event.req);
    const file = form
      .getAll("file")
      .find((part): part is File => typeof part !== "string");
    const planIds = form.getAll("planId");
    const planId =
      planIds.length === 1 && typeof planIds[0] === "string"
        ? planIds[0].trim()
        : "";
    if (!planId || planId.length > 128) {
      setResponseStatus(event, 400);
      return { error: "A plan is required" };
    }
    if (!file) {
      setResponseStatus(event, 400);
      return { error: "No image uploaded" };
    }
    return await runWithRequestContext(
      {
        userEmail: session.email,
        ...(session.orgId ? { orgId: session.orgId } : {}),
      },
      async () => {
        const access = await assertPlanEditor(planId);
        const plan = access.resource as typeof schema.plans.$inferSelect;
        const stored = await storePlanAsset({
          planId,
          filename: file.name || "image",
          mimeType: file.type,
          data: new Uint8Array(await file.arrayBuffer()),
          orgId: plan.orgId ?? null,
        });
        setResponseStatus(event, 201);
        return { id: stored.assetId, url: stored.src };
      },
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }
    if (
      error instanceof PrivateMediaValidationError ||
      error instanceof PlanAssetTooLargeError
    ) {
      setResponseStatus(event, error.statusCode);
      return { error: error.message };
    }
    if (error instanceof PlanAssetStorageUnavailableError) {
      setResponseStatus(event, 503);
      return { error: error.message, code: "storage_unavailable" };
    }
    throw error;
  }
}

export function createPlanAssetHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    const rawPath = (event.url?.pathname || "").replace(/^\/+/, "");
    if (!rawPath) {
      if (method === "POST") return uploadPlanAsset(event);
      setResponseStatus(event, 405);
      setResponseHeader(event, "Allow", "POST");
      return { error: "Method not allowed" };
    }
    if (method !== "GET" && method !== "HEAD") {
      setResponseStatus(event, 405);
      setResponseHeader(event, "Allow", "GET, HEAD");
      return { error: "Method not allowed" };
    }

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
    // The org lets a workspace plan's members load its images, as they can
    // open the plan.
    const ctx = resolvePlanAccessContext({
      ...(session ? { userEmail: session.email } : {}),
      ...(session?.orgId ? { orgId: session.orgId } : {}),
    });
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

    setResponseHeader(event, "Cache-Control", ASSET_CACHE_CONTROL);
    setResponseHeader(event, "CDN-Cache-Control", "no-store");

    // An image added before private storage kept a public URL; send the
    // reader there.
    if (asset.data.startsWith("cdn:")) {
      return sendRedirect(event, asset.data.slice(4), 302);
    }

    let bytes: Uint8Array;
    let mimeType: string;
    const mediaId = privatePlanAssetMediaId(asset.data);
    if (mediaId) {
      const opened = await openPrivateMediaForAuthorizedReader(mediaId);
      if (!opened) {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
      if (opened.kind === "redirect") {
        return sendRedirect(event, opened.url, 302);
      }
      bytes = opened.data;
      mimeType = opened.media.mimeType;
    } else {
      try {
        bytes = Buffer.from(asset.data, "base64");
      } catch {
        setResponseStatus(event, 500);
        return { error: "Asset data corrupted" };
      }
      mimeType = ALLOWED_MIME_TYPES.has(asset.mimeType)
        ? asset.mimeType
        : "application/octet-stream";
    }

    const headers: Record<string, string> = {
      "Content-Type": mimeType,
      "Cache-Control": ASSET_CACHE_CONTROL,
      "CDN-Cache-Control": "no-store",
      "Content-Length": String(bytes.byteLength),
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
      "X-Content-Type-Options": "nosniff",
    };
    if (mimeType === "image/svg+xml") {
      headers["Content-Security-Policy"] = PRIVATE_MEDIA_SVG_CSP;
    }
    for (const [name, value] of Object.entries(headers)) {
      setResponseHeader(event, name, value);
    }

    if (method === "HEAD") return "";

    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, { headers });
  });
}
