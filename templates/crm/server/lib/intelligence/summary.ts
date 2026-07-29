import {
  formatEvidenceTimestamp,
  parseCallEvidenceExcerpts,
} from "./evidence.js";

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
