const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARACTERS = 2_000;
const MAX_TOTAL_CHARACTERS = 8_000;

const AUTHORIZATION_ASSIGNMENT =
  /(["']?)(authorization|proxy-authorization|cookie2?|set-cookie)\1(\s*[:=]\s*)(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|([^\r\n]*))/gi;
const ASSIGNMENT =
  /(["']?)((?:--?)?[a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)\1(\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\r\n]*))/gi;
const MARKUP_ASSIGNMENT =
  /(`{1,3}|\*{1,2}|_{1,2})((?:--?)?[a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)\1(\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\r\n]*))/gi;
const ASSIGNMENT_KEY =
  /(["']?)((?:--?)?[a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)\1(\s*[:=]\s*)/gi;
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi;
const QUOTED_ARRAY_CREDENTIAL_FLAG =
  /(["'])(--?[a-z][a-z0-9_.-]*)\1\s*,\s*["']/gi;
const SPACE_SEPARATED_CREDENTIAL_FORMS = [
  /(?:^|\s)--?([a-z][a-z0-9_.-]*)[ \t]+\S/gim,
  /\bexport[ \t]+([a-z][a-z0-9_.-]*)[ \t]+\S/gi,
] as const;
const BEARER_VALUE = /\bbearer\s+[a-z0-9._~+/-]+=*/gi;
const JWT_VALUE = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;
const SLACK_INCOMING_WEBHOOK_URL =
  /\bhttps?:\/\/hooks\.slack(?:-gov)?\.com\/services\/[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_-]+(?:\?[^\s]*)?/gi;
const DISCORD_INCOMING_WEBHOOK_URL =
  /\bhttps?:\/\/(?:[a-z0-9-]+\.)*discord(?:app)?\.com\/api\/webhooks\/[a-z0-9_-]+\/[a-z0-9._-]+(?:\?[^\s]*)?/gi;
const NATURAL_LANGUAGE_CREDENTIAL_KEY = String.raw`[a-z][a-z0-9_.-]*(?:[ \t]+(?:keys?|tokens?|secrets?|passwords?|passwd|passphrase|credentials?|authorization|authentication|auth|cookies?|session(?:[ \t]+(?:id|token))?|ids?|signatures?|sigs?|jwts?|otps?|pins?|pws?|pwd))?`;
const NATURAL_LANGUAGE_CREDENTIAL_COPULA = new RegExp(
  String.raw`((?:^|[\r\n;])[ \t]*(?:(?:my|our|your|the)[ \t]+)?)(${NATURAL_LANGUAGE_CREDENTIAL_KEY})([ \t]+(?:is|equals|was)[ \t]+)([^;\r\n]+)`,
  "gim",
);
const NATURAL_LANGUAGE_CREDENTIAL_VALUE = new RegExp(
  String.raw`((?:^|[\r\n;])[ \t]*(?:(?:my|our|your|the)[ \t]+)?)(${NATURAL_LANGUAGE_CREDENTIAL_KEY})([ \t]+)(?![:=])([^;\r\n]+)`,
  "gim",
);
const NATURAL_LANGUAGE_CREDENTIAL_VALUE_CUE =
  /^(value\s+(?:is|equals|was)|(?:should|must)\s+be)([ \t]+)([^;\r\n]+)$/i;
const NATURAL_LANGUAGE_ALREADY_REDACTED_CUE =
  /^(?:is|equals|was)\s+\[REDACTED\]$/i;
const NATURAL_LANGUAGE_CREDENTIAL_USES_CUE =
  /^(uses?)([ \t]+)(\S+)([ \t]+.+)?$/i;
const NATURAL_LANGUAGE_CREDENTIAL_DESCRIPTION =
  /^(?:for|of|in|on|to|with)\s+\S+(?:[ \t]+\S+){1,}\s+(?:(?:is|are|was|were)\s+(?:broken|missing|unavailable|invalid|slow|deprecated|misconfigured|delayed|failing|unsupported|working|incorrect|blocked)|(?:should|could|can|will|would|must)\s+be\s+(?:rotated|updated|stored|renewed|changed|reset|refreshed|validated|scoped|configured|removed|kept|set|shared|sent|used|protected|encrypted))\b/i;
const NATURAL_LANGUAGE_TOKEN_DESCRIPTION =
  /^(?:refresh|rotation|validation|renewal|expiration|management|handling)\s+logic\s+(?:is|are|was|were)\s+(?:broken|slow|missing|unavailable|invalid|misconfigured|delayed|failing|unsupported|deprecated|working|incorrect|blocked)\b/i;
const NATURAL_LANGUAGE_SECRET_USAGE =
  /^(?:can|could|should|will|would|may|might|must)\s+be\s+(?:used later|applied later|stored safely|rotated regularly|reset later|shared later|updated later|renewed later)\b/i;
const NATURAL_LANGUAGE_PASS_INSTRUCTION =
  /^(?:rate\s+(?:is|equals|was)\s+\d+(?:\.\d+)?\s+(?:percent|%)\b|the\s+(?:test|suite|project|command|task|build)(?:\s+\w+){0,3}\s+(?:before|after|until|when|while)\b)/i;
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
        "session",
        "sessionid",
        "sessionids",
        "sessiontoken",
        "sessiontokens",
        "jwt",
        "otp",
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
  return /(?:pass|passwords?|passwd|passphrase|pin|pw|pwd|secrets?|tokens?|credentials?|authorization|authentication|auth|cookies?|session(?:ids?|tokens?)?|sigs?|signatures?|(?:api|access|private|secret|signing)key)$/.test(
    compact,
  );
}

function hasSpaceSeparatedCredential(text: string): boolean {
  for (const match of text.matchAll(QUOTED_ARRAY_CREDENTIAL_FLAG)) {
    if (isCredentialKey(match[2] ?? "")) return true;
  }
  for (const pattern of SPACE_SEPARATED_CREDENTIAL_FORMS) {
    for (const match of text.matchAll(pattern)) {
      if (isCredentialKey(match[1] ?? "")) return true;
    }
  }
  return false;
}

function urlParameterContext(
  text: string,
  valueStart: number,
): { url: URL; inFragment: boolean } | null {
  const prefix = text.slice(0, valueStart);
  const urlStart = Math.max(
    prefix.lastIndexOf("https://"),
    prefix.lastIndexOf("http://"),
  );
  if (urlStart === -1) {
    return null;
  }
  const urlEndMatch = /\s/.exec(text.slice(urlStart));
  const urlEnd = urlEndMatch ? urlStart + urlEndMatch.index : text.length;
  if (valueStart >= urlEnd) return null;
  const rawUrl = text.slice(urlStart, urlEnd);
  if (!URL.canParse(rawUrl)) return null;
  const url = new URL(rawUrl);

  const queryStart = rawUrl.indexOf("?");
  const fragmentStart = rawUrl.indexOf("#");
  const inQuery =
    queryStart !== -1 &&
    valueStart - urlStart > queryStart &&
    (fragmentStart === -1 || valueStart - urlStart < fragmentStart);
  const inFragment =
    fragmentStart !== -1 && valueStart - urlStart > fragmentStart;
  if (!inQuery && !inFragment) return null;

  return { url, inFragment };
}

function urlParameterNames(context: {
  url: URL;
  inFragment: boolean;
}): Set<string> {
  const parameters = context.inFragment
    ? new URLSearchParams(context.url.hash.slice(1))
    : context.url.searchParams;
  return new Set([...parameters.keys()].map((name) => name.toLowerCase()));
}

function urlParameterValueEnd(
  text: string,
  valueStart: number,
  key: string,
): number | null {
  const context = urlParameterContext(text, valueStart);
  if (!context || !urlParameterNames(context).has(key.toLowerCase())) {
    return null;
  }
  const delimiter = /[&#\s]/.exec(text.slice(valueStart));
  return delimiter ? valueStart + delimiter.index : text.length;
}

function isOAuthCallbackParameter(
  text: string,
  valueStart: number,
  key: string,
): boolean {
  const context = urlParameterContext(text, valueStart);
  if (!context) return false;
  const parameterNames = urlParameterNames(context);
  if (!parameterNames.has(key.toLowerCase())) return false;

  const callbackPath =
    /\/(?:oauth2?|auth(?:entication)?|callback|redirect)(?:\/|$)/i.test(
      context.url.pathname,
    );
  const rootCallback =
    context.url.pathname === "/" &&
    parameterNames.has("code") &&
    parameterNames.has("state");
  return callbackPath || rootCallback;
}

function redactNaturalLanguageCredentials(text: string): string {
  const withCopulaValues = text.replace(
    NATURAL_LANGUAGE_CREDENTIAL_COPULA,
    (match, prefix, key, cue) =>
      isCredentialKey(key) ? `${prefix}${key}${cue}[REDACTED]` : match,
  );
  return withCopulaValues.replace(
    NATURAL_LANGUAGE_CREDENTIAL_VALUE,
    (match, prefix, key, separator, value) => {
      if (!isCredentialKey(key)) return match;
      const loweredKey = key.toLowerCase();
      const trimmedValue = value.trimStart();
      if (NATURAL_LANGUAGE_ALREADY_REDACTED_CUE.test(trimmedValue)) {
        return match;
      }
      if (
        (loweredKey === "pass" &&
          NATURAL_LANGUAGE_PASS_INSTRUCTION.test(trimmedValue)) ||
        (loweredKey === "token" &&
          NATURAL_LANGUAGE_TOKEN_DESCRIPTION.test(trimmedValue)) ||
        NATURAL_LANGUAGE_CREDENTIAL_DESCRIPTION.test(trimmedValue) ||
        NATURAL_LANGUAGE_SECRET_USAGE.test(trimmedValue)
      ) {
        return match;
      }
      const valueCue = NATURAL_LANGUAGE_CREDENTIAL_VALUE_CUE.exec(trimmedValue);
      if (valueCue) {
        return `${prefix}${key}${separator}${valueCue[1]}${valueCue[2]}[REDACTED]`;
      }
      const usesCue = NATURAL_LANGUAGE_CREDENTIAL_USES_CUE.exec(trimmedValue);
      if (usesCue) {
        const suffix = usesCue[4];
        return `${prefix}${key}${separator}${usesCue[1]}${usesCue[2]}[REDACTED]${suffix === undefined ? "" : suffix}`;
      }
      return `${prefix}${key}${separator}[REDACTED]`;
    },
  );
}

function redactCredentialAssignments(text: string): string {
  const assignments: Array<{
    redactStart: number;
    redactEnd: number;
    valueEnd: number;
  }> = [];
  let coveredValueEnd = -1;
  for (const match of text.matchAll(ASSIGNMENT_KEY)) {
    const valueStart = (match.index ?? 0) + match[0].length;
    const key = match[2] ?? "";
    const credentialKey = isCredentialKey(key);
    const oauthCandidate = ["code", "state", "nonce"].includes(
      key.toLowerCase(),
    );
    // Keep ordinary assignments off the full-text URL parsing path.
    if (!credentialKey && !oauthCandidate) continue;
    const oauthCallbackParameter =
      oauthCandidate && isOAuthCallbackParameter(text, valueStart, key);
    if (!credentialKey && !oauthCallbackParameter) continue;
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

    const parameterValueEnd = urlParameterValueEnd(text, valueStart, key);
    if (parameterValueEnd !== null) {
      assignments.push({
        redactStart: valueStart,
        redactEnd: parameterValueEnd,
        valueEnd: parameterValueEnd,
      });
      coveredValueEnd = parameterValueEnd;
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
  const naturalLanguageRedacted = redactNaturalLanguageCredentials(text);
  if (hasSpaceSeparatedCredential(naturalLanguageRedacted)) {
    return "[REDACTED]";
  }

  return redactCredentialAssignments(
    naturalLanguageRedacted
      .replace(SLACK_INCOMING_WEBHOOK_URL, "[REDACTED]")
      .replace(DISCORD_INCOMING_WEBHOOK_URL, "[REDACTED]")
      .replace(URL_USERINFO, (_match, scheme) => `${scheme}[REDACTED]@`),
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
    .replace(JWT_VALUE, "[REDACTED]")
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
