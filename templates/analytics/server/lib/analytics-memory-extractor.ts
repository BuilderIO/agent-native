import { createHash } from "node:crypto";

export type AnalyticsMemoryMessage = {
  id?: string | null;
  role: "user" | "assistant" | "tool";
  text: string;
};

export type AnalyticsMemoryCandidate = {
  id: string;
  name: string;
  type: "reference";
  description: string;
  content: string;
  sourceMessageIndex: number;
  triggerMessageIndex: number;
  sourceMessageId: string | null;
  triggerMessageId: string | null;
};

const MAX_MESSAGES = 80;
const MAX_SOURCE_CHARS = 320;
const MAX_CANDIDATES = 5;
const CONFIRMATION =
  /^(?:yes|yeah|yep|correct|confirmed|exactly|that's right|that is right|that's correct|that is correct|you got it)(?:[.!\s,]|$)/i;
const STOP_WORDS = new Set([
  "about",
  "are",
  "as",
  "be",
  "by",
  "for",
  "from",
  "how",
  "is",
  "it",
  "means",
  "metric",
  "our",
  "the",
  "this",
  "to",
  "we",
  "what",
]);

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isUnsafe(text: string): boolean {
  return (
    text.length > MAX_SOURCE_CHARS ||
    /```|`|https?:\/\/|www\./i.test(text) ||
    /\b(?:select\s+.+\s+from|with\s+.+\s+as\s*\(|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table)\b/i.test(
      text,
    ) ||
    /[{};]|=>|\$\{/.test(text) ||
    /\b(?:api\s*key|access\s*token|password|secret|bearer|ssn|social security|credit card|card number|my name is|my email is|my phone|home address|date of birth)\b/i.test(
      text,
    ) ||
    /\b(?:customer|client|user|subscriber|contact|account|workspace|organization|org)\s*(?:#|\s+(?:id|number|no\.?))?\s*[:=]?\s*(?:[A-Z][A-Z0-9_-]{3,}|\d{4,})\b/.test(
      text,
    ) ||
    /\b(?:customer|client|subscriber|contact)\s+(?:named\s+)?[A-Z][\p{L}'-]{2,}\b/u.test(
      text,
    ) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
    /\b(?:\+?\d[ .()-]*){10,}\b/.test(text)
  );
}

function hasEnoughDetail(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return (
    words.length >= 4 &&
    text.length >= 18 &&
    !/^(?:remember this|keep this in mind|that is important|this is important|we use this|same as before)[.!]?$/i.test(
      text,
    )
  );
}

function explicitGuidance(text: string): string | null {
  const patterns = [
    /^(?:please\s+)?remember\s+(?:that\s+)?(.+)$/i,
    /^(?:for future (?:analytics )?(?:queries|analyses|work),\s*)(.+)$/i,
    /^(?:keep in mind(?: that)?\s*)(.+)$/i,
    /^(?:going forward,?\s*)(.+)$/i,
    /^(?:correction:?\s*)(.+)$/i,
    /^(?:i already told you(?: that)?\s*)(.+)$/i,
    /^(?:that(?:'s| is) (?:wrong|incorrect)[,;:]?\s*)(.+)$/i,
    /^(?:we use\s+.+?,?\s+not\s+.+)$/i,
    /^(?:the correct .+? is .+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return normalize(match[1] ?? match[0]);
  }
  return null;
}

function metricDefinition(
  text: string,
): { metric: string; definition: string } | null {
  const match =
    text.match(/^(?:we\s+)?define\s+(.{2,70}?)\s+(?:as|by)\s+(.+)$/i) ??
    text.match(
      /^(.{2,70}?)\s+(?:means|is defined as|is calculated as|equals)\s+(.+)$/i,
    );
  if (!match) return null;

  const metric = normalize(match[1] ?? "").replace(/[.:,;!?]+$/, "");
  const definition = normalize(match[2] ?? "").replace(/[.!?]+$/, "");
  if (!metric || !definition) return null;
  return { metric, definition };
}

function metricTokens(metric: string): string[] {
  return (metric.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => token.length > 1 && !STOP_WORDS.has(token),
  );
}

function findMetricConfirmationIndex(
  messages: readonly AnalyticsMemoryMessage[],
  definitionIndex: number,
  metric: string,
): number | null {
  const tokens = metricTokens(metric);
  if (tokens.length === 0) return null;

  let assistantRestatedMetric = false;
  for (
    let index = definitionIndex + 1;
    index < Math.min(messages.length, definitionIndex + 12);
    index += 1
  ) {
    const message = messages[index];
    if (!message) continue;

    if (message.role === "user") {
      return assistantRestatedMetric &&
        CONFIRMATION.test(normalize(message.text))
        ? index
        : null;
    }
    if (message.role === "assistant") {
      const assistantText = normalize(message.text).toLowerCase();
      const askedForConfirmation =
        /\b(?:is that right|did i get that right|is this (?:correct|right)|is that (?:correct|the definition)|correct\?)\b/i.test(
          assistantText,
        );
      assistantRestatedMetric ||=
        askedForConfirmation &&
        tokens.some((token) => assistantText.includes(token));
    }
  }
  return null;
}

function makeCandidate(
  kind: "guidance" | "metric",
  text: string,
  sourceMessageIndex: number,
  triggerMessageIndex: number,
  sourceMessageId: string | null,
  triggerMessageId: string | null,
): AnalyticsMemoryCandidate {
  const content =
    kind === "metric"
      ? `Metric definition: ${text}`
      : `For future Analytics work: ${text}`;
  const normalizedKey = `${kind}:${normalize(text).toLowerCase()}`;
  const digest = createHash("sha256")
    .update(normalizedKey)
    .digest("hex")
    .slice(0, 12);
  const id = `analytics-${kind}-${digest}`;

  return {
    id,
    name: id,
    type: "reference",
    description:
      content.length <= 120 ? content : `${content.slice(0, 117).trimEnd()}...`,
    content,
    sourceMessageIndex,
    triggerMessageIndex,
    sourceMessageId,
    triggerMessageId,
  };
}

/** Extract only concise, user-authored rules that are explicit or later confirmed. */
export function extractAnalyticsMemoryCandidates(
  messages: readonly AnalyticsMemoryMessage[],
): AnalyticsMemoryCandidate[] {
  const start = Math.max(0, messages.length - MAX_MESSAGES);
  const boundedMessages = messages.slice(start);
  const candidates: AnalyticsMemoryCandidate[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < boundedMessages.length; index += 1) {
    const message = boundedMessages[index];
    if (!message || message.role !== "user") continue;

    const source = normalize(message.text);
    if (!source || isUnsafe(source)) continue;

    const guidance = explicitGuidance(source);
    const definition = metricDefinition(source);
    const candidateText =
      guidance ??
      (definition ? `${definition.metric}: ${definition.definition}` : null);
    if (
      !candidateText ||
      isUnsafe(candidateText) ||
      !hasEnoughDetail(candidateText)
    ) {
      continue;
    }
    const localTriggerIndex = definition
      ? findMetricConfirmationIndex(boundedMessages, index, definition.metric)
      : index;
    if (localTriggerIndex === null) {
      continue;
    }

    const candidate = makeCandidate(
      definition ? "metric" : "guidance",
      candidateText,
      start + index,
      start + localTriggerIndex,
      message.id ?? null,
      boundedMessages[localTriggerIndex]?.id ?? null,
    );
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    candidates.push(candidate);
  }

  return candidates.slice(-MAX_CANDIDATES);
}
