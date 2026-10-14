/**
 * Deletes the active recording. Only the recording toolbar emits it, after
 * its "Discard …?" confirmation. `clips:recorder-cancel` (the global cancel
 * shortcut) asks the toolbar for that confirmation instead, and cancels
 * directly only while nothing has been recorded yet.
 */
export const RECORDER_DISCARD_EVENT = "clips:recorder-discard";

export type RecorderStopPayload =
  | { kind: "untagged" }
  | { kind: "tagged"; recordingId: string }
  | { kind: "invalid" };

export function parseRecorderStopPayload(
  payload: unknown,
): RecorderStopPayload {
  if (payload === null || payload === undefined) return { kind: "untagged" };
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { kind: "invalid" };
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "recordingId")) {
    return { kind: "invalid" };
  }

  const recordingId = (payload as { recordingId?: unknown }).recordingId;
  if (typeof recordingId !== "string" || recordingId.trim().length === 0) {
    return { kind: "invalid" };
  }
  return { kind: "tagged", recordingId };
}

export function recorderStopTargetsRecording(
  payload: unknown,
  recordingId: string | null | undefined,
): boolean {
  return recorderStopPayloadTargetsRecording(
    parseRecorderStopPayload(payload),
    recordingId,
  );
}

export function recorderStopPayloadTargetsRecording(
  parsed: RecorderStopPayload,
  recordingId: string | null | undefined,
): boolean {
  return (
    parsed.kind === "untagged" ||
    (parsed.kind === "tagged" && parsed.recordingId === recordingId)
  );
}
