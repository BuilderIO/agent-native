import type { ClipsNotificationPrefs } from "./clips-notification-prefs.js";

export const CLIPS_USER_PREFS_KEY = "clips-user-prefs";

export const CLIPS_FULL_VIDEO_AI_ENGINE = "builder";
export const CLIPS_FULL_VIDEO_AI_MODEL = "gemini-3-5-flash";

export type ClipsAiPrefs = {
  includeFullVideoInAi?: boolean;
};

export type ClipsUserPrefs = ClipsAiPrefs &
  ClipsNotificationPrefs & {
    defaultPlaybackSpeed?: string;
    defaultRecordingVisibility?: ClipsDefaultVisibility;
  };

export type ClipsDefaultVisibility = "private" | "org" | "public";

export const DEFAULT_CLIPS_RECORDING_VISIBILITY: ClipsDefaultVisibility =
  "public";

export function isIncludeFullVideoInAiEnabled(
  prefs: ClipsAiPrefs | Record<string, unknown> | null | undefined,
): boolean {
  return prefs?.includeFullVideoInAi === true;
}

export function buildFullVideoAiInstructions(recordingId: string): string {
  return (
    `The user enabled "Include full video" for Clips AI. Do NOT rely on the ` +
    `transcript alone — audio is often incomplete for accurate titles, ` +
    `descriptions, chapters, and workflow docs. ` +
    `IMPORTANT: sending / understanding the full recording only works with ` +
    `Gemini (Builder Gemini or a Google Gemini key). Use a Gemini model for ` +
    `this turn — Claude and OpenAI cannot ingest the full video file. ` +
    `Prefer attaching or uploading the recording video itself to Gemini when ` +
    `available. Otherwise use \`get-recording-player-data --recordingId=${recordingId}\` ` +
    `(preferred in-app) or \`create-recording-agent-link --recordingId=${recordingId}\` ` +
    `and fetch that context URL, then sample the timeline via recommendedFrames / ` +
    `the frame API. Combine on-screen UI text, product names, and visual context ` +
    `with any transcript. If the transcript is thin or missing, lean harder on ` +
    `the video.`
  );
}

export function withFullVideoAiInstructions(
  message: string,
  recordingId: string,
  includeFullVideo: boolean,
): string {
  if (!includeFullVideo) return message;
  return `${message} ${buildFullVideoAiInstructions(recordingId)}`;
}

export function fullVideoAiModelSelection(): {
  engine: string;
  model: string;
} {
  return {
    engine: CLIPS_FULL_VIDEO_AI_ENGINE,
    model: CLIPS_FULL_VIDEO_AI_MODEL,
  };
}
