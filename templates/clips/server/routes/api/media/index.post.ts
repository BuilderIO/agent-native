/**
 * Generic media upload — used for brand logos and any other ad-hoc image
 * uploads the app needs. The video upload path lives under /api/uploads/
 * because it's chunked; this route is a one-shot file POST.
 *
 * POST /api/media?filename=<name>
 *   Body: raw file bytes (Content-Type header determines the MIME type)
 *   Response: { url, filename, mimeType, size }
 *
 * Max size: 5 MB (logos). Storage: ./data/uploads.
 */

import {
  defineEventHandler,
  getHeader,
  getQuery,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "node:fs";
import path from "node:path";

const UPLOADS_DIR = path.resolve("data/uploads");
const MAX_BYTES = 5 * 1024 * 1024;

// Ensure the uploads dir exists at startup (best effort — edge runtimes have
// no filesystem, so we silently fall through and fail at write time).
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch {
  // no-op
}

function randId(): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

export default defineEventHandler(async (event: H3Event) => {
  const raw = await readRawBody(event, false);
  if (!raw || !(raw as Buffer | Uint8Array).length) {
    setResponseStatus(event, 400);
    return { error: "Empty upload" };
  }
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : new Uint8Array(
          (raw as Buffer).buffer,
          (raw as Buffer).byteOffset,
          (raw as Buffer).byteLength,
        );
  if (bytes.byteLength > MAX_BYTES) {
    setResponseStatus(event, 413);
    return { error: "File too large (max 5 MB)" };
  }

  const mimeType =
    getHeader(event, "content-type") || "application/octet-stream";
  const query = getQuery(event);
  const originalName =
    typeof query.filename === "string" ? query.filename : "upload";

  // Prefer the extension from the original filename; fall back to MIME.
  let ext = path.extname(originalName).toLowerCase();
  if (!ext) ext = EXT_BY_MIME[mimeType] ?? ".bin";

  const id = `${randId()}${ext}`;
  const filePath = path.join(UPLOADS_DIR, id);

  try {
    fs.writeFileSync(filePath, bytes);
  } catch (err) {
    console.error("[clips media] write failed:", err);
    setResponseStatus(event, 500);
    return { error: "Upload failed" };
  }

  return {
    url: `/api/media/${id}`,
    filename: id,
    originalName,
    mimeType,
    size: bytes.byteLength,
  };
});
