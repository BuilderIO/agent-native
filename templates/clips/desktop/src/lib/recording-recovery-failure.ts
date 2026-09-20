import { isHardCapturePermissionError } from "./permissions";

export function isRecordingStartCancellation(error: unknown): boolean {
  const name =
    error instanceof Error || error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "AbortError" ||
    /was cancel[l]?ed|dismissed|region selection cancel[l]?ed/i.test(message) ||
    (name === "NotAllowedError" && !isHardCapturePermissionError(message))
  );
}

export interface RecordingRecoveryResult {
  recordingId?: string;
  ok: boolean;
  error?: string | null;
}

export function recordingFailureEntry(recordingId: string): string {
  return `failure:${recordingId}`;
}

export function applyRecordingRecoveryResult(
  errors: Record<string, string>,
  result: RecordingRecoveryResult,
  fallbackId: string,
  fallbackMessage: string,
): Record<string, string> {
  const recordingId = result.recordingId || fallbackId;
  const key = recordingFailureEntry(recordingId);
  const next = { ...errors };
  if (result.ok) {
    delete next[key];
    delete next[`native:${recordingId}`];
    delete next[`browser:${recordingId}`];
  } else next[key] = result.error || fallbackMessage;
  return next;
}
