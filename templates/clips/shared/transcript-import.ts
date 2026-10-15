import type { TranscriptSegment } from "./transcript-segments.js";

export const TRANSCRIPT_IMPORT_FORMATS = ["vtt", "srt", "text"] as const;
export type TranscriptImportFormat = (typeof TRANSCRIPT_IMPORT_FORMATS)[number];

export const TRANSCRIPT_IMPORT_ACCEPT = ".vtt,.srt,.txt,.md";
export const IMPORTED_TRANSCRIPT_SOURCE = "imported";
export const MAX_TRANSCRIPT_IMPORT_CHARS = 2_000_000;

// A start this far past the recorded duration means the file belongs to a
// different video, not that the duration metadata rounded down.
const PAST_END_TOLERANCE_MS = 1_000;
const ESTIMATED_MS_PER_WORD = 420;
const MIN_LAST_SEGMENT_MS = 1_000;

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
    }
  | { ok: false; format: TranscriptImportFormat; error: TranscriptImportError };

const TIME = String.raw`(?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`;
const CUE_TIMING = new RegExp(
  String.raw`^\s*(${TIME})\s*-->\s*(${TIME})(?:\s+.*)?$`,
);
const TIMESTAMP_LINE = new RegExp(
  String.raw`^\s*(?:[-*]\s+)?(?:\*\*)?[[(]?(${TIME})[\])]?(?:\*\*)?(?:\s*[-–—:|]?\s+(.*))?$`,
);
// YouTube's transcript panel can copy each timestamp's screen-reader label
// ("1 minute, 5 seconds") on its own line under the timestamp.
const SPOKEN_DURATION =
  /^\d+\s+(?:hours?|minutes?|seconds?)(?:,?\s+\d+\s+(?:hours?|minutes?|seconds?))*$/i;

export function detectTranscriptFormat(text: string): TranscriptImportFormat {
  const body = stripBom(text);
  const firstLine = body.trimStart().split(/\r?\n/, 1)[0] ?? "";
  if (/^WEBVTT(?:\s|$)/.test(firstLine)) return "vtt";
  if (splitLines(body).some((line) => line.includes("-->"))) return "srt";
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
  const lines = splitLines(stripBom(text));
  const parsed =
    format === "text"
      ? parseTimestampedText(lines, durationMs)
      : parseCues(lines, format);
  if ("error" in parsed) return { ok: false, format, error: parsed.error };

  const segments = parsed.segments;
  if (segments.length === 0) {
    return { ok: false, format, error: { code: "empty", line: null } };
  }
  if (durationMs !== null) {
    const pastEnd = segments.findIndex(
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
  return {
    ok: true,
    format,
    segments,
    fullText: segments.map((segment) => segment.text).join(" "),
  };
}

type ParsedLines =
  | { segments: TranscriptSegment[]; lineNumbers: number[] }
  | { error: TranscriptImportError };

function parseCues(lines: string[], format: "vtt" | "srt"): ParsedLines {
  const cues: Array<{ segment: TranscriptSegment; line: number }> = [];
  const blocks = splitBlocks(lines);
  for (const [blockIndex, block] of blocks.entries()) {
    const first = block[0].text.trim();
    if (blockIndex === 0 && /^WEBVTT(?:\s|$)/.test(first)) continue;
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
  return {
    segments: cues.map((cue) => cue.segment),
    lineNumbers: cues.map((cue) => cue.line),
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

function parseTimestamp(value: string): number {
  const [clock, fraction = ""] = value.split(/[.,]/);
  const parts = clock.split(":").map(Number);
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  const millis = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  return seconds * 1000 + millis;
}

function cleanCueText(
  raw: string,
  format: "vtt" | "srt",
): { text: string; speaker: string | null } {
  const voice = /<v(?:\.[^\s>]+)*\s+([^>]+)>/.exec(raw);
  let text = raw.replace(/<[^>]*>/g, "");
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
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    },
  );
}

function splitBlocks(
  lines: string[],
): Array<Array<{ text: string; number: number }>> {
  const blocks: Array<Array<{ text: string; number: number }>> = [];
  let current: Array<{ text: string; number: number }> = [];
  for (const [index, text] of lines.entries()) {
    if (text.trim()) {
      current.push({ text, number: index + 1 });
    } else if (current.length) {
      blocks.push(current);
      current = [];
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
