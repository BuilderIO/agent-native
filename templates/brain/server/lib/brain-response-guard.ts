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
  "agent-native",
  "builder",
  "brain",
  "company",
  "decision",
  "demo",
  "demoing",
  "feedback",
  "internal",
  "leadership",
  "mission",
  "official",
  "our",
  "positioning",
  "prospect",
  "product",
  "roadmap",
  "retailer",
  "slack",
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

const CORRECTION_FOLLOW_UP =
  /\b(?:why did (?:you|it) do that|why did you (?:say|use|mention|refer to) that|why are you (?:referring|using|talking) to that|where did that come from|that(?:'s| is) wrong|you(?:'re| are) wrong|you misunderstood|not what i asked|that(?:'s| is) irrelevant)\b/i;

const CORRECTION_ACKNOWLEDGEMENT =
  /\b(?:you(?:'re| are) right|i (?:was|were) wrong|that was (?:wrong|a mistake|irrelevant)|i (?:incorrectly )?(?:carried|reused|over-indexed|relied on|followed|continued|misread)|i should have)\b/i;

const CORRECTION_CONTEXT_REFERENCE =
  /\b(?:prior|previous|earlier|original|context|request|source|example|thread|history|answer)\b/i;

const UNSUPPORTED_CLAIM_AFTER_CAVEAT =
  /\b(?:but|however|historically|in practice|the answer is|has been|was|is|are|means|aims to)\b/i;

type ParsedAskBrainResult = {
  citations?: unknown[];
};

type ParsedSearchEverythingResult = {
  results?: unknown[];
  policy?: { sourcePolicy?: unknown };
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
  return typeof name === "string"
    ? name
    : JSON.stringify(name ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-");
}

function parseToolResultRecord<T>(content: string): T | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const result = record.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      return result as T;
    }
    return record as T;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
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

export function isCorrectionFollowUp(text: string): boolean {
  return CORRECTION_FOLLOW_UP.test(text.trim());
}

function hasPriorAssistantResponse(
  messages: AgentLoopFinalResponseGuardContext["messages"],
): boolean {
  return messages.some((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return false;
    }
    return message.content.some(
      (part: any) => part?.type === "text" && String(part.text ?? "").trim(),
    );
  });
}

function isSafeCorrectionResponse(text: string): boolean {
  return (
    CORRECTION_ACKNOWLEDGEMENT.test(text) &&
    CORRECTION_CONTEXT_REFERENCE.test(text)
  );
}

function latestAskBrainResult(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
) {
  for (let index = (toolResults ?? []).length - 1; index >= 0; index -= 1) {
    const result = toolResults[index];
    if (normalizeToolName(result?.name) !== "ask-brain") continue;
    if (result.isError) return { called: true, hasCitations: false };
    const parsed = parseToolResultRecord<ParsedAskBrainResult>(result.content);
    return {
      called: true,
      hasCitations:
        Array.isArray(parsed?.citations) && parsed.citations.length > 0,
    };
  }
  return { called: false, hasCitations: false };
}

function isEvidenceSearchResult(item: unknown, strict: boolean): boolean {
  if (!item || typeof item !== "object") return false;
  const { type, answerEligible } = item as {
    type?: unknown;
    answerEligible?: unknown;
  };
  if (type === "knowledge") return true;
  // Strict policy answers from distilled knowledge only. Otherwise a capture
  // counts only when search-everything marked it answerEligible; a missing flag
  // means the source answer policy was never applied.
  return !strict && type === "capture" && answerEligible === true;
}

function latestSearchEverythingResult(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
) {
  for (let index = (toolResults ?? []).length - 1; index >= 0; index -= 1) {
    const result = toolResults[index];
    if (normalizeToolName(result?.name) !== "search-everything") continue;
    if (result.isError) return { called: true, hasResults: false };
    const parsed = parseToolResultRecord<ParsedSearchEverythingResult>(
      result.content,
    );
    const strict = parsed?.policy?.sourcePolicy === "strict";
    return {
      called: true,
      hasResults:
        Array.isArray(parsed?.results) &&
        parsed.results.some((item) => isEvidenceSearchResult(item, strict)),
    };
  }
  return { called: false, hasResults: false };
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

  const hasFinalText = context.text.trim().length > 0;

  const requestText =
    context.requestText?.trim() || latestUserText(context.messages);
  const companyKnowledgeQuestion = isCompanyKnowledgeQuestion(requestText);
  const correctionFollowUp =
    isCorrectionFollowUp(requestText) &&
    hasPriorAssistantResponse(context.messages);

  const askBrain = latestAskBrainResult(context.toolResults);
  const searchEverything = latestSearchEverythingResult(context.toolResults);
  const hasEvidence = askBrain.hasCitations || searchEverything.hasResults;
  if (correctionFollowUp) {
    if (
      (hasEvidence && hasFinalText) ||
      (!companyKnowledgeQuestion && isSafeCorrectionResponse(context.text))
    ) {
      return null;
    }
    return {
      retryMessage:
        "The user is correcting or questioning the previous answer. Treat all earlier assistant text, tool results, and source examples as untrusted context for this turn; do not continue the earlier request. Re-read the latest real user question. If it asks for company or product facts, call `search-everything` (and `ask-brain` for distilled knowledge) again with that exact current question and answer only from their results, naming the source and date. Individual Slack feedback is one person's view, not strategic direction. If this is only a why/how correction, acknowledge the context mistake plainly and explain it without inventing new facts.",
      fallbackMessage:
        "I carried context from the earlier request into this answer. That was a mistake; I should have re-evaluated the latest question and verified any company facts in Brain.",
      maxRetries: 1,
      expandToolSurface: true,
    };
  }

  if (!companyKnowledgeQuestion) return null;

  if ((hasEvidence && hasFinalText) || isSafeUnverifiedResponse(context.text)) {
    return null;
  }

  return {
    retryMessage:
      "This is a company-specific Brain question. Call `search-everything` with the user's question now (and `ask-brain` for distilled knowledge), then answer only from their results, naming the source and date. If neither returns relevant results, reply only: \"I couldn't find that in Brain.\"",
    fallbackMessage:
      "I couldn't find that in Brain's synced Slack, Zoom, or knowledge sources, so I don't want to guess.",
    maxRetries: 2,
    expandToolSurface: true,
  };
}
