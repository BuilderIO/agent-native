import {
  defineFeatureFlag,
  defineFeatureFlags,
} from "@agent-native/core/feature-flags/registry";

/**
 * Desktop app: use the custom ScreenCaptureKit (SCK) capture pipeline
 * (fragmented MP4 writer + live audio mixer) instead of Apple's stock
 * `SCRecordingOutput`. See `desktop/src-tauri/src/native_screen/custom_capture.rs`.
 */
export const USE_CUSTOM_SCK_PIPELINE_FLAG = defineFeatureFlag({
  key: "useCustomSCKPipeline",
  displayName: "Custom ScreenCaptureKit pipeline",
  description:
    "Use the fragmented MP4 writer and live audio mixer for desktop capture.",
});

/**
 * Desktop app: stream the recording to the server in chunks while it is
 * being recorded, instead of uploading the whole file after Stop. Only
 * effective when the custom SCK pipeline is also on. See
 * `desktop/src-tauri/src/native_screen/live_upload.rs`.
 */
export const CUSTOM_SCK_LIVE_UPLOAD_FLAG = defineFeatureFlag({
  key: "customSCKPipelineLiveUploadEnabled",
  displayName: "Live capture upload",
  description:
    "Upload recording chunks while capture is still in progress. Requires the custom ScreenCaptureKit pipeline.",
});

export const CLIPS_FEATURE_FLAGS = defineFeatureFlags([
  USE_CUSTOM_SCK_PIPELINE_FLAG,
  CUSTOM_SCK_LIVE_UPLOAD_FLAG,
]);
