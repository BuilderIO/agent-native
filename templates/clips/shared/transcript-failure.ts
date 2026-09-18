/**
 * One vocabulary for why a transcript did not happen.
 *
 * Production accumulated **39 distinct `failure_reason` strings** across 1100
 * failed rows, introduced on five separate dates across four files and three
 * capture surfaces. No commit ever owned the terminal-failure vocabulary, so
 * every fix added its own sentence. Two of those strings were the same
 * condition renamed ("backup transcription" → "Builder transcription"), which
 * silently forked every downstream count.
 *
 * Worse, a typed code already existed (`AudioOnlyExtractionErrorCode`), was
 * thrown, and was discarded at the persistence boundary — after which
 * retryability was re-derived by running regexes over the English prose. A
 * message reworded for clarity could therefore change whether a transcript
 * retried.
 *
 * So: the CODE is the record, prose is rendered from it, and retryability is a
 * property of the code. Adding a failure mode means adding one entry here, not
 * a new sentence at a call site.
 */

/** Why a transcript ended in `failed`. Persisted; do not renumber or reword. */
export type TranscriptFailureCode =
  // --- audio extraction (mirrors AudioOnlyExtractionErrorCode) ---
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

/**
 * Codes worth retrying automatically.
 *
 * Retrying anything else wastes a media fetch and an ffmpeg run to reach the
 * same answer — `NO_AUDIO_SAVED` in particular is a measurement of the stored
 * file, so no number of retries will find audio that was never captured.
 */
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

/**
 * The sentence shown to a person, derived from the code.
 *
 * Each says what happened and what the reader can do about it. None of them
 * blames the recording for a capture setting — "no speech was detected" on a
 * recording saved without audio was the single most common transcript failure
 * in production, and it sent people looking for a microphone problem when the
 * screen-share simply never included audio.
 */
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
