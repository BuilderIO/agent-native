import crypto from "crypto";
import fs from "fs";
import path from "path";

import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getRequestHeader,
  readMultipartFormData,
  setResponseStatus,
} from "h3";
import { nanoid } from "nanoid";

const UPLOADS_ROOT = path.join(process.cwd(), "data", "uploads");
const MAX_EXTRACTED_TEXT_CHARS = 8_000;
const TEXT_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".txt",
  ".md",
  ".csv",
]);
const ALLOWED_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".txt",
  ".md",
  ".csv",
  ".pdf",
  ".docx",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

function tenantUploadDir(email: string): string {
  const key = crypto
    .createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
  return path.join(UPLOADS_ROOT, key);
}

function safeFilename(originalName: string): string | null {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  // Filename uniqueness comes from nanoid (~21 chars, ~126 bits of entropy),
  // not `Date.now()` — second-resolution timestamps are guessable and let
  // someone with the per-tenant URL prefix probe the upload window. The
  // tenant subdir already namespaces by user; nanoid makes the leaf
  // unguessable too. (audit 10 medium / audit 01 medium).
  return `${nanoid()}${ext}`;
}

function ascii(data: Uint8Array, start: number, end: number): string {
  return Buffer.from(data.subarray(start, end)).toString("ascii");
}

function hasExpectedSignature(ext: string, data: Uint8Array): boolean {
  if (ext === ".pdf") return ascii(data, 0, 5) === "%PDF-";
  if (ext === ".pptx" || ext === ".docx") {
    return data[0] === 0x50 && data[1] === 0x4b;
  }
  if (ext === ".png") {
    return (
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    );
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (ext === ".gif") {
    const header = ascii(data, 0, 6);
    return header === "GIF87a" || header === "GIF89a";
  }
  if (ext === ".webp") {
    return ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP";
  }
  return !data.subarray(0, 4096).includes(0);
}

function truncateExtractedText(text: string): {
  textContent?: string;
  textTruncated?: boolean;
} {
  const normalized = text.replace(/\0/g, "").trim();
  if (!normalized) return {};
  if (normalized.length <= MAX_EXTRACTED_TEXT_CHARS) {
    return { textContent: normalized };
  }
  return {
    textContent: normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS),
    textTruncated: true,
  };
}

async function extractUploadText(
  ext: string,
  data: Uint8Array,
): Promise<{ textContent?: string; textTruncated?: boolean }> {
  if (TEXT_EXTENSIONS.has(ext)) {
    return truncateExtractedText(Buffer.from(data).toString("utf8"));
  }

  if (ext === ".pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const pdf = new PDFParse({ data: new Uint8Array(data) });
      const result = await pdf.getText();
      return truncateExtractedText(result.text ?? "");
    } catch {
      return {};
    }
  }

  return {};
}

type UploadedFileResult = {
  path: string;
  originalName: string;
  filename: string;
  type: string;
  size: number;
  textContent?: string;
  textTruncated?: boolean;
};

type InternalUploadedFileResult = UploadedFileResult & {
  _destPath: string;
};

export const uploadFiles = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const MAX_FILES = 20;
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  // Total-body pre-flight: reject before buffering if Content-Length is clearly
  // over the theoretical max (MAX_FILES × MAX_FILE_SIZE each, plus overhead).
  // Content-Length can be spoofed but cheaply eliminates accidental oversized
  // uploads without allocating any memory for the body first.
  const TOTAL_BODY_LIMIT = MAX_FILES * MAX_FILE_SIZE;
  const contentLength = Number(
    getRequestHeader(event, "content-length") ?? "0",
  );
  if (contentLength > TOTAL_BODY_LIMIT) {
    setResponseStatus(event, 413);
    return { error: "Request body too large" };
  }

  const parts = await readMultipartFormData(event);
  const fileParts = parts?.filter((p) => p.name === "files" && p.data) ?? [];

  if (fileParts.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No files uploaded" };
  }

  if (fileParts.length > MAX_FILES) {
    setResponseStatus(event, 413);
    return { error: `Too many files (max ${MAX_FILES})` };
  }

  const oversized = fileParts.find((p) => p.data.length > MAX_FILE_SIZE);
  if (oversized) {
    setResponseStatus(event, 413);
    return { error: "File too large (max 50 MB per file)" };
  }

  const results = await Promise.allSettled<InternalUploadedFileResult>(
    fileParts.map(async (part) => {
      const originalName = part.filename || "upload";
      const filename = safeFilename(originalName);
      if (!filename) {
        throw new Error(
          "Unsupported file type. Allowed: code, docs, text, JSON, CSV, and raster images.",
        );
      }
      const ext = path.extname(filename).toLowerCase();
      if (!hasExpectedSignature(ext, part.data)) {
        throw new Error(`File contents do not match ${ext} upload type`);
      }
      const uploadDir = tenantUploadDir(session.email);
      await fs.promises.mkdir(uploadDir, { recursive: true });
      const destPath = path.join(uploadDir, filename);
      await fs.promises.writeFile(destPath, part.data);
      const extracted = await extractUploadText(ext, part.data);

      return {
        // Return the filename (nanoid + ext) as the opaque path token rather
        // than the internal filesystem path so we don't expose the server
        // directory layout or per-tenant hash to the client.
        path: filename,
        originalName,
        filename,
        type: part.type || "application/octet-stream",
        size: part.data.length,
        ...extracted,
        _destPath: destPath,
      };
    }),
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    // Clean up any files that were successfully written before the failure.
    const writtenPaths = results
      .filter((r) => r.status === "fulfilled")
      .map(
        (r) =>
          (r as PromiseFulfilledResult<InternalUploadedFileResult>).value
            ._destPath,
      );
    await Promise.allSettled(writtenPaths.map((p) => fs.promises.unlink(p)));

    const firstError = (failures[0] as PromiseRejectedResult).reason;
    setResponseStatus(event, 400);
    return {
      error:
        firstError instanceof Error ? firstError.message : "Invalid upload",
    };
  }

  // Strip the internal _destPath field before returning to the client.
  return results.map((r) => {
    const { _destPath: _unused, ...rest } = (
      r as PromiseFulfilledResult<InternalUploadedFileResult>
    ).value;
    return rest;
  });
});
