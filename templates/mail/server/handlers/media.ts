import fs from "node:fs";
import path from "node:path";

import { streamFile, getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  readRawBody,
  getRouterParam,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";

import { getStoredUpload, putStoredUpload } from "../lib/upload-store.js";

const UPLOADS_DIR = path.resolve("data/uploads");

// Ensure uploads directory exists (guarded for edge runtimes without filesystem)
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch {
  // Edge runtime (e.g. Cloudflare Workers) — no local filesystem
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

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const uploadMedia = defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  try {
    const body = await readRawBody(event, false);
    if (!body || !body.byteLength) {
      setResponseStatus(event, 400);
      return { error: "No file data" };
    }

    if (body.byteLength > MAX_UPLOAD_BYTES) {
      setResponseStatus(event, 413);
      return { error: "File too large (max 10 MB)" };
    }

    const originalName = (getQuery(event).filename as string) || "upload";
    const ext = path.extname(originalName).toLowerCase() || ".bin";
    const id = nanoid(12) + ext;
    const filePath = path.join(UPLOADS_DIR, id);

    const mimeType = MIME_MAP[ext] || "application/octet-stream";
    const payload = {
      url: `/api/media/${id}`,
      filename: id,
      originalName,
      mimeType,
      size: body.byteLength,
    };

    try {
      fs.writeFileSync(filePath, body);
    } catch {
      await putStoredUpload(session.email, {
        ...payload,
        dataBase64: Buffer.from(body).toString("base64"),
        createdAt: Date.now(),
      });
    }

    return payload;
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
  const ext = path.extname(filename).toLowerCase();

  if (!fs.existsSync(filePath)) {
    const session = await getSession(event).catch(() => null);
    const stored = session?.email
      ? await getStoredUpload(session.email, filename)
      : null;
    if (!stored) {
      setResponseStatus(event, 404);
      return { error: "File not found" };
    }

    setResponseHeader(event, "Content-Type", stored.mimeType);
    setResponseHeader(
      event,
      "Cache-Control",
      "private, max-age=31536000, immutable",
    );
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    if (ext === ".svg" || ext === ".html" || ext === ".htm") {
      setResponseHeader(
        event,
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
    }
    return Buffer.from(stored.dataBase64, "base64");
  }

  const mimeType = MIME_MAP[ext] || "application/octet-stream";

  setResponseHeader(event, "Content-Type", mimeType);
  setResponseHeader(
    event,
    "Cache-Control",
    "public, max-age=31536000, immutable",
  );
  // Always send X-Content-Type-Options: nosniff so browsers don't MIME-sniff
  // a polyglot upload (e.g. an SVG/HTML file uploaded with a `.png` extension)
  // into HTML and execute any embedded `<script>`. The Content-Disposition
  // attachment fallback below covers the documented SVG/HTML extensions; this
  // header closes the polyglot bypass for every other type too.
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  // Force download for SVG and other types that could execute scripts inline.
  if (ext === ".svg" || ext === ".html" || ext === ".htm") {
    setResponseHeader(
      event,
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
  }
  return streamFile(fs.createReadStream(filePath));
});
