
export type TranscriptFailureCode =
  | "NO_AUDIO_TRACK"
  | "NO_SPEECH_DETECTED"
  | "FFMPEG_UNAVAILABLE"
  | "EXTRACTION_FAILED"
  | "TIMEOUT"
  // --- transcript level ---
  /** The recording itself was saved with no audio stream at all. */
  | "NO_AUDIO_SAVED"
  /** Cloud transcription was attempted and threw. */
  | "CLOUD_FAILED"
  /** No cloud provider is connected for this owner. */
  | "CLOUD_UNCONFIGURED"
  /** Anything not yet classified. Prose is preserved; never retried blindly. */
  | "UNKNOWN";

const RETRYABLE: ReadonlySet<TranscriptFailureCode> = new Set([
  "TIMEOUT",
  "EXTRACTION_FAILED",
  "CLOUD_FAILED",
]);

export function isRetryableTranscriptFailure(
  code: TranscriptFailureCode | null | undefined,
): boolean {
  return code != null && RETRYABLE.has(code);
}

export function transcriptFailureMessage(code: TranscriptFailureCode): string {
  switch (code) {
    case "NO_AUDIO_SAVED":
      return "This recording has no audio track, so there was nothing to transcribe. Screen recordings only capture audio when you share tab or system audio, or record with a microphone.";
    case "NO_AUDIO_TRACK":
      return "The saved media has no audio stream, so there was nothing to transcribe.";
    case "NO_SPEECH_DETECTED":
      return "Audio was captured but no speech was found in it.";
    case "FFMPEG_UNAVAILABLE":
      return "Audio could not be prepared for transcription because ffmpeg is unavailable on the server.";
    case "EXTRACTION_FAILED":
      return "Audio could not be prepared for transcription. Retrying usually works.";
    case "TIMEOUT":
      return "Transcription timed out before it finished. Retrying usually works.";
    case "CLOUD_FAILED":
      return "No transcript was captured locally, and cloud transcription could not finish. Retrying usually works; if it persists, check the recording's audio and the Builder connection.";
    case "CLOUD_UNCONFIGURED":
      return "No transcript was captured locally, and no cloud transcription provider is connected. Connect Builder in Settings to transcribe automatically.";
    case "UNKNOWN":
      return "Transcription did not finish.";
  }
}
