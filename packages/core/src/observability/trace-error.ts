const MAX_TOOL_ERROR_MESSAGE_LENGTH = 500;

const STANDALONE_API_KEY_PATTERN =
  /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b/g;
const COMPOUND_CREDENTIAL_FIELD =
  "(?:api[_ -]?key|access[_ -]?(?:token|key(?:[_ -]?id)?)|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key)";
const CREDENTIAL_FIELD = `(?:(?:(?:[a-z0-9]+)[_ -]+)*(?:authorization|cookie|jwt|api[_ -]?key|access[_ -]?(?:token|key(?:[_ -]?id)?)|password|secret|token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key)|[a-z0-9]+${COMPOUND_CREDENTIAL_FIELD}|[a-z0-9]+(?:jwt|secret|password|token))`;
const LABELED_CREDENTIAL =
  "([\"']?\\b" + CREDENTIAL_FIELD + "\\b[\"']?\\s*[:=]\\s*[\"']?)";
const QUOTED_CREDENTIAL_PATTERN = new RegExp(
  `([\"']?\\b${CREDENTIAL_FIELD}\\b[\"']?\\s*[:=]\\s*)([\"'])(?:\\\\.|(?!\\2)[\\s\\S])*?\\2`,
  "gi",
);
const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi;
const CREDENTIAL_HEADER_PATTERN =
  /(["']?\b(?:authorization|cookie)\b["']?\s*[:=]\s*)(?:(\[(?:\\.|[^\]])*\])|(["'])(?:\\.|(?!\3)[\s\S])*?\3|[^\r\n"'{}\]]+)/gim;

export const TOOL_ERROR_CAPTURE_METADATA_KEY = "__tool_error_capture_version";

export function redactToolErrorMessage(value: string): string {
  return value
    .replace(PRIVATE_KEY_BLOCK_PATTERN, "[REDACTED]")
    .replace(QUOTED_CREDENTIAL_PATTERN, "$1$2[REDACTED]$2")
    .replace(
      CREDENTIAL_HEADER_PATTERN,
      (_match, prefix: string, bracketed: string | undefined, quote?: string) =>
        `${prefix}${bracketed ? '["[REDACTED]"]' : `${quote ?? ""}[REDACTED]${quote ?? ""}`}`,
    )
    .replace(
      new RegExp(
        LABELED_CREDENTIAL + "(?:Bearer|Basic)\\s+[^\"'\\s,;)}\\]]+",
        "gi",
      ),
      "$1[REDACTED]",
    )
    .replace(
      new RegExp(LABELED_CREDENTIAL + "[^\"'\\s,;)}\\[\\]]+", "gi"),
      "$1[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(STANDALONE_API_KEY_PATTERN, "[REDACTED]");
}

export function sanitizeToolErrorMessage(value: string): string {
  const redacted = redactToolErrorMessage(value);
  return redacted.length > MAX_TOOL_ERROR_MESSAGE_LENGTH
    ? redacted.slice(0, MAX_TOOL_ERROR_MESSAGE_LENGTH) + "…"
    : redacted;
}
