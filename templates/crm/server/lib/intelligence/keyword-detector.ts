import {
  type CallEvidenceExcerpt,
  parseCallEvidenceExcerpts,
} from "./evidence.js";

export interface KeywordDetectorDefinition {
  id: string;
  name: string;
  kind: "keyword";
  keywords: string[];
}

export interface CrmSignalCandidate {
  detectorId: string;
  detectorName: string;
  kind: "keyword" | "smart";
  evidenceRef: string;
  quote: string;
  speaker?: string;
  startSeconds: number;
  endSeconds?: number;
  confidence: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordPattern(keyword: string): RegExp | null {
  const terms = keyword.trim().split(/\s+/).map(escapeRegex).filter(Boolean);
  if (!terms.length) return null;
  return new RegExp(`\\b${terms.join("\\s+")}\\b`, "gi");
}

function boundedQuote(text: string, start: number, end: number): string {
  const radius = 120;
  const quoteStart = Math.max(0, start - radius);
  const quoteEnd = Math.min(text.length, end + radius);
  return `${quoteStart > 0 ? "…" : ""}${text.slice(quoteStart, quoteEnd)}${
    quoteEnd < text.length ? "…" : ""
  }`.trim();
}

/** Runs deterministic detector matching on already-bounded Clips evidence excerpts. */
export function runKeywordDetector(
  detector: KeywordDetectorDefinition,
  values: unknown,
): CrmSignalCandidate[] {
  const excerpts = parseCallEvidenceExcerpts(values);
  if (!excerpts || !detector.id.trim() || !detector.name.trim()) return [];

  const patterns = detector.keywords
    .filter((keyword) => typeof keyword === "string" && keyword.trim())
    .slice(0, 40)
    .map(keywordPattern)
    .filter((pattern): pattern is RegExp => pattern !== null);
  const hits: CrmSignalCandidate[] = [];
  const seen = new Set<string>();

  for (const excerpt of excerpts) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(excerpt.quote)) !== null) {
        const quote = boundedQuote(
          excerpt.quote,
          match.index,
          match.index + match[0].length,
        );
        const key = `${excerpt.evidenceRef}:${excerpt.startSeconds}:${quote}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({
            detectorId: detector.id,
            detectorName: detector.name,
            kind: "keyword",
            evidenceRef: excerpt.evidenceRef,
            quote,
            ...(excerpt.speaker ? { speaker: excerpt.speaker } : {}),
            startSeconds: excerpt.startSeconds,
            ...(excerpt.endSeconds !== undefined
              ? { endSeconds: excerpt.endSeconds }
              : {}),
            confidence: 100,
          });
        }
        if (match[0].length === 0) pattern.lastIndex += 1;
      }
    }
  }
  return hits;
}

export function evidenceRefsForSignals(
  signals: CrmSignalCandidate[],
): string[] {
  return [...new Set(signals.map((signal) => signal.evidenceRef))];
}

export type { CallEvidenceExcerpt };
