import { normalizeProviderTranscript } from "./provider-transcript.js";

const CHUNK_TRANSCRIPTION_CONCURRENCY = 3;

export interface TimedChunk {
  startMs: number;
  durationMs: number;
}

export interface ProviderTranscriptResult {
  text: string;
  language?: string | null;
  segments?: Array<{
    startMs: number;
    endMs: number;
    text: string;
    speakerLabel?: string;
  }>;
}

interface JoinedTranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

interface JoinedTranscript {
  fullText: string;
  language: string | null;
  segments: JoinedTranscriptSegment[];
}

export class ChunkTranscriptionError extends Error {
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly cause: unknown;

  constructor(chunkIndex: number, chunkCount: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Transcribing part ${chunkIndex + 1} of ${chunkCount} failed: ${reason}`,
    );
    this.name = "ChunkTranscriptionError";
    this.chunkIndex = chunkIndex;
    this.chunkCount = chunkCount;
    this.cause = cause;
  }
}

/**
 * Transcribes every chunk, at most `concurrency` at a time, retrying each
 * chunk once when `isRetryable` accepts its error. Any chunk that still fails
 * fails the whole run: a transcript missing a part must never be saved as if
 * it were complete. A single-chunk run rethrows the provider error unchanged.
 */
export async function transcribeAudioChunks<C extends TimedChunk>({
  chunks,
  transcribe,
  isRetryable,
  concurrency = CHUNK_TRANSCRIPTION_CONCURRENCY,
}: {
  chunks: C[];
  transcribe: (chunk: C, index: number) => Promise<ProviderTranscriptResult>;
  isRetryable: (err: unknown) => boolean;
  concurrency?: number;
}): Promise<ProviderTranscriptResult[]> {
  const results = new Array<ProviderTranscriptResult>(chunks.length);
  let next = 0;
  let failure: { index: number; error: unknown } | null = null;

  const transcribeWithRetry = async (index: number) => {
    try {
      return await transcribe(chunks[index], index);
    } catch (err) {
      if (!isRetryable(err)) throw err;
      return transcribe(chunks[index], index);
    }
  };

  const worker = async () => {
    while (!failure && next < chunks.length) {
      const index = next++;
      try {
        results[index] = await transcribeWithRetry(index);
      } catch (error) {
        failure ??= { index, error };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, worker),
  );

  if (failure) {
    const { index, error } = failure;
    if (chunks.length === 1) throw error;
    throw new ChunkTranscriptionError(index, chunks.length, error);
  }
  return results;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Stitches per-chunk results into one transcript on the recording timeline.
 * Provider timestamps drift past the end of long audio, so each segment is
 * clamped to its own chunk before the chunk's offset is added. Speaker labels
 * are only meaningful within one request, so multi-part labels are qualified
 * with their part number instead of being merged across parts.
 */
export function joinChunkTranscripts(
  chunks: TimedChunk[],
  results: ProviderTranscriptResult[],
): JoinedTranscript {
  const multiPart = chunks.length > 1;
  const texts: string[] = [];
  const segments: JoinedTranscriptSegment[] = [];
  let language: string | null = null;

  chunks.forEach((chunk, index) => {
    const result = results[index];
    const chunkSegments = (result.segments ?? [])
      .map((segment) => {
        const startMs = clamp(segment.startMs, 0, chunk.durationMs);
        const endMs = clamp(segment.endMs, startMs, chunk.durationMs);
        const label = segment.speakerLabel?.trim();
        const speaker =
          label && multiPart ? `${label} (part ${index + 1})` : label;
        return {
          startMs: chunk.startMs + startMs,
          endMs: chunk.startMs + endMs,
          text: segment.text.trim(),
          ...(speaker ? { speaker } : {}),
        };
      })
      .filter((segment) => segment.text)
      .sort((a, b) => a.startMs - b.startMs);

    const normalized = normalizeProviderTranscript(result.text, chunkSegments);
    if (normalized.fullText) {
      texts.push(normalized.fullText);
      language ??= result.language?.trim() || null;
    }
    segments.push(...normalized.segments);
  });

  return {
    fullText: texts.join("\n\n"),
    language,
    segments,
  };
}
