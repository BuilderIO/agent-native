export interface RecordingPolicy {
  customCapture: boolean;
  liveUpload: boolean;
  recovery: boolean;
}

export interface RecordingLabState {
  enabled: boolean;
  source: "choice" | "legacy" | "default";
  legacyValues?: Record<string, boolean>;
}

export function recordingPolicyFromLab(
  state: RecordingLabState,
): RecordingPolicy {
  if (state.source === "legacy") {
    if (
      !state.legacyValues ||
      typeof state.legacyValues.useCustomSCKPipeline !== "boolean" ||
      typeof state.legacyValues.customSCKPipelineLiveUploadEnabled !==
        "boolean" ||
      typeof state.legacyValues.uploadRetryResume !== "boolean"
    ) {
      throw new Error("Inherited recording settings are unavailable.");
    }
    return {
      customCapture: state.legacyValues.useCustomSCKPipeline,
      liveUpload: state.legacyValues.customSCKPipelineLiveUploadEnabled,
      recovery: state.legacyValues.uploadRetryResume,
    };
  }
  return {
    customCapture: state.enabled,
    liveUpload: state.enabled,
    recovery: state.enabled,
  };
}
