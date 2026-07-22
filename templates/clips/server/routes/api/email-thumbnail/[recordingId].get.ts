/**
 * Serves a recording's thumbnail with a static play button + duration badge
 * baked in, for use as the image in the "shared with you" email. Email
 * clients fetch this unauthenticated, so — like the plain `thumbnailUrl`
 * already embedded in that email — this intentionally does no access check
 * beyond the recording existing and having a thumbnail.
 *
 * Always falls back to the plain thumbnail bytes (never a broken image) if
 * the source can't be fetched or the overlay can't be rendered.
 */

import {
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "@agent-native/core/extensions/url-safety";
import { isResvgRuntimeUnavailableError } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getRequestURL,
  getRouterParam,
  setResponseStatus,
} from "h3";

import { getDb, schema } from "../../../db/index.js";
import { renderEmailThumbnailPng } from "../../../lib/email-thumbnail-overlay.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const SAFE_RASTER_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function imageResponse(body: ArrayBuffer, mimeType: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": CACHE_CONTROL,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default defineEventHandler(async (event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const [recording] = await getDb()
    .select({
      thumbnailUrl: schema.recordings.thumbnailUrl,
      durationMs: schema.recordings.durationMs,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);

  const sourceUrl = recording?.thumbnailUrl;
  if (!sourceUrl) {
    setResponseStatus(event, 404);
    return { error: "Thumbnail not found" };
  }

  let resolvedSourceUrl = sourceUrl;
  if (sourceUrl.startsWith("/")) {
    resolvedSourceUrl = new URL(sourceUrl, getRequestURL(event).origin).href;
  }

  let bytes: Uint8Array;
  let mimeType: string;
  try {
    if (await isBlockedExtensionUrlWithDns(resolvedSourceUrl)) {
      throw new Error("blocked source url");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await ssrfSafeFetch(resolvedSourceUrl, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const contentType =
      upstream.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
    if (!upstream.ok || !SAFE_RASTER_IMAGE_TYPES.has(contentType)) {
      throw new Error(`unusable upstream response (${upstream.status})`);
    }
    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > MAX_SOURCE_BYTES) {
      throw new Error("thumbnail too large to composite");
    }
    bytes = new Uint8Array(buffer);
    mimeType = contentType;
  } catch {
    setResponseStatus(event, 404);
    return { error: "Thumbnail not found" };
  }

  try {
    const png = await renderEmailThumbnailPng({
      imageBytes: bytes,
      mimeType,
      durationMs: recording.durationMs ?? 0,
    });
    return imageResponse(toArrayBuffer(png), "image/png");
  } catch (error) {
    // Overlay compositing failed (e.g. resvg native binding unavailable in
    // this runtime) — still show the plain thumbnail rather than nothing.
    if (!isResvgRuntimeUnavailableError(error)) {
      console.error("[email-thumbnail] overlay render failed:", error);
    }
    return imageResponse(toArrayBuffer(bytes), mimeType);
  }
});
