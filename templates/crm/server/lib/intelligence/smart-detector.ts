import {
  formatEvidenceTimestamp,
  parseCallEvidenceExcerpts,
} from "./evidence.js";

export interface SmartDetectorDefinition {
  id: string;
  name: string;
  description?: string;
  classifierPrompt: string;
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
