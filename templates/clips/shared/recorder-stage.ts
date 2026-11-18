/**
 * The browser recorder's states. The recorder sends its state with an upload
 * abort, and the server classifies the failure by it, so both sides read this
 * one list.
 */
export const RECORDER_STAGES = [
  "idle",
  "pickingSources",
  "countdown",
  "recording",
  "paused",
  "stopping",
  "compressing",
  "uploading",
  "complete",
  "error",
] as const;

export type RecorderStage = (typeof RECORDER_STAGES)[number];
