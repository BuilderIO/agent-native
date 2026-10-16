import { isLoomRecordingSource, type LoomRecordingLike } from "@shared/loom";
import { WAITING_STORAGE_EXPIRED_REASON } from "@shared/upload-interruption";

import { isStorageSetupFailureReason } from "./storage-failures";

export type RecordingProcessingPhase =
  | "failed"
  | "processing"
  | "ready"
  | "waiting-storage"
  | "uploading";

export interface RecordingProcessingSnapshot {
  recordingId: string;
  phase: RecordingProcessingPhase;
}

export type RecordingProcessingTransition =
  | "dismissed"
  | "failed"
  | "processing"
  | "ready"
  | null;

export function isRecordingWaitingForStorage(
  recording: LoomRecordingLike | null | undefined,
  failureReason: string | null | undefined,
): boolean {
  return (
    isStorageSetupFailureReason(failureReason) ||
    ((isLoomRecordingSource(recording) ||
      recording?.sourceAppName?.trim().toLowerCase() === "video link") &&
      failureReason === WAITING_STORAGE_EXPIRED_REASON)
  );
}

export function recordingProcessingTransition(
  previous: RecordingProcessingSnapshot | null,
  current: RecordingProcessingSnapshot,
): RecordingProcessingTransition {
  if (current.phase === "waiting-storage") {
    if (!previous) return "dismissed";
    if (previous.recordingId !== current.recordingId) return null;
    return previous.phase === "waiting-storage" ? null : "dismissed";
  }
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
