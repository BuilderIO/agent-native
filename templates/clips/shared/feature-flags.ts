import {
  defineFeatureFlag,
  defineFeatureFlags,
} from "@agent-native/core/feature-flags/registry";
import { FIRST_RUN_BUILDER_CREDITS_V2_FLAG_KEY } from "@agent-native/core/shared";

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

export const CLIPS_HOSTED_FREE_CLIPS_FLAG = defineFeatureFlag({
  key: "clips-hosted-free-clips",
  displayName: "Hosted free Clips recordings",
  description:
    "Let targeted users record their first Clips before connecting their own storage.",
});

export const CLIPS_FIRST_RUN_CREDITS_V2_FLAG = defineFeatureFlag({
  key: FIRST_RUN_BUILDER_CREDITS_V2_FLAG_KEY,
  displayName: "Clips first-run credits v2",
  description:
    "Use authenticated-user assignment and one-click Skip in the Clips credits arm.",
});

export const CLIPS_LEGACY_FEATURE_FLAGS = [
  USE_CUSTOM_SCK_PIPELINE_FLAG,
  CUSTOM_SCK_LIVE_UPLOAD_FLAG,
  UPLOAD_RETRY_RESUME_FLAG,
] as const;

export const CLIPS_FEATURE_FLAGS = defineFeatureFlags([
  ...CLIPS_LEGACY_FEATURE_FLAGS,
  CLIPS_HOSTED_FREE_CLIPS_FLAG,
  CLIPS_FIRST_RUN_CREDITS_V2_FLAG,
]);
