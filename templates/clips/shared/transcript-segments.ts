export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

const MAX_WORDS_PER_CAPTION = 7;
const MIN_WORDS_BEFORE_PUNCTUATION_BREAK = 3;
const ESTIMATED_MS_PER_WORD = 420;
const MIN_CAPTION_MS = 900;

export function parseTranscriptSegments(
  raw: string | null | undefined,
): TranscriptSegment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((segment) => ({
        startMs: Number(segment?.startMs),
        endMs: Number(segment?.endMs),
        text: typeof segment?.text === "string" ? segment.text.trim() : "",
      }))
      .filter(
        (segment) =>
          Number.isFinite(segment.startMs) &&
          Number.isFinite(segment.endMs) &&
          segment.endMs > segment.startMs &&
          segment.text,
      );
  } catch {
    return [];
  }
}

export function buildCaptionSegmentsFromText(
  text: string,
  durationMs?: number | null,
): TranscriptSegment[] {
  const chunks = splitIntoCaptionChunks(text);
  if (chunks.length === 0) return [];

  const wordCounts = chunks.map(countWords);
  const totalWords = wordCounts.reduce((sum, count) => sum + count, 0) || 1;
  const estimatedDurationMs = Math.max(
    chunks.length * MIN_CAPTION_MS,
    totalWords * ESTIMATED_MS_PER_WORD,
  );
  const totalDurationMs =
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0
      ? Math.max(durationMs, chunks.length * MIN_CAPTION_MS)
      : estimatedDurationMs;

  let cursorMs = 0;
  return chunks.map((chunk, index) => {
    const isLast = index === chunks.length - 1;
    const rawDuration = Math.round(
      (totalDurationMs * wordCounts[index]) / totalWords,
    );
    const endMs = isLast
      ? Math.max(cursorMs + MIN_CAPTION_MS, Math.round(totalDurationMs))
      : Math.max(cursorMs + MIN_CAPTION_MS, cursorMs + rawDuration);
    const segment = {
      startMs: cursorMs,
      endMs,
      text: chunk,
    };
    cursorMs = endMs;
    return segment;
  });
}

export function normalizeTranscriptSegments({
  segments,
  fullText,
  durationMs,
}: {
  segments: TranscriptSegment[];
  fullText?: string | null;
  durationMs?: number | null;
}): TranscriptSegment[] {
  const validSegments = segments.filter((segment) => segment.text.trim());
  if (!shouldRechunkSegments(validSegments, fullText)) return validSegments;

  const sourceText =
    fullText?.trim() ||
    validSegments
      .map((segment) => segment.text.trim())
      .join(" ")
      .trim();
  if (validSegments.length <= 1) {
    return buildCaptionSegmentsFromText(sourceText, durationMs);
  }

  return validSegments.flatMap(splitTimedSegmentIntoCaptions);
}

function splitIntoCaptionChunks(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    current.push(word);
    const cleanWord = word.replace(/["')\]}]+$/g, "");
    const strongBreak = /[.!?]$/.test(cleanWord);
    const softBreak = /[,;:]$/.test(cleanWord);
    const canBreakOnPunctuation =
      current.length >= MIN_WORDS_BEFORE_PUNCTUATION_BREAK &&
      (strongBreak || softBreak);

    if (current.length >= MAX_WORDS_PER_CAPTION || canBreakOnPunctuation) {
      chunks.push(current.join(" "));
      current = [];
    }
  }

  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function splitTimedSegmentIntoCaptions(
  segment: TranscriptSegment,
): TranscriptSegment[] {
  const chunks = splitIntoCaptionChunks(segment.text);
  if (chunks.length <= 1) return [segment];

  const totalWords =
    chunks.reduce((sum, chunk) => sum + countWords(chunk), 0) || 1;
  const durationMs = Math.max(MIN_CAPTION_MS, segment.endMs - segment.startMs);
  const minChunkMs =
    durationMs >= chunks.length * MIN_CAPTION_MS
      ? MIN_CAPTION_MS
      : Math.max(250, Math.floor(durationMs / chunks.length));
  let cursorMs = segment.startMs;

  return chunks.map((chunk, index) => {
    const isLast = index === chunks.length - 1;
    const rawDuration = Math.round(
      (durationMs * countWords(chunk)) / totalWords,
    );
    const remainingChunks = chunks.length - index - 1;
    const latestEndMs = segment.endMs - remainingChunks * 250;
    const endMs = isLast
      ? segment.endMs
      : Math.min(
          latestEndMs,
          Math.max(cursorMs + minChunkMs, cursorMs + rawDuration),
        );
    const next = { startMs: cursorMs, endMs, text: chunk };
    cursorMs = endMs;
    return next;
  });
}

function shouldRechunkSegments(
  segments: TranscriptSegment[],
  fullText: string | null | undefined,
): boolean {
  if (segments.length === 0) return Boolean(fullText?.trim());
  if (
    segments.some((segment) => countWords(segment.text) > MAX_WORDS_PER_CAPTION)
  )
    return true;
  if (segments.length === 1 && countWords(segments[0].text) > 3) return true;
  return false;
}
