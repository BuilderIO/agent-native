import fs from "node:fs";
import path from "node:path";

import { noteExternalWrite } from "@agent-native/core/action";
import { uploadFile } from "@agent-native/core/file-upload";
import {
  getRequestContext,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";

import type { ComposeAttachment } from "../../shared/types.js";
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
  ".md": "text/markdown",
  ".markdown": "text/markdown",
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

// Each message names every way to fix it, so a workspace that would rather keep
// files in its own bucket learns that it can.
export const BUILDER_REFUSED_MESSAGE =
  "Builder.io refused Mail's file storage connection, so this file wasn't attached. Reconnect Builder.io in Settings > Model, or use your own storage bucket in Settings > Infrastructure > File uploads and storage, then attach the file again.";

export const STORAGE_REFUSED_MESSAGE =
  "Your file storage bucket refused this upload, so the file wasn't attached. Check the bucket and its keys in Settings > Infrastructure > File uploads and storage, then attach the file again.";

export const STORAGE_NOT_CONFIGURED_MESSAGE =
  "File storage isn't set up, so this file wasn't attached. Connect Builder.io or your own S3-compatible bucket in Settings > Infrastructure > File uploads and storage, then attach the file again.";

export type MediaStorageSetupReason =
  | "builder-refused"
  | "storage-refused"
  | "not-configured";

export class MediaStorageSetupError extends Error {
  readonly storageSetupRequired = true;

  constructor(
    readonly reason: MediaStorageSetupReason,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Builder refused the credential itself, so retrying can't help until someone
 * reconnects. A 401 or 403 only counts when Builder's own API sent it: one from
 * the signed storage URL or another provider isn't about this connection.
 */
function isBuilderReconnectFailure(error: unknown): boolean {
  const details = (error ?? {}) as {
    errorCode?: unknown;
    message?: unknown;
    status?: unknown;
  };
  const message = typeof details.message === "string" ? details.message : "";
  return (
    details.errorCode === "builder_credentials_rejected" ||
    details.errorCode === "builder_oauth_reauthorization_required" ||
    ((details.status === 401 || details.status === 403) &&
      message.startsWith("Builder.io")) ||
    /sign in to builder\.io again/i.test(message)
  );
}

/**
 * The workspace's own S3-compatible bucket refused the write: wrong keys, a
 * policy that denies it, or a bucket that doesn't exist. Retrying can't help
 * until someone fixes the bucket's settings.
 */
function isOwnStorageRefusal(error: unknown): boolean {
  const details = (error ?? {}) as { provider?: unknown; status?: unknown };
  return (
    details.provider === "s3" &&
    (details.status === 401 || details.status === 403 || details.status === 404)
  );
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
  orgId?: string;
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
    const uploaded = await runWithRequestContext(
      {
        ...getRequestContext(),
        userEmail: input.ownerEmail,
        orgId: input.orgId ?? getRequestContext()?.orgId,
      },
      () =>
        uploadFile({
          data: input.data,
          filename: input.originalName,
          mimeType,
          ownerEmail: input.ownerEmail,
          recordAsset: false,
        }),
    );
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
    if (process.env.NODE_ENV === "production") {
      if (isBuilderReconnectFailure(error)) {
        console.error("[media] Builder refused the upload:", error);
        throw new MediaStorageSetupError(
          "builder-refused",
          BUILDER_REFUSED_MESSAGE,
        );
      }
      if (isOwnStorageRefusal(error)) {
        console.error("[media] The storage bucket refused the upload:", error);
        throw new MediaStorageSetupError(
          "storage-refused",
          STORAGE_REFUSED_MESSAGE,
        );
      }
      throw error;
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new MediaStorageSetupError(
      "not-configured",
      STORAGE_NOT_CONFIGURED_MESSAGE,
    );
  }

  noteExternalWrite("local-disk");
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filePath = path.join(UPLOADS_DIR, input.filename);
  fs.writeFileSync(filePath, input.data);
  const storedSize = fs.statSync(filePath).size;
  if (storedSize !== input.data.byteLength) {
    throw new Error("Uploaded file did not persist completely");
  }
  await putStoredUpload(input.ownerEmail, {
    ...payload,
    createdAt: Date.now(),
  });
  return payload;
}

/**
 * Turns the handle an upload returned into a draft attachment. Uploads are
 * read per owner, so a handle can't reach someone else's file.
 */
export async function attachmentFromUpload(
  ownerEmail: string,
  handle: { filename: string; originalName?: string | undefined },
): Promise<ComposeAttachment | null> {
  const { filename } = handle;
  if (/[\\/]/.test(filename) || filename.includes("..")) return null;

  const stored = await getStoredUpload(ownerEmail, filename);
  if (!stored) return null;
  return {
    id: filename,
    filename,
    originalName: handle.originalName || stored.originalName,
    mimeType: stored.mimeType,
    size: stored.size,
    url: stored.url ?? `/api/media/${filename}`,
  };
}
