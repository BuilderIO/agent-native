import {
  defineExperiment,
  defineExperiments,
} from "@agent-native/core/experiments/registry";

export const CLIPS_VIDEO_EDITING = defineExperiment({
  key: "clips.video-editing",
  displayName: "Video editing",
  description: "Try the new video editor. It is unstable and may have bugs.",
  keywords: "clips editor trim cut timeline",
});

export const CLIPS_MEETINGS = defineExperiment({
  key: "clips.meetings",
  displayName: "Meetings and transcription",
  description:
    "Try automatic meeting capture and transcription. It is unstable and may have bugs.",
  keywords: "meetings meeting transcription granola notes",
});

export const CLIPS_WISPRFLOW = defineExperiment({
  key: "clips.wisprflow",
  displayName: "WisprFlow dictation",
  description:
    "Try WisprFlow voice dictation. It is unstable and may have bugs.",
  keywords: "wisprflow wispr flow dictate dictation voice",
});

export const CLIPS_EXPERIMENTS = defineExperiments([
  CLIPS_VIDEO_EDITING,
  CLIPS_MEETINGS,
  CLIPS_WISPRFLOW,
]);
