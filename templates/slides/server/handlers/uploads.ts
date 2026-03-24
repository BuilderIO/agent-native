import {
  defineEventHandler,
  setResponseStatus,
  readMultipartFormData,
} from "h3";
import path from "path";
import fs from "fs";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

// Ensure uploads directory exists (skip on edge runtimes like CF Workers)
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch {}

// Upload one or more files
export const uploadFiles = defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event);
  const fileParts = parts?.filter((p) => p.name === "files" && p.data) ?? [];

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

  const results = await Promise.all(
    fileParts.map(async (part) => {
      const originalName = part.filename || "upload";
      const ext = path.extname(originalName);
      const base = path
        .basename(originalName, ext)
        .replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `${base}-${Date.now()}${ext}`;
      const destPath = path.join(UPLOADS_DIR, filename);
      await fs.promises.writeFile(destPath, part.data);
      return {
        path: path.join("data", "uploads", filename),
        originalName,
        filename,
        type: part.type || "application/octet-stream",
        size: part.data.length,
      };
    }),
  );

  return results;
});
