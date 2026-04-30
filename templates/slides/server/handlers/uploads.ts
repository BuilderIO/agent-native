import {
  defineEventHandler,
  setResponseStatus,
  readMultipartFormData,
} from "h3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getSession } from "@agent-native/core/server";

const UPLOADS_ROOT = path.join(process.cwd(), "data", "uploads");
const ALLOWED_EXTENSIONS = new Set([
  ".pptx",
  ".docx",
  ".pdf",
  ".txt",
  ".md",
  ".csv",
  ".json",
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
  const base =
    path
      .basename(originalName, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80) || "upload";
  return `${base}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
}

function hasExpectedSignature(ext: string, data: Buffer): boolean {
  if (ext === ".pdf") {
    return data.subarray(0, 5).toString("ascii") === "%PDF-";
  }
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
    const header = data.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (ext === ".webp") {
    return (
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return !data.subarray(0, 4096).includes(0);
}

// Upload one or more files
export const uploadFiles = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const parts = await readMultipartFormData(event);
  const fileParts =
    parts?.filter(
      (p) => (p.name === "files" || p.name === "file") && p.data,
    ) ?? [];

  if (fileParts.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No files uploaded" };
  }

  const MAX_FILES = 20;
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

  if (fileParts.length > MAX_FILES) {
    setResponseStatus(event, 413);
    return { error: `Too many files (max ${MAX_FILES})` };
  }

  const oversized = fileParts.find((p) => p.data.length > MAX_FILE_SIZE);
  if (oversized) {
    setResponseStatus(event, 413);
    return { error: "File too large (max 50 MB per file)" };
  }

  let results;
  try {
    results = await Promise.all(
      fileParts.map(async (part) => {
        const originalName = part.filename || "upload";
        const filename = safeFilename(originalName);
        if (!filename) {
          throw new Error(
            "Unsupported file type. Allowed: pptx, docx, pdf, text, JSON, CSV, and raster images.",
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
        return {
          path: path
            .relative(process.cwd(), destPath)
            .split(path.sep)
            .join("/"),
          originalName,
          filename,
          type: part.type || "application/octet-stream",
          size: part.data.length,
        };
      }),
    );
  } catch (err) {
    setResponseStatus(event, 400);
    return { error: err instanceof Error ? err.message : "Invalid upload" };
  }

  return results;
});
