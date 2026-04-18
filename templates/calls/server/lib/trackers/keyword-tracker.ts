import type { TranscriptSegment } from "../../../shared/api.js";

export interface KeywordTrackerInput {
  keywordsJson: string | null | undefined;
}

export interface TrackerHitCandidate {
  segmentStartMs: number;
  segmentEndMs: number;
  speakerLabel: string | null;
  quote: string;
  confidence: number;
}

export interface RunKeywordTrackerArgs {
  tracker: KeywordTrackerInput;
  segments: TranscriptSegment[];
}

function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  } catch {
    return [];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(keyword: string): RegExp {
  const tokens = keyword.trim().split(/\s+/).map(escapeRegex);
  if (tokens.length === 0) return /(?!)/g;
  const inner = tokens.join("\\s+");
  return new RegExp(`\\b${inner}\\b`, "gi");
}

function extractQuote(
  text: string,
  matchStart: number,
  matchEnd: number,
): string {
  const radius = 60;
  const start = Math.max(0, matchStart - radius);
  const end = Math.min(text.length, matchEnd + radius);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet.trim();
}

export function runKeywordTracker(
  args: RunKeywordTrackerArgs,
): TrackerHitCandidate[] {
  const { tracker, segments } = args;
  const keywords = parseKeywords(tracker.keywordsJson);
  if (keywords.length === 0 || !Array.isArray(segments)) return [];

  const patterns = keywords.map(buildPattern);
  const hits: TrackerHitCandidate[] = [];

  for (const seg of segments) {
    const text = typeof seg.text === "string" ? seg.text : "";
    if (!text) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        hits.push({
          segmentStartMs: seg.startMs,
          segmentEndMs: seg.endMs,
          speakerLabel: seg.speakerLabel || null,
          quote: extractQuote(text, match.index, match.index + match[0].length),
          confidence: 100,
        });
        if (match[0].length === 0) pattern.lastIndex += 1;
      }
    }
  }

  return hits;
}
