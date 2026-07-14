/**
 * Upload a still-frame thumbnail for a recording. Called by the video player
 * once the owner loads the first frame of their clip — we capture the frame
 * client-side, POST the bytes here, push them through the framework
 * `uploadFile`, and store the resulting URL in `recordings.thumbnail_url`.
 *
 * Route: POST /api/recordings/:recordingId/thumbnail
 * Body: raw JPEG (or PNG) bytes. Content-Type: image/jpeg | image/png.
 */

import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  getHeader,
  getQuery,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import { parseEdits } from "../../../../../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../../../../db/index.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import {
  requiresConfiguredVideoStorage,
  STORAGE_SETUP_REQUIRED_REASON,
} from "../../../../lib/video-storage.js";

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

function normalizeThumbnailMimeType(
  value: string,
): "image/jpeg" | "image/png" | null {
  const mimeType = value.split(";")[0]?.trim().toLowerCase();
  if (mimeType === "image/jpeg" || mimeType === "image/png") return mimeType;
  return null;
}

function hasExpectedThumbnailSignature(
  mimeType: "image/jpeg" | "image/png",
  bytes: Uint8Array,
): boolean {
  if (mimeType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  console.log("[thumbnail] POST received", { recordingId });
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  let ownerEmail: string;
  let orgId: string | undefined;
  try {
    const context = await getEventOwnerContext(event);
    ownerEmail = context.userEmail;
    orgId = context.orgId;
  } catch (err) {
    console.error("[thumbnail] getEventOwnerContext threw:", err);
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
    const db = getDb();

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        ownerEmail: schema.recordings.ownerEmail,
        thumbnailUrl: schema.recordings.thumbnailUrl,
        editsJson: schema.recordings.editsJson,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );

    if (!existing) {
      console.warn("[thumbnail] recording not found or not owner", {
        recordingId,
        ownerEmail,
      });
      setResponseStatus(event, 404);
      return { error: "Recording not found" };
    }

    const replaceMode = getQuery(event).replace;
    const replaceAutoThumbnail = replaceMode === "auto";
    const hasEditorThumbnail = Boolean(
      parseEdits(existing.editsJson).thumbnail,
    );

    // If we already have a thumbnail, don't overwrite editor-picked thumbnails.
    // Auto-generated thumbnails may be replaced by the player when the saved
    // image probes as blank.
    if (existing.thumbnailUrl) {
      if (!replaceAutoThumbnail || hasEditorThumbnail) {
        console.log("[thumbnail] already set, skipping", { recordingId });
        return {
          ok: true,
          recordingId,
          thumbnailUrl: existing.thumbnailUrl,
          skipped: true,
        };
      }
      console.log("[thumbnail] replacing auto thumbnail", { recordingId });
    }

    const contentLength = Number(getHeader(event, "content-length") || 0);
    if (contentLength > MAX_THUMBNAIL_BYTES) {
      setResponseStatus(event, 413);
      return { error: "Thumbnail too large" };
    }

    const raw = await readRawBody(event, false);
    if (!raw || raw.byteLength === 0) {
      setResponseStatus(event, 400);
      return { error: "Empty thumbnail body" };
    }
    if (raw.byteLength > MAX_THUMBNAIL_BYTES) {
      setResponseStatus(event, 413);
      return { error: "Thumbnail too large" };
    }

    const headerType = getHeader(event, "content-type") || "";
    const mimeType = normalizeThumbnailMimeType(headerType);
    if (!mimeType) {
      setResponseStatus(event, 400);
      return { error: "Only JPEG and PNG thumbnails are allowed" };
    }
    const ext = mimeType === "image/png" ? "png" : "jpg";

    const bytes: Uint8Array =
      raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
    if (!hasExpectedThumbnailSignature(mimeType, bytes)) {
      setResponseStatus(event, 400);
      return { error: "Thumbnail bytes do not match Content-Type" };
    }

    // Try the configured file-upload provider first. Hosted/persistent SQL
    // must not store base64 data URLs in recordings.thumbnail_url; local dev can
    // still fall back inline to keep the first-frame preview flow lightweight.
    const uploaded = await uploadFile({
      data: bytes,
      mimeType,
      filename: `thumb-${recordingId}.${ext}`,
      ownerEmail,
      recordAsset: false,
    });

    let url: string;
    if (uploaded?.url) {
      url = uploaded.url;
      console.log("[thumbnail] uploaded via provider", {
        recordingId,
        provider: uploaded.provider,
        bytes: bytes.byteLength,
      });
    } else {
      if (requiresConfiguredVideoStorage()) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error: STORAGE_SETUP_REQUIRED_REASON,
          storageSetupRequired: true,
        };
      }
      const base64 = Buffer.from(bytes).toString("base64");
      url = `data:${mimeType};base64,${base64}`;
      console.log("[thumbnail] local storage fallback stored inline data URL", {
        recordingId,
        bytes: bytes.byteLength,
      });
    }

    await db
      .update(schema.recordings)
      .set({
        thumbnailUrl: url,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recordings.id, recordingId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log("[thumbnail] saved", {
      recordingId,
      inline: !uploaded?.url,
      urlPrefix: url.slice(0, 40),
    });

    return { ok: true, recordingId, thumbnailUrl: url };
  });
});
