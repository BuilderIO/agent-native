import askBrainAction from "../../actions/ask-brain.js";

const MUTATION_INTENTS = new Set([
  "approve",
  "create",
  "delete",
  "distill",
  "enqueue",
  "import",
  "reject",
  "retry",
  "run",
  "seed",
  "set",
  "sync",
  "update",
  "write",
]);

const QUESTION_PREFIXES = [
  "answer",
  "can",
  "could",
  "did",
  "does",
  "find",
  "how",
  "is",
  "should",
  "summarize",
  "tell",
  "using",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
];

type AskBrainResult = Awaited<ReturnType<typeof askBrainAction.run>>;
type BrainCitation = AskBrainResult["citations"][number];

export async function tryAnswerBrainA2AQuestion(
  text: string,
): Promise<string | null> {
  const question = text.trim();
  if (!isReadOnlyQuestion(question)) return null;

  try {
    const result = await askBrainAction.run({ question, mode: "cited" });
    if (!result.citations.length) return null;
    return formatBrainA2AAnswer(result);
  } catch (err) {
    console.warn(
      "[brain:a2a-fallback] deterministic ask-brain fallback failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export function formatBrainA2AAnswer(result: AskBrainResult): string {
  const sources = result.citations
    .slice(0, 6)
    .map((citation: any, index: number) => formatCitation(citation, index + 1))
    .join("\n");

  return `${result.answer.trim()}\n\nSources:\n${sources}`;
}

function isReadOnlyQuestion(text: string): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase().trim();
  const firstWord = normalized.split(/[^a-z0-9-]+/)[0] ?? "";
  if (MUTATION_INTENTS.has(firstWord)) return false;
  if (normalized.endsWith("?")) return true;
  return QUESTION_PREFIXES.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(`${prefix} `) ||
      normalized.startsWith(`${prefix}:`),
  );
}

function formatCitation(citation: BrainCitation, index: number): string {
  const source = [citation.title, citation.sourceName]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" - ");
  const label = source || citation.id || `Source ${index}`;
  const excerpt = truncateForCitation(citation.excerpt ?? "");
  const linked = citation.url ? `[${label}](${citation.url})` : label;
  return `${index}. ${linked}${excerpt ? `: "${excerpt}"` : ""}`;
}

function truncateForCitation(excerpt: string): string {
  const normalized = excerpt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 217).trimEnd()}...`;
}
