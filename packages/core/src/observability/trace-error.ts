const MAX_TOOL_ERROR_MESSAGE_LENGTH = 500;

const STANDALONE_API_KEY_PATTERN =
  /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b/g;
const CREDENTIAL_FIELD =
  "(?:(?:[a-z0-9]+)[_ -]+)*(?:authorization|cookie|api[_ -]?key|password|secret|token|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key)";
const LABELED_CREDENTIAL =
  "([\"']?\\b" + CREDENTIAL_FIELD + "\\b[\"']?\\s*[:=]\\s*[\"']?)";

export const TOOL_ERROR_CAPTURE_METADATA_KEY = "__tool_error_capture_version";

export function redactToolErrorMessage(value: string): string {
  return value
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
