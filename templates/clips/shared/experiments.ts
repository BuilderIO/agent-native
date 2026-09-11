import {
  defineExperiment,
  defineExperiments,
} from "@agent-native/core/experiments/registry";

export const CLIPS_VIDEO_EDITING = defineExperiment({
  key: "clips.video-editing",
  displayName: "Video editing",
  description: "Try the new video editor.",
  keywords: "clips editor trim cut timeline",
});

export const CLIPS_MEETINGS = defineExperiment({
  key: "clips.meetings",
  displayName: "Meetings and transcription",
  description: "Try automatic meeting capture and transcription.",
  keywords: "meetings meeting transcription notes",
});

export const CLIPS_WISPRFLOW = defineExperiment({
  key: "clips.wisprflow",
  displayName: "Voice dictation",
  description: "Try the new voice dictation feature.",
  keywords: "dictate dictation voice speech microphone",
});

export const CLIPS_EXPERIMENTS = defineExperiments([
  CLIPS_VIDEO_EDITING,
  CLIPS_MEETINGS,
  CLIPS_WISPRFLOW,
]);
