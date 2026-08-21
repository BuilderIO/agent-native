import type { CaptureTitleResult } from "./recording-title";

export type NativeRecordingVisibility = "private" | "org" | "public";

export interface NativeRecordingRequestOptions {
  mimeType?: string;
  requestStreaming?: boolean;
  streamingUploadClient?: "desktop-native";
  visibility?: NativeRecordingVisibility;
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
