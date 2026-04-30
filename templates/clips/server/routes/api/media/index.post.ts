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
import { getSession, runWithRequestContext } from "@agent-native/core/server";

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
};

function hasExpectedImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/gif") {
    const header = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return (
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    );
  }
  return false;
}

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

export default defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
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

      const mimeType = (
        getHeader(event, "content-type") || "application/octet-stream"
      )
        .split(";")[0]
        .trim()
        .toLowerCase();
      const ext = EXT_BY_MIME[mimeType];
      if (!ext) {
        setResponseStatus(event, 400);
        return { error: "Only PNG, JPEG, GIF, and WebP images are allowed" };
      }
      if (!hasExpectedImageSignature(bytes, mimeType)) {
        setResponseStatus(event, 400);
        return { error: "Uploaded image bytes do not match Content-Type" };
      }

      const query = getQuery(event);
      const originalName =
        typeof query.filename === "string" ? query.filename : "upload";

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
        url: appPath(`/api/media/${id}`),
        filename: id,
        originalName,
        mimeType,
        size: bytes.byteLength,
      };
    },
  );
});
