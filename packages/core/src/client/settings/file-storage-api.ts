import type {
  S3StorageFieldError,
  S3StorageStatus,
  S3StorageValues,
  SaveS3StorageErrorResponse,
  SaveS3StorageRequest,
  SaveS3StorageResponse,
} from "../../shared/s3-storage-config.js";
import { agentNativePath } from "../api-path.js";

export interface FileUploadProviderStatus {
  id: string;
  name: string;
  configured: boolean;
}

/** `GET /_agent-native/file-upload/status`. */
export interface FileUploadStatus {
  configured: boolean;
  activeProvider: { id: string; name: string } | null;
  providers: FileUploadProviderStatus[];
  builderConfigured: boolean;
  builderUploadConfigured?: boolean;
  builderReauthorizationRequired?: boolean;
  /** Present when a registered provider holds the "s3" upload slot. */
  s3?: S3StorageStatus;
}

/** Mirrors `HostEnvironmentStatusResult`: "unavailable" must never render as "not configured". */
export type FileUploadStatusResult =
  | { state: "loading" }
  | { state: "ready"; value: FileUploadStatus }
  | { state: "unavailable" };

export async function fetchFileUploadStatus(): Promise<FileUploadStatusResult> {
  try {
    const response = await fetch(
      agentNativePath("/_agent-native/file-upload/status"),
      { credentials: "include" },
    );
    if (!response.ok) return { state: "unavailable" };
    const value = (await response.json()) as FileUploadStatus;
    return { state: "ready", value };
  } catch {
    return { state: "unavailable" };
  }
}

/**
 * Thrown by `saveS3StorageConfig`. `fieldErrors` is populated for a 400
 * (client-fixable validation) and empty for other failures (401/403/409/500),
 * where `message` is the only thing worth showing.
 */
export class SaveS3StorageError extends Error {
  readonly status: number;
  readonly fieldErrors: S3StorageFieldError[];

  constructor(message: string, status: number, fieldErrors: S3StorageFieldError[] = []) {
    super(message);
    this.name = "SaveS3StorageError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export async function saveS3StorageConfig(
  values: S3StorageValues,
): Promise<SaveS3StorageResponse> {
  const response = await fetch(
    agentNativePath("/_agent-native/file-upload/s3-config"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values } satisfies SaveS3StorageRequest),
    },
  );

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // No/invalid JSON body — the status-based message below still applies.
  }

  if (!response.ok) {
    const errorBody = body as Partial<SaveS3StorageErrorResponse> | null;
    throw new SaveS3StorageError(
      errorBody?.error ?? `Could not save storage keys (HTTP ${response.status})`,
      response.status,
      Array.isArray(errorBody?.fieldErrors) ? errorBody.fieldErrors : [],
    );
  }

  return body as SaveS3StorageResponse;
}
