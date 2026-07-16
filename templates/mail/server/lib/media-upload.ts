import fs from "node:fs";
import path from "node:path";

import { uploadFile } from "@agent-native/core/file-upload";

import { getStoredUpload, putStoredUpload } from "./upload-store.js";

const UPLOADS_DIR = path.resolve("data/uploads");

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

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface StoredMediaUpload {
  url: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  provider?: string;
}

export class MediaStorageSetupError extends Error {
  readonly storageSetupRequired = true;
}

export function extensionForUpload(originalName: string): string {
  return path.extname(originalName).toLowerCase() || ".bin";
}

export function mimeTypeForUpload(originalName: string): string {
  return (
    MIME_MAP[extensionForUpload(originalName)] || "application/octet-stream"
  );
}

export function uploadsDirectory(): string {
  return UPLOADS_DIR;
}

export async function storeMediaUpload(input: {
  ownerEmail: string;
  data: Uint8Array;
  filename: string;
  originalName: string;
}): Promise<StoredMediaUpload> {
  if (input.data.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("File too large (max 10 MB)");
  }

  const mimeType = mimeTypeForUpload(input.originalName);
  const payload = {
    url: `/api/media/${input.filename}`,
    filename: input.filename,
    originalName: input.originalName,
    mimeType,
    size: input.data.byteLength,
  };

  try {
    const uploaded = await uploadFile({
      data: input.data,
      filename: input.originalName,
      mimeType,
      ownerEmail: input.ownerEmail,
      recordAsset: false,
    });
    if (uploaded?.url) {
      await putStoredUpload(input.ownerEmail, {
        ...payload,
        url: uploaded.url,
        createdAt: Date.now(),
      });
      const persisted = await getStoredUpload(input.ownerEmail, input.filename);
      if (persisted?.url !== uploaded.url) {
        throw new Error("Uploaded file metadata did not persist");
      }
      return { ...payload, url: uploaded.url, provider: uploaded.provider };
    }
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
  }

  if (process.env.NODE_ENV === "production") {
    throw new MediaStorageSetupError(
      "File storage is not configured. Connect Builder.io or another upload provider before attaching files in hosted environments.",
    );
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filePath = path.join(UPLOADS_DIR, input.filename);
  fs.writeFileSync(filePath, input.data);
  const storedSize = fs.statSync(filePath).size;
  if (storedSize !== input.data.byteLength) {
    throw new Error("Uploaded file did not persist completely");
  }
  return payload;
}
