import type { CaptureTitleResult } from "./recording-title";

export const RECORDING_SESSION_EXPIRED = "SESSION_EXPIRED";
export const RECORDING_SERVER_UNAVAILABLE = "SERVER_UNAVAILABLE";
const STORAGE_SETUP_FAILURE_RE =
  /video storage is not connected|no video storage configured|file upload provider|storage provider|connect builder|s3-compatible/i;

export type NativeRecordingVisibility = "private" | "org" | "public";

export interface NativeRecordingRequestOptions {
  mimeType?: string;
  requestStreaming?: boolean;
  streamingUploadClient?: "desktop-native";
  visibility?: NativeRecordingVisibility;
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

export function buildCreateRecordingRequestBody(
  hasCamera: boolean,
  hasAudio: boolean,
  titleContext?: CaptureTitleResult,
  options?: NativeRecordingRequestOptions,
): Record<string, unknown> {
  return {
    hasCamera,
    hasAudio,
    spaceIds: [],
    ...(options?.visibility ? { visibility: options.visibility } : {}),
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
