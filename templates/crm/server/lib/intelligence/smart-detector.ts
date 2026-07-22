import { isSafeCrmEvidenceExcerpt } from "../../crm/crm-field-firewall.js";
import {
  formatEvidenceTimestamp,
  parseCallEvidenceExcerpts,
} from "./evidence.js";
import type { CrmSignalCandidate } from "./keyword-detector.js";

export interface SmartDetectorDefinition {
  id: string;
  name: string;
  description?: string;
  classifierPrompt: string;
}

interface RawSmartSignal {
  evidenceRef?: unknown;
  quote?: unknown;
  confidence?: unknown;
}

function clampConfidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 80;
  return Math.max(
    0,
    Math.min(100, Math.round(parsed <= 1 ? parsed * 100 : parsed)),
  );
}

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function exactExcerptQuote(
  quote: string,
  evidenceQuote: string,
): string | null {
  const normalized = quote.trim();
  if (
    !normalized ||
    normalized.length > 1_200 ||
    !isSafeCrmEvidenceExcerpt(normalized) ||
    !evidenceQuote.includes(normalized)
  ) {
    return null;
  }
  return normalized;
}

/**
 * Builds delegated-agent context only. The CRM never invokes a model directly;
 * callers send this bounded prompt through the agent chat delegation path.
 */
export function buildSmartDetectorPrompt(
  detector: SmartDetectorDefinition,
  values: unknown,
): string | null {
  const excerpts = parseCallEvidenceExcerpts(values, 40);
  if (
    !excerpts ||
    !detector.id.trim() ||
    !detector.name.trim() ||
    !detector.classifierPrompt.trim()
  ) {
    return null;
  }
  const evidenceBlock = excerpts
    .map(
      (excerpt) =>
        `[${excerpt.evidenceRef} ${formatEvidenceTimestamp(excerpt.startSeconds)}${
          excerpt.speaker ? ` ${excerpt.speaker}` : ""
        }] ${excerpt.quote}`,
    )
    .join("\n");
  return `Classify bounded CRM call-evidence excerpts for detector "${detector.name}".\n\nCriterion:\n${detector.classifierPrompt.trim()}\n\nEvidence excerpts:\n${evidenceBlock}\n\nReturn only JSON: [{"evidenceRef":"exact evidence reference","quote":"exact verbatim substring from that evidence","confidence":0-100}]. Include only matches. Do not infer facts or create quotes. Never return a transcript.`;
}

/** Validates delegated-agent output against the exact bounded evidence supplied. */
export function parseSmartDetectorOutput(
  detector: SmartDetectorDefinition,
  raw: string,
  values: unknown,
): CrmSignalCandidate[] {
  const excerpts = parseCallEvidenceExcerpts(values, 40);
  if (!excerpts || typeof raw !== "string" || raw.length > 100_000) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length > 100) return [];
  const byRef = new Map<string, typeof excerpts>();
  for (const excerpt of excerpts) {
    const matches = byRef.get(excerpt.evidenceRef) ?? [];
    matches.push(excerpt);
    byRef.set(excerpt.evidenceRef, matches);
  }
  const seen = new Set<string>();
  const results: CrmSignalCandidate[] = [];
  for (const item of parsed as RawSmartSignal[]) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.evidenceRef !== "string"
    ) {
      continue;
    }
    const evidence =
      typeof item.quote === "string"
        ? byRef
            .get(item.evidenceRef)
            ?.find((candidate) =>
              exactExcerptQuote(item.quote as string, candidate.quote),
            )
        : undefined;
    const quote =
      evidence && typeof item.quote === "string"
        ? exactExcerptQuote(item.quote, evidence.quote)
        : null;
    if (!evidence || !quote) continue;
    const key = `${evidence.evidenceRef}:${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      detectorId: detector.id,
      detectorName: detector.name,
      kind: "smart",
      evidenceRef: evidence.evidenceRef,
      quote,
      ...(evidence.speaker ? { speaker: evidence.speaker } : {}),
      startSeconds: evidence.startSeconds,
      ...(evidence.endSeconds !== undefined
        ? { endSeconds: evidence.endSeconds }
        : {}),
      confidence: clampConfidence(item.confidence),
    });
  }
  return results;
}
