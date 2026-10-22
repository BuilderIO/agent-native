import type { CaptureTitleResult } from "./recording-title";

export const RECORDING_SESSION_EXPIRED = "SESSION_EXPIRED";
export const RECORDING_SERVER_UNAVAILABLE = "SERVER_UNAVAILABLE";
const STORAGE_SETUP_FAILURE_RE =
  /video storage is not connected|no video storage configured|file upload provider|storage provider|(?:connect|use) builder|s3-compatible/i;

export type NativeRecordingVisibility = "private" | "org" | "public";

export interface NativeRecordingRequestOptions {
  id?: string;
  mimeType?: string;
  requestStreaming?: boolean;
  streamingUploadClient?: "desktop-native";
  visibility?: NativeRecordingVisibility;
  /** The server refuses the row unless the signed-in account is this one. */
  expectedOwnerEmail?: string;
}

export function buildCreateRecordingRequestHeaders(
  authToken?: string,
): Record<string, string> {
  const token = authToken?.trim();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function isStorageSetupFailureMessage(
  message: string | null | undefined,
): boolean {
  return STORAGE_SETUP_FAILURE_RE.test(message ?? "");
}

/**
 * `force=true` keeps a Builder employee's browser on the host the desktop app
 * is signed in to. Without it the page's beta-lane redirect moves them to
 * beta, and the storage grant gets connected there instead.
 */
export function buildVideoStorageSetupUrl(serverUrl: string): string {
  return `${serverUrl.trim().replace(/\/+$/, "")}/record?connectStorage=1&force=true`;
}

type StorageSetupListener = () => void;
const storageSetupListeners = new Set<StorageSetupListener>();

/**
 * Fired the moment the server refuses a recording for missing storage. The
 * start attempt may be cancelled before its rejection reaches the caller, and
 * a cancelled start shows nothing, so the denial cannot ride the error alone.
 */
export function notifyStorageSetupRequired(): void {
  for (const listener of [...storageSetupListeners]) listener();
}

export function onStorageSetupRequired(
  listener: StorageSetupListener,
): () => void {
  storageSetupListeners.add(listener);
  return () => {
    storageSetupListeners.delete(listener);
  };
}

export function buildCreateRecordingRequestBody(
  hasCamera: boolean,
  hasAudio: boolean,
  titleContext?: CaptureTitleResult,
  options?: NativeRecordingRequestOptions,
): Record<string, unknown> {
  return {
    ...(options?.id ? { id: options.id } : {}),
    hasCamera,
    hasAudio,
    spaceIds: [],
    recordingPlatform: "desktop",
    ...(options?.visibility ? { visibility: options.visibility } : {}),
    ...(options?.expectedOwnerEmail
      ? { expectedOwnerEmail: options.expectedOwnerEmail }
      : {}),
    ...(options?.requestStreaming
      ? {
          requestStreaming: true,
          mimeType: options.mimeType,
          streamingUploadClient: options.streamingUploadClient,
        }
      : {}),
    ...(titleContext
      ? {
          title: titleContext.title,
          titleSource: titleContext.titleSource,
          sourceAppName: titleContext.sourceAppName,
          sourceWindowTitle: titleContext.sourceWindowTitle,
        }
      : {}),
  };
}
