/**
 * Serve the assembled video blob for a recording — dev-only fallback when no
 * file upload provider is configured. `finalize-recording` stashes the blob
 * in `application_state` under `recording-blob-:id` and points
 * `recordings.video_url` at this route.
 *
 * Production deployments register a real provider (Builder.io / R2 / S3) and
 * `video_url` points directly at that — this route never gets hit.
 *
 * Supports HTTP Range requests so the <video> element can seek.
 *
 * Route: GET /api/uploads/:recordingId/blob
 */

import {
  defineEventHandler,
  getRouterParam,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { readAppState } from "@agent-native/core/application-state";
import { resolveAccess } from "@agent-native/core/sharing";

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const access = await resolveAccess("recording", recordingId);
  if (!access) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }
  const rec = access.resource as { expiresAt?: string | null };
  if (rec.expiresAt) {
    const expires = new Date(rec.expiresAt).getTime();
    if (Number.isFinite(expires) && expires < Date.now()) {
      setResponseStatus(event, 410);
      return { error: "Recording has expired" };
    }
  }

  const blob = await readAppState(`recording-blob-${recordingId}`);
  const b64 = typeof blob?.data === "string" ? blob.data : null;
  if (!b64) {
    setResponseStatus(event, 404);
    return { error: "Blob not found" };
  }
  const mimeType =
    typeof blob?.mimeType === "string" ? blob.mimeType : "video/webm";
  const bytes = Buffer.from(b64, "base64");
  const total = bytes.byteLength;

  setResponseHeader(event, "Content-Type", mimeType);
  setResponseHeader(event, "Accept-Ranges", "bytes");
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");

  // Honor Range requests so <video> seeking works.
  const rangeHeader = getRequestHeader(event, "range");
  if (rangeHeader && rangeHeader.startsWith("bytes=")) {
    const [startStr, endStr] = rangeHeader.slice(6).split("-");
    const start = startStr ? Number.parseInt(startStr, 10) : 0;
    const end = endStr ? Number.parseInt(endStr, 10) : total - 1;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end >= total ||
      start > end
    ) {
      setResponseStatus(event, 416);
      setResponseHeader(event, "Content-Range", `bytes */${total}`);
      return "";
    }
    const slice = bytes.subarray(start, end + 1);
    setResponseStatus(event, 206);
    setResponseHeader(event, "Content-Range", `bytes ${start}-${end}/${total}`);
    setResponseHeader(event, "Content-Length", String(slice.byteLength));
    return slice;
  }

  setResponseHeader(event, "Content-Length", String(total));
  return bytes;
});
