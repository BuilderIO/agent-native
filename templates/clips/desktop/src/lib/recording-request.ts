import type { CaptureTitleResult } from "./recording-title";

export const RECORDING_SESSION_EXPIRED = "SESSION_EXPIRED";
export const RECORDING_SERVER_UNAVAILABLE = "SERVER_UNAVAILABLE";

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
