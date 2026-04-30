import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  readMultipartFormData,
} from "h3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getAppBasePath, getSession } from "@agent-native/core/server";
import { uploadedAssetUrlForBasePath } from "./assets-url.js";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

export function uploadedAssetUrl(filename: string): string {
  return uploadedAssetUrlForBasePath(filename, getAppBasePath());
}

async function requireSession(event: Parameters<typeof getSession>[0]) {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return null;
  }
  return session;
}

function tenantAssetKey(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

function tenantAssetDir(email: string): string {
  return path.join(UPLOADS_ROOT, tenantAssetKey(email));
}

function safeAssetFilename(originalName: string): string | null {
  const ext = path.extname(originalName).toLowerCase();
  const allowed = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".avif",
    ".ico",
  ]);
  if (!allowed.has(ext)) return null;
  const base =
    path
      .basename(originalName, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80) || "upload";
  return `${base}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
}

function hasExpectedImageSignature(ext: string, data: Buffer): boolean {
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
  if (ext === ".ico") {
    return (
      data[0] === 0x00 &&
      data[1] === 0x00 &&
      data[2] === 0x01 &&
      data[3] === 0x00
    );
  }
  if (ext === ".avif") {
    return data.subarray(4, 12).toString("ascii").includes("ftyp");
  }
  return false;
}

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
  const filename = safeAssetFilename(originalName);
  // SVG is excluded — it can embed <script> tags and execute when served
  // as image/svg+xml from the same origin.
  if (!filename) {
    setResponseStatus(event, 400);
    return {
      error:
        "Only raster image files are allowed (jpg, png, gif, webp, avif, ico)",
    };
  }
  const ext = path.extname(filename).toLowerCase();
  if (!hasExpectedImageSignature(ext, filePart.data)) {
    setResponseStatus(event, 400);
    return { error: "Uploaded image bytes do not match file extension" };
  }

  const assetKey = tenantAssetKey(session.email);
  const uploadDir = tenantAssetDir(session.email);
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const destPath = path.join(uploadDir, filename);

  await fs.promises.writeFile(destPath, filePart.data);

  return {
    url: uploadedAssetUrl(`${assetKey}/${filename}`),
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
    const assetKey = tenantAssetKey(session.email);
    const uploadDir = tenantAssetDir(session.email);
    const files = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : [];
    const assets = files
      .filter((f) => !/^\./.test(f))
      .map((filename) => {
        const filePath = path.join(uploadDir, filename);
        const stat = fs.statSync(filePath);
        return {
          url: uploadedAssetUrl(`${assetKey}/${filename}`),
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
  if (filenameParam.includes("/") || filenameParam.includes("..")) {
    setResponseStatus(event, 400);
    return { error: "Invalid filename" };
  }
  const filename = path.basename(filenameParam);
  const filePath = path.join(tenantAssetDir(session.email), filename);
  if (!fs.existsSync(filePath)) {
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }
  fs.unlinkSync(filePath);
  return { success: true };
});
