import { appApiPath } from "@agent-native/core/client/api-path";
import type { ComposeAttachment } from "@shared/types";

export interface UploadResult {
  url: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
}

/**
 * Why storage refused an upload, so the toast can offer the fix that applies:
 * Builder.io refused its connection, the workspace bucket refused its keys, or
 * nothing is set up.
 */
export type StorageSetupReason =
  | "builder-refused"
  | "storage-refused"
  | "not-configured";

function isStorageSetupReason(value: unknown): value is StorageSetupReason {
  return (
    value === "builder-refused" ||
    value === "storage-refused" ||
    value === "not-configured"
  );
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly storageSetup: StorageSetupReason | null,
  ) {
    super(message);
  }
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const buffer = await file.arrayBuffer();
  const resp = await fetch(
    appApiPath(`/api/media/upload?filename=${encodeURIComponent(file.name)}`),
    {
      method: "POST",
      body: buffer,
    },
  );
  if (!resp.ok) {
    let errorMessage = `Upload failed: ${resp.statusText}`;
    let storageSetup: StorageSetupReason | null = null;
    try {
      const body = (await resp.json()) as {
        error?: unknown;
        storageSetupRequired?: unknown;
        storageSetupReason?: unknown;
      };
      if (typeof body.error === "string") errorMessage = body.error;
      if (body.storageSetupRequired === true) {
        // A server without reasons only refused for missing storage.
        storageSetup = isStorageSetupReason(body.storageSetupReason)
          ? body.storageSetupReason
          : "not-configured";
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // Use the HTTP status when the server did not return JSON.
    }
    throw new UploadError(errorMessage, storageSetup);
  }
  return resp.json();
}

export function uploadResultToAttachment(
  result: UploadResult,
): ComposeAttachment {
  return {
    id: result.filename,
    filename: result.filename,
    originalName: result.originalName,
    mimeType: result.mimeType,
    size: result.size,
    url: result.url,
  };
}

export async function uploadFiles(files: File[]): Promise<ComposeAttachment[]> {
  const uploaded: ComposeAttachment[] = [];
  for (const file of files) {
    uploaded.push(uploadResultToAttachment(await uploadFile(file)));
  }
  return uploaded;
}

export function openFilePicker(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
