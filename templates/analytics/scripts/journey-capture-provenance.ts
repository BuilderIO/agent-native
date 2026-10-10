const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARACTERS = 2_000;
const MAX_TOTAL_CHARACTERS = 8_000;

const AUTHORIZATION_ASSIGNMENT =
  /(["']?)(authorization|proxy-authorization|cookie2?|set-cookie)\1(\s*[:=]\s*)(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|([^\r\n]*))/gi;
const ASSIGNMENT =
  /(["']?)([a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)\1(\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\r\n]*))/gi;
const MARKUP_ASSIGNMENT =
  /(`{1,3}|\*{1,2}|_{1,2})([a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)\1(\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\r\n]*))/gi;
const ASSIGNMENT_KEY =
  /(["']?)([a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)\1(\s*[:=]\s*)/gi;
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi;
const SPACE_SEPARATED_CREDENTIAL_FORMS = [
  /(?:^|\s)--?([a-z][a-z0-9_.-]*)[ \t]+\S/gim,
  /\bexport[ \t]+([a-z][a-z0-9_.-]*)[ \t]+\S/gi,
  /\b(?:(?:my|our|your|the)[ \t]+)?([a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)?)[ \t]+(?:is|equals)[ \t]+\S/gi,
] as const;
const BEARER_VALUE = /\bbearer\s+[a-z0-9._~+/-]+=*/gi;
const PROVIDER_TOKEN =
  /\b(?:github_pat_[a-z0-9_]{20,}|gh[pousr]_[a-z0-9_]{20,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|sk-proj-[a-z0-9_-]{20,}|sk-ant-[a-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[a-z0-9]{16,}|AIza[a-z0-9_-]{35}|xox[baprs]-[a-z0-9-]{10,}|npm_[a-z0-9]{30,})\b/gi;
const SQL_CODE_BLOCK = /```(?:sql|postgres(?:ql)?)\b[\s\S]*?```/gi;
const SQL_STATEMENT =
  /(^|\n|\b(?:sql|query|statement)\s*:\s*)(?:select\b[\s\S]*?\bfrom\b[\s\S]*?|insert\s+into\b[\s\S]*?|update\s+[\w."\x60]+\s+set\b[\s\S]*?|delete\s+from\b[\s\S]*?|create\s+(?:table|index|view|schema)\b[\s\S]*?|alter\s+table\b[\s\S]*?|drop\s+(?:table|index|view|schema)\b[\s\S]*?|with\b[\s\S]*?\bas\b[\s\S]*?\bselect\b[\s\S]*?)(?:;|$)/i;
const LABELED_SQL_STATEMENT =
  /\b(?:sql|query|statement)\s*:\s*select\b[\s\S]*?(?:;|$)/i;
const SQL_LOOKING_TEXT =
  /\bselect\s+(?:(?:distinct|all)\s+)?(?:\*|['"]|[-+]?(?:\d|\.?\d)|case\b|[a-z_][\w$]*\s*\()|\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|create\s+(?:table|index|view|schema)|alter\s+table|drop\s+(?:table|index|view|schema))\b|\bwith\s+[a-z_][\w$]*\s+as\s*\(/i;
const SQL_IDENTIFIER = String.raw`(?:[a-z_][\w$]*|"(?:[^"]|"")*")`;
const SQL_RELATION = `${SQL_IDENTIFIER}(?:\\.${SQL_IDENTIFIER})*`;
const INLINE_SQL_SELECT =
  /\bselect\s+(?:(?:distinct|all)\s+)?[a-z_][\w$.]*(?:\s*,\s*[a-z_][\w$.]*)*\s+from\s+[a-z_][\w$.]*\s+where\s+[a-z_][\w$.]*\s*(?:=|<>|!=|<=|>=|<|>|like\b|in\s*\()/i;
const INLINE_SQL_TABLE_SELECT = new RegExp(
  String.raw`\bselect\s+(?:(?:distinct|all)\s+)?${SQL_IDENTIFIER}(?:\s*,\s*${SQL_IDENTIFIER})*\s+from\s+${SQL_RELATION}(?:\s+(?:as\s+)?${SQL_IDENTIFIER})?(?=\s*(?:[;?.!,]|$))`,
  "i",
);
const NATURAL_LANGUAGE_LIST_SELECTION =
  /\bselect\s+one\s+from\s+(?:the\s+)?list\b\s*,?\s*then\b/i;
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

function isCredentialKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const parts = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (
    parts.some((part) =>
      [
        "auth",
        "authorization",
        "cookie",
        "cookie2",
        "credential",
        "credentials",
        "pass",
        "password",
        "passwords",
        "passwd",
        "passphrase",
        "pin",
        "pw",
        "pwd",
        "secret",
        "secrets",
        "sig",
        "signature",
        "signatures",
        "token",
        "tokens",
      ].includes(part),
    )
  ) {
    return true;
  }
  if (
    parts.some(
      (part, index) =>
        ["access", "api", "private", "secret", "signing"].includes(part) &&
        parts[index + 1] === "key",
    )
  ) {
    return true;
  }
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return /(?:pass|passwords?|passwd|passphrase|pin|pw|pwd|secrets?|tokens?|credentials?|authorization|authentication|auth|cookies?|session|sigs?|signatures?|(?:api|access|private|secret|signing)key)$/.test(
    compact,
  );
}

function hasSpaceSeparatedCredential(text: string): boolean {
  for (const pattern of SPACE_SEPARATED_CREDENTIAL_FORMS) {
    for (const match of text.matchAll(pattern)) {
      if (isCredentialKey(match[1] ?? "")) return true;
    }
  }
  return false;
}

function urlQueryValueEnd(text: string, valueStart: number): number | null {
  const prefix = text.slice(0, valueStart);
  const queryStart = prefix.lastIndexOf("?");
  if (
    queryStart <= prefix.lastIndexOf("://") ||
    queryStart <= prefix.lastIndexOf("#")
  ) {
    return null;
  }
  const delimiter = /[&#\s]/.exec(text.slice(valueStart));
  return delimiter ? valueStart + delimiter.index : text.length;
}

function redactCredentialAssignments(text: string): string {
  const assignments: Array<{
    redactStart: number;
    redactEnd: number;
    valueEnd: number;
  }> = [];
  let coveredValueEnd = -1;
  for (const match of text.matchAll(ASSIGNMENT_KEY)) {
    if (!isCredentialKey(match[2] ?? "")) continue;
    const valueStart = (match.index ?? 0) + match[0].length;
    if (valueStart < coveredValueEnd) continue;

    const quote = text[valueStart];
    if (quote === '"' || quote === "'") {
      let cursor = valueStart + 1;
      while (
        cursor < text.length &&
        text[cursor] !== "\r" &&
        text[cursor] !== "\n"
      ) {
        if (text[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === quote) break;
        cursor += 1;
      }
      const hasClosingQuote = text[cursor] === quote;
      const valueEnd = hasClosingQuote ? cursor + 1 : cursor;
      assignments.push({
        redactStart: valueStart + 1,
        redactEnd: hasClosingQuote ? cursor : valueEnd,
        valueEnd,
      });
      coveredValueEnd = valueEnd;
      continue;
    }

    const queryValueEnd = urlQueryValueEnd(text, valueStart);
    if (queryValueEnd !== null) {
      assignments.push({
        redactStart: valueStart,
        redactEnd: queryValueEnd,
        valueEnd: queryValueEnd,
      });
      coveredValueEnd = queryValueEnd;
      continue;
    }

    let valueEnd = text.indexOf("\n", valueStart);
    if (valueEnd === -1) valueEnd = text.length;
    if (text[valueEnd - 1] === "\r") valueEnd -= 1;
    assignments.push({
      redactStart: valueStart,
      redactEnd: valueEnd,
      valueEnd,
    });
    coveredValueEnd = valueEnd;
  }

  let redacted = text;
  for (const { redactStart, redactEnd } of assignments.reverse()) {
    redacted =
      redacted.slice(0, redactStart) + "[REDACTED]" + redacted.slice(redactEnd);
  }
  return redacted;
}

function redactCredentials(text: string): string {
  if (hasSpaceSeparatedCredential(text)) return "[REDACTED]";

  return redactCredentialAssignments(
    text.replace(URL_USERINFO, (_match, scheme) => `${scheme}[REDACTED]@`),
  )
    .replace(
      MARKUP_ASSIGNMENT,
      (match, markup, key, delimiter, doubleQuoted, singleQuoted) => {
        if (!isCredentialKey(key)) return match;
        const valueQuote =
          doubleQuoted !== undefined
            ? '"'
            : singleQuoted !== undefined
              ? "'"
              : "";
        return `${markup}${key}${markup}${delimiter}${valueQuote}[REDACTED]${valueQuote}`;
      },
    )
    .replace(
      AUTHORIZATION_ASSIGNMENT,
      (_match, keyQuote, key, delimiter, doubleQuoted, singleQuoted) => {
        const valueQuote =
          doubleQuoted !== undefined
            ? '"'
            : singleQuoted !== undefined
              ? "'"
              : "";
        return `${keyQuote}${key}${keyQuote}${delimiter}${valueQuote}[REDACTED]${valueQuote}`;
      },
    )
    .replace(
      ASSIGNMENT,
      (match, keyQuote, key, delimiter, doubleQuoted, singleQuoted, value) => {
        if (!isCredentialKey(key)) return match;
        if (
          [doubleQuoted, singleQuoted, value].some(
            (candidate) =>
              typeof candidate === "string" &&
              /^\[REDACTED\](?:[&#]|$)/.test(candidate),
          )
        ) {
          return match;
        }
        const valueQuote =
          doubleQuoted !== undefined
            ? '"'
            : singleQuoted !== undefined
              ? "'"
              : "";
        return `${keyQuote}${key}${keyQuote}${delimiter}${valueQuote}[REDACTED]${valueQuote}`;
      },
    )
    .replace(BEARER_VALUE, "Bearer [REDACTED]")
    .replace(PROVIDER_TOKEN, "[REDACTED]");
}

function omitSqlAndBase64Payloads(text: string): string {
  const withoutCodeBlocks = text.replace(SQL_CODE_BLOCK, "[OMITTED_SQL]");
  const searchableText = withoutCodeBlocks.replace(
    NATURAL_LANGUAGE_LIST_SELECTION,
    " ",
  );
  if (
    SQL_LOOKING_TEXT.test(searchableText) ||
    INLINE_SQL_SELECT.test(searchableText) ||
    INLINE_SQL_TABLE_SELECT.test(searchableText) ||
    SQL_STATEMENT.test(searchableText) ||
    LABELED_SQL_STATEMENT.test(searchableText)
  ) {
    return "[OMITTED_SQL]";
  }
  return withoutCodeBlocks
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
