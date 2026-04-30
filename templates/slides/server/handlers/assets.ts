import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  readMultipartFormData,
} from "h3";
import path from "path";
import fs from "fs";
import { getSession } from "@agent-native/core/server";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

async function requireSession(event: Parameters<typeof getSession>[0]) {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return null;
  }
  return session;
}

// Ensure uploads directory exists (skip on edge runtimes like CF Workers)
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch {}

// Upload an asset
export const uploadAsset = defineEventHandler(async (event) => {
  const session = await requireSession(event);
  if (!session) {
    return { error: "Unauthorized" };
  }

  const parts = await readMultipartFormData(event);
  const filePart = parts?.find((p) => p.name === "file");
  if (!filePart || !filePart.data) {
    setResponseStatus(event, 400);
    return { error: "No file uploaded" };
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  if (filePart.data.length > MAX_FILE_SIZE) {
    setResponseStatus(event, 413);
    return { error: "File too large (max 10 MB)" };
  }

  const originalName = filePart.filename || "upload";
  const ext = path.extname(originalName);
  // SVG is excluded — it can embed <script> tags and execute when served
  // as image/svg+xml from the same origin.
  const allowed = /\.(jpg|jpeg|png|gif|webp|avif|ico)$/i;
  if (!allowed.test(ext)) {
    setResponseStatus(event, 400);
    return {
      error:
        "Only raster image files are allowed (jpg, png, gif, webp, avif, ico)",
    };
  }

  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${base}-${Date.now()}${ext}`;
  const destPath = path.join(UPLOADS_DIR, filename);

  await fs.promises.writeFile(destPath, filePart.data);

  return {
    url: `/uploads/${filename}`,
    filename,
    type: filePart.type || "application/octet-stream",
    size: filePart.data.length,
  };
});

// List all assets
export const listAssets = defineEventHandler(async (event) => {
  const session = await requireSession(event);
  if (!session) {
    return { error: "Unauthorized" };
  }

  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    const assets = files
      .filter((f) => !/^\./.test(f))
      .map((filename) => {
        const filePath = path.join(UPLOADS_DIR, filename);
        const stat = fs.statSync(filePath);
        return {
          url: `/uploads/${filename}`,
          filename,
          size: stat.size,
          createdAt: stat.birthtime.toISOString(),
        };
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    return assets;
  } catch {
    return [];
  }
});

// Delete an asset
export const deleteAsset = defineEventHandler(async (event) => {
  const session = await requireSession(event);
  if (!session) {
    return { error: "Unauthorized" };
  }

  const filenameParam = getRouterParam(event, "filename");
  if (!filenameParam) {
    setResponseStatus(event, 400);
    return { error: "Filename is required" };
  }
  const filename = path.basename(filenameParam);
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }
  fs.unlinkSync(filePath);
  return { success: true };
});
