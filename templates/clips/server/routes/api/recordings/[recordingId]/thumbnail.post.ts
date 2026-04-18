/**
 * Upload a still-frame thumbnail for a recording. Called by the video player
 * once the owner loads the first frame of their clip — we capture the frame
 * client-side, POST the bytes here, push them through the framework
 * `uploadFile`, and store the resulting URL in `recordings.thumbnail_url`.
 *
 * Route: POST /api/recordings/:recordingId/thumbnail
 * Body: raw JPEG (or PNG) bytes. Content-Type: image/jpeg | image/png.
 */

import {
  defineEventHandler,
  getRouterParam,
  getHeader,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";
import { getEventOwnerEmail } from "../../../../lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  let ownerEmail: string;
  try {
    ownerEmail = await getEventOwnerEmail(event);
  } catch (err) {
    console.error("[thumbnail] getEventOwnerEmail threw:", err);
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const db = getDb();

  const [existing] = await db
    .select({
      id: schema.recordings.id,
      ownerEmail: schema.recordings.ownerEmail,
      thumbnailUrl: schema.recordings.thumbnailUrl,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        eq(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Recording not found" };
  }

  const raw = await readRawBody(event, false);
  if (!raw || raw.byteLength === 0) {
    setResponseStatus(event, 400);
    return { error: "Empty thumbnail body" };
  }

  const headerType = getHeader(event, "content-type") || "";
  const mimeType = headerType.startsWith("image/") ? headerType : "image/jpeg";
  const ext = mimeType === "image/png" ? "png" : "jpg";

  const bytes: Uint8Array =
    raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);

  const uploaded = await uploadFile({
    data: bytes,
    mimeType,
    filename: `thumb-${recordingId}.${ext}`,
    ownerEmail,
  });

  if (!uploaded?.url) {
    setResponseStatus(event, 500);
    return { error: "Upload failed" };
  }

  await db
    .update(schema.recordings)
    .set({
      thumbnailUrl: uploaded.url,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.recordings.id, recordingId));

  await writeAppState("refresh-signal", { ts: Date.now() });

  return { ok: true, recordingId, thumbnailUrl: uploaded.url };
});
