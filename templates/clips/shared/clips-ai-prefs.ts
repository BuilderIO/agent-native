/**
 * Clips user preferences that affect AI video tools.
 *
 * Stored under the shared `clips-user-prefs` user-setting key so Settings and
 * the AI tools popover both read/write the same object.
 */

export const CLIPS_USER_PREFS_KEY = "clips-user-prefs";

/**
 * Preferred chat model when Include full video is on. Full-recording video
 * input only works with Gemini (Builder Gemini or Google/Gemini BYOK) —
 * Claude and OpenAI cannot ingest the MP4/WebM.
 */
export const CLIPS_FULL_VIDEO_AI_ENGINE = "builder";
export const CLIPS_FULL_VIDEO_AI_MODEL = "gemini-3-5-flash";

export type ClipsAiPrefs = {
  /**
   * When true, Clips AI tools (default title/description, regenerate title/
   * description/chapters, workflows) must watch the full recording — not just
   * the transcript — before writing results. Off by default for cost/latency.
   * Sending the full video requires a Gemini model.
   */
  includeFullVideoInAi?: boolean;
};

export type ClipsUserPrefs = ClipsAiPrefs & {
  defaultPlaybackSpeed?: string;
  emailNotifications?: boolean;
  displayName?: string;
  transcriptCleanupEnabled?: boolean;
};

export function isIncludeFullVideoInAiEnabled(
  prefs: ClipsAiPrefs | Record<string, unknown> | null | undefined,
): boolean {
  return prefs?.includeFullVideoInAi === true;
}

/**
 * Extra agent instructions when the user wants AI tools to watch the clip,
 * not just read the audio transcript. Full-video understanding requires Gemini.
 */
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

/** Model selection for sendToAgentChat when Include full video is enabled. */
export function fullVideoAiModelSelection(): {
  engine: string;
  model: string;
} {
  return {
    engine: CLIPS_FULL_VIDEO_AI_ENGINE,
    model: CLIPS_FULL_VIDEO_AI_MODEL,
  };
}
