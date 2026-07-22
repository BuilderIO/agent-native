import { isSafeCrmEvidenceExcerpt } from "../../crm/crm-field-firewall.js";
import {
  formatEvidenceTimestamp,
  parseCallEvidenceExcerpts,
} from "./evidence.js";

export interface CallEvidenceSummary {
  recap: string;
  keyPoints: Array<{ text: string; evidenceRef: string; quoteSeconds: number }>;
  nextSteps: Array<{
    text: string;
    evidenceRef: string;
    quoteSeconds: number;
    owner?: string;
  }>;
}

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    !isSafeCrmEvidenceExcerpt(value)
  ) {
    return null;
  }
  return value.trim();
}

function evidenceMoment(
  item: Record<string, unknown>,
  evidenceByRef: Map<
    string,
    Array<{ startSeconds: number; endSeconds?: number }>
  >,
): { evidenceRef: string; quoteSeconds: number } | null {
  const quoteSeconds = item.quoteSeconds;
  if (
    typeof item.evidenceRef !== "string" ||
    typeof quoteSeconds !== "number"
  ) {
    return null;
  }
  const evidence = evidenceByRef
    .get(item.evidenceRef)
    ?.find(
      (candidate) =>
        quoteSeconds >= candidate.startSeconds &&
        (candidate.endSeconds === undefined ||
          quoteSeconds <= candidate.endSeconds),
    );
  if (
    !evidence ||
    !Number.isFinite(quoteSeconds) ||
    quoteSeconds < evidence.startSeconds ||
    (evidence.endSeconds !== undefined && quoteSeconds > evidence.endSeconds)
  ) {
    return null;
  }
  return { evidenceRef: item.evidenceRef, quoteSeconds };
}

export function buildCallEvidenceSummaryPrompt(
  callTitle: string,
  values: unknown,
): string | null {
  const excerpts = parseCallEvidenceExcerpts(values, 40);
  if (!excerpts || !callTitle.trim() || callTitle.length > 240) return null;
  const evidence = excerpts
    .map(
      (excerpt) =>
        `[${excerpt.evidenceRef} ${formatEvidenceTimestamp(excerpt.startSeconds)}] ${excerpt.quote}`,
    )
    .join("\n");
  return `Summarize only the bounded Clips call evidence below for "${callTitle.trim()}". Do not infer facts not present in evidence.\n\nEvidence:\n${evidence}\n\nReturn only JSON: {"recap":"<=120 words","keyPoints":[{"text":"<=240 chars","evidenceRef":"exact ref","quoteSeconds":0}],"nextSteps":[{"text":"<=240 chars","evidenceRef":"exact ref","quoteSeconds":0,"owner":"optional <=120 chars"}]}. Every key point and next step must cite one supplied evidence reference and timestamp. Never return a transcript.`;
}

export function parseCallEvidenceSummary(
  raw: string,
  values: unknown,
): CallEvidenceSummary | null {
  const excerpts = parseCallEvidenceExcerpts(values, 40);
  if (!excerpts || typeof raw !== "string" || raw.length > 100_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const result = parsed as Record<string, unknown>;
  const recap = boundedText(result.recap, 1_200);
  if (!recap) return null;
  const evidenceByRef = new Map<
    string,
    Array<{ startSeconds: number; endSeconds?: number }>
  >();
  for (const excerpt of excerpts) {
    const moments = evidenceByRef.get(excerpt.evidenceRef) ?? [];
    moments.push({
      startSeconds: excerpt.startSeconds,
      ...(excerpt.endSeconds !== undefined
        ? { endSeconds: excerpt.endSeconds }
        : {}),
    });
    evidenceByRef.set(excerpt.evidenceRef, moments);
  }
  const parseItems = (rawItems: unknown, includeOwner: boolean) =>
    Array.isArray(rawItems)
      ? rawItems.slice(0, 20).flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item))
            return [];
          const record = item as Record<string, unknown>;
          const text = boundedText(record.text, 240);
          const moment = evidenceMoment(record, evidenceByRef);
          if (!text || !moment) return [];
          const owner = includeOwner ? boundedText(record.owner, 120) : null;
          return [
            {
              text,
              ...moment,
              ...(owner ? { owner } : {}),
            },
          ];
        })
      : [];
  return {
    recap,
    keyPoints: parseItems(result.keyPoints, false),
    nextSteps: parseItems(result.nextSteps, true),
  };
}
