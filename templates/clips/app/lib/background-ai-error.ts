import type { ClipsAiRequestKind } from "@shared/ai-request-status";

export function transcriptRecoveryForError(
  kind: ClipsAiRequestKind | undefined,
  errorCode: unknown,
  recordingId: string | undefined,
): "wait" | "regenerate" | null {
  const cleanupKind =
    kind === "remove-filler-words" || kind === "remove-silences";
  if (!cleanupKind || !recordingId) return null;

  switch (errorCode) {
    case "transcript_pending":
      return "wait";
    case "transcript_not_ready":
    case "transcript_unreadable":
      return "regenerate";
    case "timestamped_transcript_required":
      return kind === "remove-silences" ? "regenerate" : null;
    default:
      return null;
  }
}
