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
const TECHNICAL_NAMES = new Set([
  "athena",
  "active",
  "all",
  "bigquery",
  "data",
  "databricks",
  "daily",
  "first",
  "for",
  "googlecloud",
  "googlesql",
  "looker",
  "metric",
  "metabase",
  "mysql",
  "new",
  "our",
  "postgres",
  "postgresql",
  "powerbi",
  "redshift",
  "revenue",
  "snowflake",
  "tableau",
  "the",
  "this",
  "trino",
  "trial",
  "use",
  "when",
  "your",
]);
const CONFIRMATION =
  /^(?:yes|yeah|yep|correct|confirmed|exactly|that's right|that is right|that's correct|that is correct|you got it|yes,?\s+(?:that's|that is)\s+(?:exactly\s+)?(?:right|correct))[.!]*$/i;
const CONFIRMATION_QUESTION =
  /\b(?:is that right|did i get that right|is this (?:correct|right)|is that (?:correct|the definition)|correct\?)\b/i;
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
const DEFINITION_STOP_WORDS = new Set([
  ...STOP_WORDS,
  "a",
  "an",
  "its",
  "that",
]);
const ADDRESS_DETAILS =
  /\baddress\b|\b(?:p\.?\s*o\.?\s*box|post office box)\s*#?\s*\d+\b|\b\d{1,6}(?:[-–]\d{1,6})?[a-z]?,?\s+(?:(?:street|st\.?|avenue|ave\.?|avenida|av\.?|rue|calle|via|viale|strada|strasse|straße|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|road|rd\.?|route|chemin|carrer|carretera|paseo|piazza|corso|platz|weg|gasse|ulica|prospekt|court|ct\.?|circle|cir\.?|way|place|pl\.?|parkway|pkwy\.?|terrace|ter\.?|highway|hwy\.?)\b|(?:[\p{L}\p{N}.'’-]+\s+){1,5}(?:street|st\.?|avenue|ave\.?|avenida|av\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|road|rd\.?|route|carrer|carretera|court|ct\.?|circle|cir\.?|way|place|pl\.?|parkway|pkwy\.?|terrace|ter\.?|highway|hwy\.?)\b)|\b(?:rue|calle|via|viale|strada|strasse|straße|avenida|boulevard|chemin|route|carrer|carretera|paseo|piazza|corso|platz|weg|gasse|ulica|prospekt)\s+(?:(?:de|del|da|di|della)\s+)?(?:[\p{L}\p{N}.'’-]+\s+){0,4}\d{1,6}(?:[-–]\d{1,6})?\b/iu;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function containsLikelyCustomerOrPersonName(text: string): boolean {
  const labeledName =
    /\b(?:customer|client|person|contact|subscriber|account|workspace|organization|org)\s+(?:(?:named|called)\s+)?(?:[A-Z][\p{L}'-]{2,}|[a-z][\p{L}'-]{2,}\s+(?:should|must|uses|use|needs|requires|has|is|was)\b)/u.test(
      text,
    );
  if (labeledName) return true;

  const leadingName =
    /^([A-Z][\p{L}'-]{2,}(?:\s+[A-Z][\p{L}'-]{2,}){0,2})(?:['’]s)?\s+(?:should|must|uses|use|needs|requires|has|is|was|owns|prefers|wants|said|says|means|equals|starts|returns)\b/u.exec(
      text,
    );
  const leadingNameWords = leadingName?.[1]?.trim().split(/\s+/) ?? [];
  return Boolean(
    leadingName &&
    !leadingNameWords.every((word) => TECHNICAL_NAMES.has(word.toLowerCase())),
  );
}

function isUnsafe(text: string): boolean {
  return (
    text.length > MAX_SOURCE_CHARS ||
    /```|`|https?:\/\/|www\./i.test(text) ||
    /\b(?:select\s+.+\s+from|with\s+.+\s+as\s*\(|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table)\b/i.test(
      text,
    ) ||
    /[{};]|=>|\$\{/.test(text) ||
    ADDRESS_DETAILS.test(text) ||
    /\b(?:api\s*key|api\s*token|access\s*token|auth(?:entication)?\s*token|password|passphrase|credential|private\s+key|secret\s+key|client\s+secret|signing\s+key|secret|bearer|ssn|social security|credit card|card number|my name is|my email is|my phone|home address|date of birth)\b/i.test(
      text,
    ) ||
    /\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/.test(
      text,
    ) ||
    /\b(?:customer|client|user|subscriber|contact|account|workspace|organization|org)\s*(?:#|\s+(?:id|number|no\.?))?\s*[:=]?\s*(?:[A-Z][A-Z0-9_-]{3,}|\d{4,})\b/.test(
      text,
    ) ||
    /\b(?:customer|client|subscriber|contact)\s+(?:named\s+)?[A-Z][\p{L}'-]{2,}\b/u.test(
      text,
    ) ||
    containsLikelyCustomerOrPersonName(text) ||
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

function restatesDefinition(text: string, definition: string): boolean {
  const negation =
    /\b(?:no|not|never|without|except|excluding|exclude|excluded|doesn't|does not|isn't|is not|don't|do not|didn't|did not|cannot|can't|won't|will not|shouldn't|should not|wouldn't|would not|fail(?:s|ed)? to)\b/gi;
  const definitionNegations = new Set(
    definition.match(negation)?.map((token) => token.toLowerCase()) ?? [],
  );
  if (
    (text.match(negation) ?? []).some(
      (token) => !definitionNegations.has(token.toLowerCase()),
    )
  ) {
    return false;
  }

  const requiredTokens = (
    definition.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter(
    (token) =>
      (token.length > 1 || /\d/.test(token)) &&
      !DEFINITION_STOP_WORDS.has(token),
  );
  if (requiredTokens.length === 0) return false;

  const questionIndex = text.search(CONFIRMATION_QUESTION);
  const statement = questionIndex < 0 ? text : text.slice(0, questionIndex);
  let started = false;
  let matchedTokens = 0;
  for (const token of statement.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (!started) {
      if (token === requiredTokens[0]) {
        started = true;
        matchedTokens = 1;
      }
      continue;
    }
    if (token === requiredTokens[matchedTokens]) {
      matchedTokens += 1;
    } else if (!DEFINITION_STOP_WORDS.has(token)) {
      return false;
    }
  }
  return matchedTokens === requiredTokens.length;
}

function findMetricConfirmationIndex(
  messages: readonly AnalyticsMemoryMessage[],
  definitionIndex: number,
  metric: string,
  definition: string,
): number | null {
  const tokens = metricTokens(metric);
  if (tokens.length === 0) return null;

  let assistantRestatedDefinition = false;
  for (
    let index = definitionIndex + 1;
    index < Math.min(messages.length, definitionIndex + 12);
    index += 1
  ) {
    const message = messages[index];
    if (!message) continue;

    if (message.role === "user") {
      return assistantRestatedDefinition &&
        CONFIRMATION.test(normalize(message.text))
        ? index
        : null;
    }
    if (message.role === "assistant") {
      const assistantText = normalize(message.text).toLowerCase();
      const askedForConfirmation = CONFIRMATION_QUESTION.test(assistantText);
      assistantRestatedDefinition ||=
        askedForConfirmation &&
        tokens.some((token) => assistantText.includes(token)) &&
        restatesDefinition(assistantText, definition);
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
      ? findMetricConfirmationIndex(
          boundedMessages,
          index,
          definition.metric,
          definition.definition,
        )
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
