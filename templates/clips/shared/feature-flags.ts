import {
  defineFeatureFlag,
  defineFeatureFlags,
} from "@agent-native/core/feature-flags/registry";

export const USE_CUSTOM_SCK_PIPELINE_FLAG = defineFeatureFlag({
  key: "useCustomSCKPipeline",
  displayName: "Custom ScreenCaptureKit pipeline",
  description:
    "Use the fragmented MP4 writer and live audio mixer for desktop capture.",
});

export const CUSTOM_SCK_LIVE_UPLOAD_FLAG = defineFeatureFlag({
  key: "customSCKPipelineLiveUploadEnabled",
  displayName: "Live capture upload",
  description:
    "Upload recording chunks while capture is still in progress. Requires the custom ScreenCaptureKit pipeline.",
});

export const UPLOAD_RETRY_RESUME_FLAG = defineFeatureFlag({
  key: "uploadRetryResume",
  displayName: "Resumable upload retry",
  description:
    "Resume interrupted desktop uploads from their last confirmed byte instead of replaying the full local backup.",
});

export const CLIPS_FEATURE_FLAGS = defineFeatureFlags([
  USE_CUSTOM_SCK_PIPELINE_FLAG,
  CUSTOM_SCK_LIVE_UPLOAD_FLAG,
  UPLOAD_RETRY_RESUME_FLAG,
]);
