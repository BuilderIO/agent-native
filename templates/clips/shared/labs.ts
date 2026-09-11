import { defineLab, defineLabs } from "@agent-native/core/labs/registry";

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
  description: "Try the new voice dictation feature.",
  keywords: "dictate dictation voice speech microphone",
});

export const CLIPS_LABS = defineLabs([
  CLIPS_VIDEO_EDITING,
  CLIPS_MEETINGS,
  CLIPS_WISPRFLOW,
]);
