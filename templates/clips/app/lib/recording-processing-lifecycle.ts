export type RecordingProcessingPhase =
  | "failed"
  | "processing"
  | "ready"
  | "uploading";

export interface RecordingProcessingSnapshot {
  recordingId: string;
  phase: RecordingProcessingPhase;
}

export type RecordingProcessingTransition =
  | "failed"
  | "processing"
  | "ready"
  | null;

/**
 * Resolve only transitions that belong to the same recording. A client-side
 * navigation establishes a new baseline so work from the previous clip cannot
 * complete or fail a notification for the next clip.
 */
export function recordingProcessingTransition(
  previous: RecordingProcessingSnapshot | null,
  current: RecordingProcessingSnapshot,
): RecordingProcessingTransition {
  if (current.phase === "uploading" || current.phase === "processing") {
    return "processing";
  }
  if (!previous || previous.recordingId !== current.recordingId) return null;
  if (current.phase === "ready" && previous.phase !== "ready") return "ready";
  if (current.phase === "failed" && previous.phase !== "failed") {
    return "failed";
  }
  return null;
}
