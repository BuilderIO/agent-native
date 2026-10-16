import type { TranscriptSegment } from "./transcript-segments.js";

export const TRANSCRIPT_IMPORT_FORMATS = ["vtt", "srt", "text"] as const;
export type TranscriptImportFormat = (typeof TRANSCRIPT_IMPORT_FORMATS)[number];

export const TRANSCRIPT_IMPORT_ACCEPT = ".vtt,.srt,.txt,.md";
export const IMPORTED_TRANSCRIPT_SOURCE = "imported" as const;
export const MAX_TRANSCRIPT_IMPORT_CHARS = 2_000_000;
/** Returned when an import without replace meets a ready transcript. */
export const TRANSCRIPT_EXISTS_ERROR_CODE = "transcript_exists";

export function isTranscriptExistsError(error: unknown): boolean {
  return (
    (error as { errorCode?: unknown } | null)?.errorCode ===
    TRANSCRIPT_EXISTS_ERROR_CODE
  );
}

/** The transcript a `transcript_exists` error found in the way, else null. */
export function transcriptInTheWay(
  error: unknown,
): { importId: string | null } | null {
  if (!isTranscriptExistsError(error)) return null;
  const importId = (error as { details?: { importId?: unknown } }).details
    ?.importId;
  return { importId: typeof importId === "string" ? importId : null };
}

// A start this far past the recorded duration means the file belongs to a
// different video, not that the duration metadata rounded down.
const PAST_END_TOLERANCE_MS = 1_000;
const ESTIMATED_MS_PER_WORD = 420;
const MIN_LAST_SEGMENT_MS = 1_000;
const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);

export type TranscriptImportErrorCode =
  | "empty"
  | "too-large"
  | "missing-timing"
  | "bad-timing"
  | "bad-range"
  | "missing-timestamp"
  | "out-of-order"
  | "past-end";

export interface TranscriptImportError {
  code: TranscriptImportErrorCode;
  /** 1-based line in the file; null when the problem is the whole file. */
  line: number | null;
}

export type TranscriptImportResult =
  | {
      ok: true;
      format: TranscriptImportFormat;
      segments: TranscriptSegment[];
      fullText: string;
      /** From a WebVTT `Language:` header; null when the file names none. */
      language: string | null;
    }
  | { ok: false; format: TranscriptImportFormat; error: TranscriptImportError };

const TIME = String.raw`(?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`;
const CUE_TIMING = new RegExp(
  String.raw`^\s*(${TIME})\s*-->\s*(${TIME})(?:\s+.*)?$`,
);
// A start time right before the arrow: timestamped prose such as
// "0:05 Use a --> b" is still text, while a cue with a bad end time is SRT
// and gets SRT's line-specific error.
const CUE_TIMING_START = new RegExp(String.raw`^\s*${TIME}\s*-->`);
// Text can follow a closing bracket or bold marker directly, as in
// "[0:21]The chart."; a bare time needs a space after it, so "3:45pm" in
// prose isn't read as a start time.
const TIMESTAMP_LINE = new RegExp(
  String.raw`^\s*(?:[-*]\s+)?(?:\*\*)?[[(]?(${TIME})(?:[\])](?:\*\*)?|\*\*|(?=\s|$))(?:\s*[-–—:|]?\s*(.*))?$`,
);
// WebVTT's cue tags and timestamps, and the tags SRT players render. Any
// other angle bracket is prose, such as "x < 5 and y > 3".
const CUE_MARKUP = new RegExp(
  String.raw`<\/?(?:[bciuvs]|ruby|rt|lang|font)(?:[.\s][^<>]*)?>|<${TIME}>`,
  "gi",
);
const VTT_LANGUAGE_HEADER = /^Language:\s*([a-z]{2,3}(?:-[a-z0-9]{1,8})*)$/i;
// YouTube's transcript panel can copy each timestamp's screen-reader label
// ("1 minute, 5 seconds") on its own line under the timestamp.
const SPOKEN_DURATION =
  /^\d+\s+(?:hours?|minutes?|seconds?)(?:,?\s+\d+\s+(?:hours?|minutes?|seconds?))*$/i;

export function detectTranscriptFormat(text: string): TranscriptImportFormat {
  const body = stripBom(text);
  const firstLine = body.trimStart().split(/\r?\n/, 1)[0] ?? "";
  if (/^WEBVTT(?:\s|$)/.test(firstLine)) return "vtt";
  if (splitLines(body).some((line) => CUE_TIMING_START.test(line))) {
    return "srt";
  }
  return "text";
}

export function parseTranscriptImport(
  text: string,
  options: { format?: TranscriptImportFormat; durationMs?: number | null } = {},
): TranscriptImportResult {
  const format = options.format ?? detectTranscriptFormat(text);
  if (text.length > MAX_TRANSCRIPT_IMPORT_CHARS) {
    return { ok: false, format, error: { code: "too-large", line: null } };
  }
  const durationMs =
    typeof options.durationMs === "number" && options.durationMs > 0
      ? options.durationMs
      : null;
  // WebVTT's parser reads NUL as U+FFFD, and PostgreSQL text cannot store NUL.
  const lines = splitLines(
    stripBom(text).replace(/\0/g, REPLACEMENT_CHARACTER),
  );
  const parsed =
    format === "text"
      ? parseTimestampedText(lines, durationMs)
      : parseCues(lines, format);
  if ("error" in parsed) return { ok: false, format, error: parsed.error };

  if (parsed.segments.length === 0) {
    return { ok: false, format, error: { code: "empty", line: null } };
  }
  if (durationMs !== null) {
    // Every cue needs a start inside the clip to join, so a transcript that
    // starts at or past the end belongs to a different video.
    const pastEnd =
      parsed.segments[0].startMs >= durationMs
        ? 0
        : parsed.segments.findIndex(
            (segment) => segment.startMs > durationMs + PAST_END_TOLERANCE_MS,
          );
    if (pastEnd >= 0) {
      return {
        ok: false,
        format,
        error: { code: "past-end", line: parsed.lineNumbers[pastEnd] },
      };
    }
  }
  const segments =
    durationMs === null
      ? parsed.segments
      : fitToDuration(parsed.segments, durationMs);
  return {
    ok: true,
    format,
    segments,
    fullText: segments.map((segment) => segment.text).join(" "),
    language: parsed.language ?? null,
  };
}

type ParsedLines =
  | {
      segments: TranscriptSegment[];
      lineNumbers: number[];
      language?: string | null;
    }
  | { error: TranscriptImportError };

function parseCues(lines: string[], format: "vtt" | "srt"): ParsedLines {
  const cues: Array<{ segment: TranscriptSegment; line: number }> = [];
  let language: string | null = null;
  const blocks = splitBlocks(lines);
  if (blocks.length && /^WEBVTT(?:\s|$)/.test(blocks[0][0].text.trim())) {
    const header = blocks.shift()!;
    // A cue written straight under the header, with no blank line between,
    // still belongs to the transcript.
    const firstTiming = header.findIndex(
      (line, index) => index > 0 && line.text.includes("-->"),
    );
    if (firstTiming > 0) blocks.unshift(header.splice(firstTiming));
    for (const line of header) {
      const match = VTT_LANGUAGE_HEADER.exec(line.text.trim());
      if (match) language = match[1];
    }
  }
  for (const block of blocks.flatMap(splitAtCueTimings)) {
    const first = block[0].text.trim();
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(first)) continue;

    // A cue starts with an optional identifier (SRT's index) and then its
    // timing line.
    const timingIndex = block
      .slice(0, 2)
      .findIndex((line) => line.text.includes("-->"));
    if (timingIndex < 0) {
      return { error: { code: "missing-timing", line: block[0].number } };
    }
    const timingLine = block[timingIndex];
    const match = CUE_TIMING.exec(timingLine.text);
    if (!match) {
      return { error: { code: "bad-timing", line: timingLine.number } };
    }
    const startMs = parseTimestamp(match[1]);
    const endMs = parseTimestamp(match[2]);
    if (startMs === null || endMs === null) {
      return { error: { code: "bad-timing", line: timingLine.number } };
    }
    if (endMs <= startMs) {
      return { error: { code: "bad-range", line: timingLine.number } };
    }
    const rawText = block
      .slice(timingIndex + 1)
      .map((line) => line.text)
      .join("\n");
    const { text, speaker } = cleanCueText(rawText, format);
    if (!text) continue;
    cues.push({
      segment: speaker
        ? { startMs, endMs, text, speaker }
        : { startMs, endMs, text },
      line: timingLine.number,
    });
  }
  cues.sort((a, b) => a.segment.startMs - b.segment.startMs);
  // The player shows one caption at a time, so a cue that overlaps the next
  // would hold that cue back until it ends. End each cue where the next one
  // starts, and join cues that start together.
  const timed: typeof cues = [];
  for (const cue of cues) {
    const previous = timed[timed.length - 1];
    if (previous && cue.segment.startMs === previous.segment.startMs) {
      previous.segment = joinSegments(previous.segment, cue.segment);
      continue;
    }
    if (previous && previous.segment.endMs > cue.segment.startMs) {
      previous.segment = { ...previous.segment, endMs: cue.segment.startMs };
    }
    timed.push(cue);
  }
  return {
    segments: timed.map((cue) => cue.segment),
    lineNumbers: timed.map((cue) => cue.line),
    language,
  };
}

// Duration metadata can run a little short of the media, so a cue starting
// inside the tolerance is real speech at the very end. Its words join the
// last cue that starts inside the clip, and every cue ends by the clip's end.
function fitToDuration(
  segments: TranscriptSegment[],
  durationMs: number,
): TranscriptSegment[] {
  const fitted: TranscriptSegment[] = [];
  for (const segment of segments) {
    const next =
      fitted.length && segment.startMs >= durationMs
        ? joinSegments(fitted.pop()!, segment)
        : segment;
    fitted.push(
      next.endMs > durationMs ? { ...next, endMs: durationMs } : next,
    );
  }
  return fitted;
}

function joinSegments(
  first: TranscriptSegment,
  second: TranscriptSegment,
): TranscriptSegment {
  const { speaker, ...rest } = first;
  return {
    ...rest,
    endMs: Math.max(rest.endMs, second.endMs),
    text: `${rest.text} ${second.text}`,
    ...(speaker && speaker === second.speaker ? { speaker } : {}),
  };
}

function parseTimestampedText(
  lines: string[],
  durationMs: number | null,
): ParsedLines {
  const entries: Array<{ startMs: number; text: string[]; line: number }> = [];
  let previousWasTimestamp = false;
  for (const [index, raw] of lines.entries()) {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (!line) continue;
    const match = TIMESTAMP_LINE.exec(line);
    if (match) {
      const startMs = parseTimestamp(match[1]);
      if (startMs === null) {
        return { error: { code: "missing-timestamp", line: lineNumber } };
      }
      const previous = entries[entries.length - 1];
      if (previous && startMs < previous.startMs) {
        return { error: { code: "out-of-order", line: lineNumber } };
      }
      const text = match[2]?.trim() ?? "";
      if (previous && startMs === previous.startMs) {
        if (text) previous.text.push(text);
      } else {
        entries.push({ startMs, text: text ? [text] : [], line: lineNumber });
      }
      previousWasTimestamp = !text;
      continue;
    }
    const current = entries[entries.length - 1];
    if (!current) {
      // A Markdown heading can title the file; any other text before the
      // first timestamp means this isn't a timestamped transcript.
      if (line.startsWith("#")) continue;
      return { error: { code: "missing-timestamp", line: lineNumber } };
    }
    if (previousWasTimestamp && SPOKEN_DURATION.test(line)) continue;
    current.text.push(line);
    previousWasTimestamp = false;
  }

  const segments: TranscriptSegment[] = [];
  const lineNumbers: number[] = [];
  for (const [index, entry] of entries.entries()) {
    const text = collapseWhitespace(entry.text.join(" "));
    if (!text) continue;
    const next = entries[index + 1];
    const estimatedEndMs =
      entry.startMs +
      Math.max(MIN_LAST_SEGMENT_MS, countWords(text) * ESTIMATED_MS_PER_WORD);
    const endMs = next
      ? next.startMs
      : durationMs !== null && durationMs > entry.startMs
        ? durationMs
        : estimatedEndMs;
    segments.push({ startMs: entry.startMs, endMs, text });
    lineNumbers.push(entry.line);
  }
  return { segments, lineNumbers };
}

export function formatSrt(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTime(segment.startMs)} --> ${formatSrtTime(
          segment.endMs,
        )}\n${segment.text}\n`,
    )
    .join("\n");
}

export function describeTranscriptImportError(
  error: TranscriptImportError,
): string {
  const at = error.line === null ? "" : `Line ${error.line}: `;
  switch (error.code) {
    case "empty":
      return "The file has no transcript text.";
    case "too-large":
      return "The file is too large to import as a transcript.";
    case "missing-timing":
      return `${at}expected a cue timing line like 00:00:01.000 --> 00:00:04.000.`;
    case "bad-timing":
      return `${at}the cue timing couldn't be read. Use 00:00:01.000 --> 00:00:04.000.`;
    case "bad-range":
      return `${at}the cue ends before it starts.`;
    case "missing-timestamp":
      return `${at}expected a start time like 0:21 or [0:21].`;
    case "out-of-order":
      return `${at}this time is earlier than the one before it.`;
    case "past-end":
      return `${at}this time is after the end of the video.`;
  }
}

function formatSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = String(Math.floor(total / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((total % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((total % 60_000) / 1000)).padStart(2, "0");
  const millis = String(total % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${millis}`;
}

/**
 * Milliseconds, or null when a minute or second field is 60 or more or the
 * hours are too many digits to count exactly.
 */
function parseTimestamp(value: string): number | null {
  const [clock, fraction = ""] = value.split(/[.,]/);
  const parts = clock.split(":").map(Number);
  if (parts.slice(-2).some((part) => part >= 60)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  const millis = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  const ms = seconds * 1000 + millis;
  return Number.isSafeInteger(ms) ? ms : null;
}

function cleanCueText(
  raw: string,
  format: "vtt" | "srt",
): { text: string; speaker: string | null } {
  const voice = /<v(?:\.[^\s>]+)*\s+([^>]+)>/.exec(raw);
  let text = raw.replace(CUE_MARKUP, "");
  if (format === "srt") text = text.replace(/\{\\[^}]*\}/g, "");
  return {
    text: collapseWhitespace(decodeEntities(text)),
    speaker: voice ? collapseWhitespace(decodeEntities(voice[1])) : null,
  };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1].toLowerCase() === "x"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        // HTML's reference rules, which WebVTT cue text follows: NUL, a
        // surrogate, or a value past U+10FFFF is not a character.
        const isCharacter =
          code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
        return isCharacter ? String.fromCodePoint(code) : REPLACEMENT_CHARACTER;
      }
      // Own keys only: "&constructor;" must not read Object.prototype.
      const name = body.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
        ? NAMED_ENTITIES[name]
        : entity;
    },
  );
}

// Like WebVTT's own parser, a timing line starts a new cue even without a
// blank line before it, so the next cue is not read as this one's text. A
// line that only starts like one splits too, so a bad end time gets its
// line-specific error. An SRT index right above that line moves with it.
function splitAtCueTimings(
  block: Array<{ text: string; number: number }>,
): Array<Array<{ text: string; number: number }>> {
  const parts: Array<Array<{ text: string; number: number }>> = [];
  let start = 0;
  let seenTiming = false;
  for (const [index, line] of block.entries()) {
    if (!CUE_TIMING_START.test(line.text)) continue;
    // A part's own timing is its first line, or its second after an
    // identifier; one further down starts the next cue, even after a NOTE.
    if (seenTiming || index - start > 1) {
      const cut =
        index - 1 > start && /^\d+$/.test(block[index - 1].text.trim())
          ? index - 1
          : index;
      parts.push(block.slice(start, cut));
      start = cut;
    }
    seenTiming = true;
  }
  parts.push(block.slice(start));
  return parts;
}

function splitBlocks(
  lines: string[],
): Array<Array<{ text: string; number: number }>> {
  const blocks: Array<Array<{ text: string; number: number }>> = [];
  let current: Array<{ text: string; number: number }> = [];
  for (const [index, text] of lines.entries()) {
    // Only an empty line ends a block, as in WebVTT: a line of spaces inside
    // a cue is part of its text, not the start of a cue with no timing.
    if (text === "") {
      if (current.length) blocks.push(current);
      current = [];
    } else if (text.trim() || current.length) {
      current.push({ text, number: index + 1 });
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

function stripBom(text: string): string {
  return text.replace(/^﻿/, "");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
