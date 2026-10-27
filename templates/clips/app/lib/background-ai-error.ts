import type { ClipsAiRequestKind } from "@shared/ai-request-status";

export function transcriptRecoveryForError(
  kind: ClipsAiRequestKind | undefined,
  errorCode: unknown,
  recordingId: string | undefined,
): "wait" | "regenerate" | null {
  if (kind !== "remove-silences" || !recordingId) return null;

  switch (errorCode) {
    case "transcript_pending":
      return "wait";
    case "transcript_not_ready":
    case "transcript_unreadable":
    case "timestamped_transcript_required":
      return "regenerate";
    default:
      return null;
  }
}
