const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARACTERS = 2_000;
const MAX_TOTAL_CHARACTERS = 8_000;

const CREDENTIAL_ASSIGNMENT =
  /\b((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|auth|password|passwd|client[_ -]?secret|secret|token)\s*[:=]\s*)(?:bearer\s+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi;
const BEARER_VALUE = /\bbearer\s+[a-z0-9._~+/-]+=*/gi;
const SQL_CODE_BLOCK = /```(?:sql|postgres(?:ql)?)\b[\s\S]*?```/gi;
const SQL_STATEMENT =
  /(^|\n|\b(?:sql|query)\s*:\s*)(?:select\b[\s\S]*?\bfrom\b[\s\S]*?|insert\s+into\b[\s\S]*?|update\s+[\w."`]+\s+set\b[\s\S]*?|delete\s+from\b[\s\S]*?|create\s+(?:table|index|view|schema)\b[\s\S]*?|alter\s+table\b[\s\S]*?|drop\s+(?:table|index|view|schema)\b[\s\S]*?|with\b[\s\S]*?\bas\b[\s\S]*?\bselect\b[\s\S]*?)(?:;|$)/gi;
const DATA_URI_BASE64 =
  /\bdata:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=]+/gi;
const LONG_BASE64 = /[a-z0-9_+/=\n-]{128,}/gi;

export type PromptProvenanceMessage = {
  role: "user";
  text: string;
};

export type PromptProvenanceResult = {
  messages: PromptProvenanceMessage[];
  truncation: {
    messages: boolean;
    messageCharacters: boolean;
    totalCharacters: boolean;
  };
};

function textCandidate(value: unknown, index: number): string {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.prototype.hasOwnProperty.call(value, "role") ||
    !Object.prototype.hasOwnProperty.call(value, "text")
  ) {
    throw new TypeError(
      `Invalid prompt provenance candidate at index ${index}`,
    );
  }

  const candidate = value as { role: unknown; text: unknown };
  if (candidate.role !== "user" || typeof candidate.text !== "string") {
    throw new TypeError(
      `Invalid prompt provenance candidate at index ${index}`,
    );
  }

  return candidate.text;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/[ ]*\n[ ]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function redactCredentials(text: string): string {
  return text
    .replace(CREDENTIAL_ASSIGNMENT, "$1[REDACTED]")
    .replace(BEARER_VALUE, "Bearer [REDACTED]");
}

function omitSqlAndBase64Payloads(text: string): string {
  return text
    .replace(SQL_CODE_BLOCK, "[OMITTED_SQL]")
    .replace(SQL_STATEMENT, "$1[OMITTED_SQL]")
    .replace(DATA_URI_BASE64, "[OMITTED_BASE64]")
    .replace(LONG_BASE64, "[OMITTED_BASE64]");
}

function truncateToCharacters(
  text: string,
  maxCharacters: number,
): { characters: number; text: string; truncated: boolean } {
  let end = 0;
  let characters = 0;

  while (end < text.length && characters < maxCharacters) {
    const codePoint = text.codePointAt(end)!;
    end += codePoint > 0xffff ? 2 : 1;
    characters += 1;
  }

  return {
    characters,
    text: text.slice(0, end),
    truncated: end < text.length,
  };
}

export function sanitizePromptProvenanceCandidates(
  candidates: unknown,
): PromptProvenanceResult {
  if (!Array.isArray(candidates)) {
    throw new TypeError("Prompt provenance candidates must be an array");
  }

  const messages: PromptProvenanceMessage[] = [];
  const truncation = {
    messages: false,
    messageCharacters: false,
    totalCharacters: false,
  };
  let totalCharacters = 0;

  for (const [index, candidate] of candidates.entries()) {
    const normalized = normalizeText(textCandidate(candidate, index));
    if (!normalized) continue;

    if (messages.length >= MAX_MESSAGES) {
      truncation.messages = true;
      break;
    }

    const redacted = omitSqlAndBase64Payloads(redactCredentials(normalized));
    const boundedMessage = truncateToCharacters(
      redacted,
      MAX_MESSAGE_CHARACTERS,
    );
    if (boundedMessage.truncated) {
      truncation.messageCharacters = true;
    }

    const remainingCharacters = MAX_TOTAL_CHARACTERS - totalCharacters;
    const boundedTotal = truncateToCharacters(
      boundedMessage.text,
      remainingCharacters,
    );
    if (boundedTotal.truncated) {
      truncation.totalCharacters = true;
    }

    if (boundedTotal.text) {
      messages.push({ role: "user", text: boundedTotal.text });
      totalCharacters += boundedTotal.characters;
    }

    if (truncation.totalCharacters) break;
  }

  return { messages, truncation };
}
