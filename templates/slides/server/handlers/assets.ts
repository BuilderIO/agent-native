import {
  defineEventHandler,
  setResponseStatus,
  readMultipartFormData,
} from "h3";
import path from "path";
import { getSession } from "@agent-native/core/server";
import { uploadFile } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";

export const MAX_ASSET_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export interface UploadedAsset {
  url: string;
  filename: string;
  type: string;
  size: number;
  provider?: string;
}

async function requireSession(event: Parameters<typeof getSession>[0]) {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return null;
  }
  return session;
}

function isRasterAssetExtension(ext: string): boolean {
  return new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".avif",
    ".ico",
  ]).has(ext);
}

function ascii(data: Uint8Array, start: number, end: number): string {
  return Buffer.from(data.subarray(start, end)).toString("ascii");
}

function hasExpectedImageSignature(ext: string, data: Uint8Array): boolean {
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
  if (ext === ".ico") {
    return (
      data[0] === 0x00 &&
      data[1] === 0x00 &&
      data[2] === 0x01 &&
      data[3] === 0x00
    );
  }
  if (ext === ".avif") {
    return ascii(data, 4, 12).includes("ftyp");
  }
  return false;
}

export function canSaveAsUploadedAsset(args: {
  originalName: string;
  data: Uint8Array;
}): boolean {
  return (
    args.data.length <= MAX_ASSET_FILE_SIZE &&
    isRasterAssetExtension(path.extname(args.originalName).toLowerCase())
  );
}

/**
 * Upload an image asset through the framework's `uploadFile()` provider chain.
 *
 * All uploads go to the configured remote provider — Builder.io by default,
 * or any provider registered via `registerFileUploadProvider()` (S3, R2, etc.).
 * There is intentionally NO local-disk fallback: writing into the source tree
 * (`public/uploads/`) pollutes git, doesn't persist on serverless deploys,
 * and isn't reachable across nodes. If no provider is configured, the request
 * fails with a clear 503 instructing the caller to configure one — connect
 * Builder.io or register a custom provider.
 */
export async function uploadImageAsset(args: {
  email: string;
  originalName: string;
  data: Uint8Array;
  type?: string;
}): Promise<UploadedAsset> {
  if (args.data.length > MAX_ASSET_FILE_SIZE) {
    throw new Error("File too large (max 10 MB)");
  }

  const ext = path.extname(args.originalName).toLowerCase();
  // SVG is excluded — it can embed <script> tags and execute when served
  // as image/svg+xml from the same origin.
  if (!isRasterAssetExtension(ext)) {
    throw new Error(
      "Only raster image files are allowed (jpg, png, gif, webp, avif, ico)",
    );
  }
  if (!hasExpectedImageSignature(ext, args.data)) {
    throw new Error("Uploaded image bytes do not match file extension");
  }

  const result = await runWithRequestContext({ userEmail: args.email }, () =>
    uploadFile({
      data: args.data,
      filename: args.originalName,
      mimeType: args.type,
      ownerEmail: args.email,
    }),
  );

  if (!result) {
    const err: Error & { statusCode?: number } = new Error(
      "No file upload provider is configured. Connect Builder.io in Settings → File uploads, set BUILDER_PRIVATE_KEY, or register a custom provider via registerFileUploadProvider().",
    );
    err.statusCode = 503;
    throw err;
  }

  return {
    url: result.url,
    filename: args.originalName,
    type: args.type || "application/octet-stream",
    size: args.data.length,
    provider: result.provider,
  };
}

/**
 * POST /api/assets/upload — receive a single image file, route it through the
 * framework provider chain, return its hosted URL.
 */
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

  if (filePart.data.length > MAX_ASSET_FILE_SIZE) {
    setResponseStatus(event, 413);
    return { error: "File too large (max 10 MB)" };
  }

  try {
    return await uploadImageAsset({
      email: session.email,
      originalName: filePart.filename || "upload",
      data: filePart.data,
      type: filePart.type,
    });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode ?? 400;
    setResponseStatus(event, status);
    return {
      error: error instanceof Error ? error.message : "Image upload failed",
    };
  }
});

/**
 * GET /api/assets — list previously-uploaded assets.
 *
 * Asset history used to come from scanning `public/uploads/<tenant>/` on disk.
 * That source is gone now (see `uploadImageAsset` for the reasoning). Until
 * we plumb a SQL-backed asset index that records each upload (so we can list
 * across providers), this endpoint returns an empty list. The AssetLibraryPanel
 * still works for uploading new images and selecting them for the current
 * editing session.
 */
export const listAssets = defineEventHandler(async (event) => {
  const session = await requireSession(event);
  if (!session) {
    return { error: "Unauthorized" };
  }
  return [];
});

/**
 * DELETE /api/assets/:filename — used to delete from `public/uploads/`. With
 * uploads routed through Builder.io / S3 / etc., deletion has to happen via
 * the active provider's API. Returning 501 keeps the endpoint reachable so
 * the frontend doesn't error, and signals that this isn't wired yet.
 */
export const deleteAsset = defineEventHandler(async (event) => {
  const session = await requireSession(event);
  if (!session) {
    return { error: "Unauthorized" };
  }
  setResponseStatus(event, 501);
  return {
    error:
      "Asset deletion via this endpoint is not implemented — uploads now live in the configured file-upload provider (Builder.io, S3, etc.). Delete them through the provider's dashboard.",
  };
});
