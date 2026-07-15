import fs from "node:fs";
import path from "node:path";

import { streamFile, getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getHeader,
  getQuery,
  readRawBody,
  getRouterParam,
  sendRedirect,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";

import {
  claimAttachmentUploadTicket,
  verifyAttachmentUploadTicket,
} from "../lib/attachment-upload-ticket.js";
import {
  MAX_UPLOAD_BYTES,
  MediaStorageSetupError,
  mimeTypeForUpload,
  storeMediaUpload,
  uploadsDirectory,
} from "../lib/media-upload.js";
import { getStoredUpload } from "../lib/upload-store.js";

const UPLOADS_DIR = uploadsDirectory();

// Ensure uploads directory exists (guarded for edge runtimes without filesystem)
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch {
  // Edge runtime (e.g. Cloudflare Workers) — no local filesystem
}

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
    return await storeMediaUpload({
      ownerEmail: session.email,
      data: body instanceof Uint8Array ? body : new Uint8Array(body),
      filename: nanoid(12) + ext,
      originalName,
    });
  } catch (err) {
    if (err instanceof MediaStorageSetupError) {
      setResponseStatus(event, 503);
      return {
        error: err.message,
        storageSetupRequired: true,
      };
    }
    console.error("[media] Upload failed:", err);
    setResponseStatus(event, 500);
    return { error: "Upload failed" };
  }
});

export const uploadAttachmentWithTicket = defineEventHandler(
  async (event: H3Event) => {
    const uploadId = getRouterParam(event, "uploadId") as string;
    const authorization = getHeader(event, "authorization") || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";
    // Reject an invalid bearer before buffering request bytes. The later
    // atomic claim remains the concurrency boundary immediately before the
    // storage side effect.
    const verified = await verifyAttachmentUploadTicket(uploadId, token);
    if (!verified) {
      setResponseStatus(event, 401);
      return { error: "Invalid or expired attachment upload URL" };
    }
    const body = await readRawBody(event, false);
    if (!body || !body.byteLength) {
      setResponseStatus(event, 400);
      return { error: "No file data" };
    }
    if (body.byteLength > MAX_UPLOAD_BYTES) {
      setResponseStatus(event, 413);
      return { error: "File too large (max 10 MB)" };
    }

    const claimed = await claimAttachmentUploadTicket(uploadId, token);
    if (!claimed) {
      setResponseStatus(event, 401);
      return { error: "Invalid or expired attachment upload URL" };
    }

    try {
      const uploaded = await storeMediaUpload({
        ownerEmail: claimed.ownerEmail,
        data: body instanceof Uint8Array ? body : new Uint8Array(body),
        filename: claimed.ticket.filename,
        originalName: claimed.ticket.originalName,
      });
      return {
        ...uploaded,
        attachment: {
          filename: uploaded.filename,
          originalName: uploaded.originalName,
          mimeType: uploaded.mimeType,
        },
      };
    } catch (err) {
      if (err instanceof MediaStorageSetupError) {
        setResponseStatus(event, 503);
        return { error: err.message, storageSetupRequired: true };
      }
      console.error("[media] Ticketed attachment upload failed:", err);
      setResponseStatus(event, 500);
      return { error: "Upload failed" };
    }
  },
);

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
    if (stored.url) {
      return sendRedirect(event, stored.url, 302);
    }
    if (!stored.dataBase64) {
      setResponseStatus(event, 404);
      return { error: "File data not found" };
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

  const mimeType = mimeTypeForUpload(filename);

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
