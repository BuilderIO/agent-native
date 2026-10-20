import type { ClipsAiRequestKind } from "@shared/ai-request-status";

export function shouldOfferTranscriptRegeneration(
  kind: ClipsAiRequestKind | undefined,
  errorCode: unknown,
  recordingId: string | undefined,
): boolean {
  return (
    kind === "remove-silences" &&
    Boolean(recordingId) &&
    (errorCode === "transcript_unreadable" ||
      errorCode === "timestamped_transcript_required")
  );
}
