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
