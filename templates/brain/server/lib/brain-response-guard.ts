import type {
  AgentLoopFinalResponseGuardContext,
  AgentLoopFinalResponseGuardResult,
} from "@agent-native/core/server";

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
  "set",
  "sync",
  "update",
  "write",
]);

const COMPANY_KNOWLEDGE_TERMS = [
  "agent native",
  "builder",
  "brain",
  "company",
  "decision",
  "internal",
  "mission",
  "official",
  "our",
  "positioning",
  "product",
  "roadmap",
  "strategy",
  "team",
  "values",
  "we",
];

const QUESTION_PREFIXES = [
  "can",
  "could",
  "did",
  "does",
  "how",
  "is",
  "should",
  "summarize",
  "tell",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
];

const SAFE_UNVERIFIED_RESPONSE =
  /(?:could not find|couldn't find|do not have|don't have|cannot (?:verify|confirm)|can't (?:verify|confirm)|no (?:approved|verified|trustworthy|authoritative) (?:brain )?(?:knowledge|source|evidence)|not enough (?:reviewed )?(?:support|evidence)|unverified|not currently available|i don't know|unable to verify)/i;

const PROVENANCE_QUESTION =
  /\b(?:where (?:did you get|was that pulled from|is that from)|what(?:'s| is) the source|which source|what source|cite|citation|according to|trusted (?:content|source))\b/i;

const UNSUPPORTED_CLAIM_AFTER_CAVEAT =
  /\b(?:but|however|historically|in practice|the answer is|has been|was|is|are|means|aims to)\b/i;

type ParsedAskBrainResult = {
  citations?: unknown[];
};

function latestUserText(
  messages: AgentLoopFinalResponseGuardContext["messages"],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user" || !Array.isArray(message.content)) {
      continue;
    }
    const text = message.content
      .filter((part: any) => part?.type === "text")
      .map((part: any) => String(part.text ?? ""))
      .join("\n");
    if (text.trim()) return text;
  }
  return "";
}

function normalizeToolName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function parseAskBrainResult(content: string): ParsedAskBrainResult | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const result = record.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      return result as ParsedAskBrainResult;
    }
    return record as ParsedAskBrainResult;
  } catch {
    return null;
  }
}

function hasMutationWorkflowIntent(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  const firstWord = normalized.split(/[^a-z0-9-]+/)[0] ?? "";
  if (MUTATION_INTENTS.has(firstWord)) return true;

  return (
    /^(?:how do i|how can i|please)\b/.test(normalized) &&
    /\b(?:approve|create|delete|distill|enqueue|import|reject|retry|run|set|sync|update|write)\b/.test(
      normalized,
    )
  );
}

function containsCompanyKnowledgeTerm(text: string): boolean {
  return COMPANY_KNOWLEDGE_TERMS.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(text);
  });
}

export function isCompanyKnowledgeQuestion(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  if (!normalized || hasMutationWorkflowIntent(normalized)) return false;

  const firstWord = normalized.split(/[^a-z0-9-]+/)[0] ?? "";
  const questionLike =
    normalized.endsWith("?") ||
    QUESTION_PREFIXES.some(
      (prefix) =>
        normalized === prefix ||
        normalized.startsWith(`${prefix} `) ||
        normalized.startsWith(`${prefix}:`),
    );
  if (!questionLike) return false;

  return (
    containsCompanyKnowledgeTerm(normalized) ||
    PROVENANCE_QUESTION.test(normalized) ||
    firstWord === "our" ||
    firstWord === "we"
  );
}

function latestAskBrainResult(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
) {
  for (let index = (toolResults ?? []).length - 1; index >= 0; index -= 1) {
    const result = toolResults[index];
    if (normalizeToolName(result?.name) !== "ask-brain") continue;
    if (result.isError) return { called: true, hasCitations: false };
    const parsed = parseAskBrainResult(result.content);
    return {
      called: true,
      hasCitations:
        Array.isArray(parsed?.citations) && parsed.citations.length > 0,
    };
  }
  return { called: false, hasCitations: false };
}

function isSafeUnverifiedResponse(text: string): boolean {
  return (
    SAFE_UNVERIFIED_RESPONSE.test(text) &&
    !UNSUPPORTED_CLAIM_AFTER_CAVEAT.test(text)
  );
}

export function brainFinalResponseGuard(
  context: AgentLoopFinalResponseGuardContext,
): AgentLoopFinalResponseGuardResult | null {
  if (context.executionMode === "plan") return null;

  const requestText =
    context.requestText?.trim() || latestUserText(context.messages);
  if (!isCompanyKnowledgeQuestion(requestText)) return null;

  const askBrain = latestAskBrainResult(context.toolResults);
  if (askBrain.hasCitations || isSafeUnverifiedResponse(context.text)) {
    return null;
  }

  return {
    retryMessage:
      "This is a company-specific Brain knowledge question. Do not answer from general model knowledge. Call `ask-brain` with the user's question now, then use only its cited Brain evidence. If it returns no citations, say that Brain does not have a verified source and do not fill the gap from memory.",
    fallbackMessage:
      "I couldn't verify that in Brain's governed sources, so I don't want to guess. Add or approve an authoritative source and try again.",
    maxRetries: 2,
    expandToolSurface: true,
  };
}
