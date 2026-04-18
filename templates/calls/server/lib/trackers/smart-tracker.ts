import type { TranscriptSegment } from "../../../shared/api.js";
import type { TrackerHitCandidate } from "./keyword-tracker.js";

export interface SmartTrackerInput {
  name: string;
  description?: string | null;
  classifierPrompt?: string | null;
}

interface Paragraph {
  paragraphIndex: number;
  segmentIndexes: number[];
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function groupIntoParagraphs(
  segments: TranscriptSegment[],
): Paragraph[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const paragraphs: Paragraph[] = [];
  let current: Paragraph | null = null;

  segments.forEach((seg, i) => {
    const label = seg.speakerLabel || "Speaker 0";
    if (!current || current.speakerLabel !== label) {
      if (current) paragraphs.push(current);
      current = {
        paragraphIndex: paragraphs.length,
        segmentIndexes: [i],
        speakerLabel: label,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: seg.text || "",
      };
    } else {
      current.segmentIndexes.push(i);
      current.endMs = Math.max(current.endMs, seg.endMs);
      current.text = `${current.text} ${seg.text || ""}`.trim();
    }
  });
  if (current) paragraphs.push(current);
  return paragraphs;
}

export function buildSmartTrackerPrompt(
  tracker: SmartTrackerInput,
  segments: TranscriptSegment[],
): string {
  const paragraphs = groupIntoParagraphs(segments);
  const paragraphBlock = paragraphs.length
    ? paragraphs
        .map(
          (p) =>
            `#${p.paragraphIndex} [${formatMs(p.startMs)}–${formatMs(p.endMs)} ${p.speakerLabel}] ${p.text}`,
        )
        .join("\n")
    : "(no transcript paragraphs)";

  const criterion =
    (tracker.classifierPrompt && tracker.classifierPrompt.trim()) ||
    `Does this paragraph match the tracker "${tracker.name}"?`;
  const description = tracker.description?.trim()
    ? `\nTracker description: ${tracker.description.trim()}`
    : "";

  return `You are classifying paragraphs from a sales-call transcript for a tracker called "${tracker.name}".${description}

Criterion:
${criterion}

For each paragraph below, decide whether it matches the criterion (yes) or not (no). Only include matches in your output. Do not invent quotes — the "quote" you return must be a verbatim sub-string of the paragraph's text.

Paragraphs:
${paragraphBlock}

Return ONLY a JSON array. No prose, no code fences. Shape:
[{"paragraphIndex": <number>, "quote": "<verbatim sub-string>", "confidence": <0-100>}]

If no paragraphs match, return [].`;
}

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z0-9]*\n?/, "");
    s = s.replace(/\n?```\s*$/, "");
  }
  return s.trim();
}

function extractJsonArray(raw: string): string | null {
  const stripped = stripFences(raw);
  const first = stripped.indexOf("[");
  const last = stripped.lastIndexOf("]");
  if (first === -1 || last === -1 || last < first) return null;
  return stripped.slice(first, last + 1);
}

interface RawHit {
  paragraphIndex?: number;
  segmentIndex?: number;
  quote?: string;
  confidence?: number;
}

export function parseSmartTrackerOutput(
  raw: string,
  segments: TranscriptSegment[],
): TrackerHitCandidate[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const jsonText = extractJsonArray(raw);
  if (!jsonText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const paragraphs = groupIntoParagraphs(segments);
  const hits: TrackerHitCandidate[] = [];

  for (const item of parsed as RawHit[]) {
    if (!item || typeof item !== "object") continue;
    const quote = typeof item.quote === "string" ? item.quote.trim() : "";
    if (!quote) continue;
    const confidence = clampConfidence(item.confidence);

    const paragraphIndex =
      typeof item.paragraphIndex === "number"
        ? item.paragraphIndex
        : typeof item.segmentIndex === "number"
          ? item.segmentIndex
          : null;

    let startMs = 0;
    let endMs = 0;
    let speakerLabel: string | null = null;

    if (
      paragraphIndex !== null &&
      paragraphIndex >= 0 &&
      paragraphIndex < paragraphs.length
    ) {
      const p = paragraphs[paragraphIndex];
      startMs = p.startMs;
      endMs = p.endMs;
      speakerLabel = p.speakerLabel;
    } else {
      const located = locateQuote(quote, segments);
      if (!located) continue;
      startMs = located.startMs;
      endMs = located.endMs;
      speakerLabel = located.speakerLabel;
    }

    hits.push({
      segmentStartMs: startMs,
      segmentEndMs: endMs,
      speakerLabel,
      quote,
      confidence,
    });
  }

  return hits;
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 80;
  const normalized = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function locateQuote(
  quote: string,
  segments: TranscriptSegment[],
): { startMs: number; endMs: number; speakerLabel: string | null } | null {
  const needle = quote.toLowerCase();
  for (const seg of segments) {
    const text = (seg.text || "").toLowerCase();
    if (text.includes(needle)) {
      return {
        startMs: seg.startMs,
        endMs: seg.endMs,
        speakerLabel: seg.speakerLabel || null,
      };
    }
  }
  return null;
}
