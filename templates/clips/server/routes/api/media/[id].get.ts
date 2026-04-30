/**
 * Serve an uploaded media file by id (brand logos, etc.).
 *
 * GET /api/media/:id
 */

import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "node:fs";
import path from "node:path";

const UPLOADS_DIR = path.resolve("data/uploads");

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export default defineEventHandler((event: H3Event) => {
  const id = getRouterParam(event, "id");
  if (!id || id.includes("/") || id.includes("..")) {
    setResponseStatus(event, 400);
    return { error: "Bad id" };
  }
  const filePath = path.join(UPLOADS_DIR, id);
  if (!fs.existsSync(filePath)) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
  const ext = path.extname(id).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  setResponseHeader(event, "Content-Type", mime);
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(
    event,
    "Cache-Control",
    "public, max-age=31536000, immutable",
  );
  return fs.readFileSync(filePath);
});
