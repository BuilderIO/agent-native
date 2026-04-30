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
import { runWithRequestContext } from "@agent-native/core/server";

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  console.log("[thumbnail] POST received", { recordingId });
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
    console.warn("[thumbnail] recording not found or not owner", {
      recordingId,
      ownerEmail,
    });
    setResponseStatus(event, 404);
    return { error: "Recording not found" };
  }

  // If we already have a thumbnail, don't overwrite — the client-side effect
  // is supposed to short-circuit on `thumbnailUrl`, but belt-and-braces.
  if (existing.thumbnailUrl) {
    console.log("[thumbnail] already set, skipping", { recordingId });
    return {
      ok: true,
      recordingId,
      thumbnailUrl: existing.thumbnailUrl,
      skipped: true,
    };
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

  // Try the configured file-upload provider first (Builder.io or a
  // user-registered one). In dev / solo mode no provider is usually
  // configured and `uploadFile()` returns `null` — in that case we fall
  // back to a base64 `data:` URL inline in the `recordings.thumbnail_url`
  // column. It's not glamorous but it unblocks the library grid
  // immediately and mirrors what `set-thumbnail` does.
  const uploaded = await runWithRequestContext({ userEmail: ownerEmail }, () =>
    uploadFile({
      data: bytes,
      mimeType,
      filename: `thumb-${recordingId}.${ext}`,
      ownerEmail,
    }),
  );

  let url: string;
  if (uploaded?.url) {
    url = uploaded.url;
    console.log("[thumbnail] uploaded via provider", {
      recordingId,
      provider: uploaded.provider,
      bytes: bytes.byteLength,
    });
  } else {
    const base64 = Buffer.from(bytes).toString("base64");
    url = `data:${mimeType};base64,${base64}`;
    console.log("[thumbnail] no provider configured, stored inline data URL", {
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
