/**
 * Server-controlled feature flags, readable from the action surface so
 * behavior can change without a redeploy. Stored under one global `settings`
 * key (not per-user/org) — these gate app-wide rollout decisions, not
 * individual preferences.
 *
 * Add new flags here as they're needed; `get-feature-flags` stays generic
 * and doesn't need to change.
 */

export const FEATURE_FLAGS_KEY = "feature-flags";

export type FeatureFlags = {
  /**
   * Desktop app: use the custom ScreenCaptureKit (SCK) capture pipeline
   * (fragmented MP4 writer + live audio mixer) instead of Apple's stock
   * `SCRecordingOutput`. See `desktop/src-tauri/src/native_screen/custom_capture.rs`.
   */
  useCustomSCKPipeline?: boolean;
  /**
   * Desktop app: stream the recording to the server in chunks while it is
   * being recorded, instead of uploading the whole file after Stop. Only
   * effective when `useCustomSCKPipeline` is also on. See
   * `desktop/src-tauri/src/native_screen/live_upload.rs`.
   */
  customSCKPipelineLiveUploadEnabled?: boolean;
};

export const FEATURE_FLAG_DEFAULTS: Required<FeatureFlags> = {
  useCustomSCKPipeline: false,
  customSCKPipelineLiveUploadEnabled: false,
};

export function withFeatureFlagDefaults(
  flags: FeatureFlags | Record<string, unknown> | null | undefined,
): Required<FeatureFlags> {
  return {
    ...FEATURE_FLAG_DEFAULTS,
    ...(flags as FeatureFlags | undefined),
  };
}
