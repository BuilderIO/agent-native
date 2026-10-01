import {
  defineLab,
  defineLabs,
  type LabDefinition,
} from "@agent-native/core/labs/registry";

export function isLabEnabled(
  values: Record<string, unknown>,
  lab: Pick<LabDefinition, "key" | "defaultEnabled">,
): boolean {
  const value = values[lab.key];
  return value === undefined ? lab.defaultEnabled === true : value === true;
}

export const CLIPS_VIDEO_EDITING = defineLab({
  key: "clips.video-editing",
  displayName: "Video editing",
  description: "Try the new video editor.",
  keywords: "clips editor trim cut timeline",
});

export const CLIPS_MEETINGS = defineLab({
  key: "clips.meetings",
  displayName: "Meetings and transcription",
  description: "Try automatic meeting capture and transcription.",
  keywords: "meetings meeting transcription notes",
});

export const CLIPS_WISPRFLOW = defineLab({
  key: "clips.wisprflow",
  displayName: "Voice dictation",
  description: "Show or hide voice dictation in Clips Desktop.",
  defaultEnabled: true,
  keywords: "dictate dictation voice speech microphone",
});

export const CLIPS_RESILIENT_RECORDING = defineLab({
  key: "clips.resilient-recording",
  displayName: "Resilient recording",
  description:
    "Try faster recording uploads and improved recovery after interruptions.",
  inheritedMixedDescription:
    "Previous recording settings are still active. Choose On or Off to use one setting.",
  keywords: "recording upload recovery desktop",
  legacyFlagKeys: [
    "useCustomSCKPipeline",
    "customSCKPipelineLiveUploadEnabled",
    "uploadRetryResume",
  ],
});

export const CLIPS_LABS = defineLabs([
  CLIPS_VIDEO_EDITING,
  CLIPS_MEETINGS,
  CLIPS_WISPRFLOW,
  CLIPS_RESILIENT_RECORDING,
]);
