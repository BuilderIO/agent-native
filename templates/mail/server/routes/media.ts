import {
  defineEventHandler,
  getQuery,
  readRawBody,
  getRouterParam,
  setResponseStatus,
  setResponseHeader,
  sendStream,
  type H3Event,
} from "h3";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

const UPLOADS_DIR = path.resolve("data/uploads");

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

export const uploadMedia = defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readRawBody(event);
    if (!body || !body.length) {
      setResponseStatus(event, 400);
      return { error: "No file data" };
    }

    const originalName = (getQuery(event).filename as string) || "upload";
    const ext = path.extname(originalName).toLowerCase() || ".bin";
    const id = nanoid(12) + ext;
    const filePath = path.join(UPLOADS_DIR, id);

    fs.writeFileSync(filePath, body);

    const mimeType = MIME_MAP[ext] || "application/octet-stream";

    return {
      url: `/api/media/${id}`,
      filename: id,
      originalName,
      mimeType,
      size: body.length,
    };
  } catch (err) {
    console.error("[media] Upload failed:", err);
    setResponseStatus(event, 500);
    return { error: "Upload failed" };
  }
});

export const serveMedia = defineEventHandler(async (event: H3Event) => {
  const filename = getRouterParam(event, "filename") as string;

  // Prevent directory traversal
  if (filename.includes("..") || filename.includes("/")) {
    setResponseStatus(event, 400);
    return { error: "Invalid filename" };
  }

  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";

  setResponseHeader(event, "Content-Type", mimeType);
  setResponseHeader(event, "Cache-Control", "public, max-age=31536000, immutable");
  return sendStream(event, fs.createReadStream(filePath));
});
