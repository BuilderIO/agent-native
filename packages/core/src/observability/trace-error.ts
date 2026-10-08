const MAX_TOOL_ERROR_MESSAGE_LENGTH = 500;

const STANDALONE_API_KEY_PATTERN =
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b/g;
const INCOMPLETE_STANDALONE_API_KEY_PATTERN =
  /\b(?:(?:AKIA|ASIA)[A-Z0-9]{0,15}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{0,7}|(?:sk|rk)_[A-Za-z0-9_]{0,12}|AIza[A-Za-z0-9_-]{0,15}|gh[pousr]_[A-Za-z0-9]{0,15})$/g;
const PROVIDER_TOKEN_PATTERN =
  /\b(?:xox[a-z]{1,2}[-.][A-Za-z0-9_-]+|xapp-[A-Za-z0-9_-]+|SG\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|pat-[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_]+|npm_[A-Za-z0-9_-]+)\b/gi;
const INCOMPLETE_PROVIDER_TOKEN_PATTERN =
  /\b(?:xox[a-z]{1,2}(?:[-.]|$)|xapp-|SG\.|pat-|github_pat_|npm_)[A-Za-z0-9_.-]*$/gi;
const STANDALONE_JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const INCOMPLETE_STANDALONE_JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2}$/g;

const CONNECTION_FIELD =
  "(?:database[_ -]?(?:url|uri|dsn)|db[_ -]?(?:url|uri|dsn)|connection[_ -]?(?:string|url|uri)|dsn|(?:postgres(?:ql)?|mysql|mariadb|mongodb|mongo|redis|rediss|amqp|mssql|cockroachdb)[_ -]?(?:url|uri|dsn|connection[_ -]?string))";
const COMPOUND_CREDENTIAL_FIELD = `(?:api[_ -]?key|access[_ -]?(?:token|key(?:[_ -]?id)?)|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|secret[_ -]?key|signing[_ -]?key|encryption[_ -]?key|${CONNECTION_FIELD})`;
const CREDENTIAL_FIELD = `(?:(?:(?:[a-z0-9]+)[_ -]+)*(?:authorization|cookie|jwt|api[_ -]?key|access[_ -]?(?:token|key(?:[_ -]?id)?)|password|secret|token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|secret[_ -]?key|signing[_ -]?key|encryption[_ -]?key|${CONNECTION_FIELD})|[a-z0-9]+${COMPOUND_CREDENTIAL_FIELD}|[a-z0-9]+(?:jwt|secret|password|token))`;
const LABELED_CREDENTIAL =
  "([\"']?\\b" + CREDENTIAL_FIELD + "\\b[\"']?\\s*[:=]\\s*[\"']?)";
const QUOTED_CREDENTIAL_PATTERN = new RegExp(
  `([\"']?\\b${CREDENTIAL_FIELD}\\b[\"']?\\s*[:=]\\s*)([\"'])(?:\\\\.|(?!\\2)[\\s\\S])*?(?:\\2|$)`,
  "gi",
);
const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi;
const URI_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)([^/?#\s]*@)/gi;
const TRUNCATED_URI_AUTHORITY_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^/?#\s]+)$/gi;
// A numeric tail can be a host port, so only treat a nonnumeric suffix as userinfo.
const INCOMPLETE_URI_USERINFO_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^/:?#\s]+):((?!\d+$)[^/?#@\s]+)$/gi;
const CREDENTIAL_HEADER_PATTERN =
  /(["']?\b(?:authorization|cookie)\b["']?\s*[:=]\s*)(?:(\[(?:\\.|[^\]])*\])|(["'])(?:\\.|(?!\3)[\s\S])*?\3|[^\r\n"'{}\]]+)/gim;
const SIGNED_URL_QUERY_CREDENTIAL_PATTERN =
  /([?&](?:sig|signature|x-amz-signature|x-goog-signature)=)([^&#\s"'<>]*?)([.,;!?)}\]]?)(?=[&#\s"'<>]|$)/gi;

/** Rows written 2026-09-25 onward by captureToolResults-on apps. Read as "full". */
export const TOOL_ERROR_CAPTURE_METADATA_KEY = "__tool_error_capture_version";

/**
 * Stamped on every failed tool span: what `error_message` holds. `signature` is
 * a deliberate withholding (captureToolResults is off), never the same as a row
 * with no text.
 */
export const TOOL_ERROR_DETAIL_METADATA_KEY = "__tool_error_detail";

export function redactToolErrorMessage(
  value: string,
  options: { truncated?: boolean } = {},
): string {
  const redacted = value
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
    .replace(SIGNED_URL_QUERY_CREDENTIAL_PATTERN, "$1[REDACTED]$3")
    .replace(URI_USERINFO_PATTERN, "$1[REDACTED]@")
    .replace(INCOMPLETE_URI_USERINFO_PATTERN, "$1[REDACTED]")
    .replace(INCOMPLETE_STANDALONE_API_KEY_PATTERN, "[REDACTED]")
    .replace(STANDALONE_API_KEY_PATTERN, "[REDACTED]")
    .replace(PROVIDER_TOKEN_PATTERN, "[REDACTED]")
    .replace(INCOMPLETE_PROVIDER_TOKEN_PATTERN, "[REDACTED]")
    .replace(STANDALONE_JWT_PATTERN, "[REDACTED]")
    .replace(INCOMPLETE_STANDALONE_JWT_PATTERN, "[REDACTED]");
  if (!options.truncated) return redacted;
  return redacted.replace(TRUNCATED_URI_AUTHORITY_PATTERN, "$1[REDACTED]");
}

function boundToolErrorMessage(redacted: string): string {
  return redacted.length > MAX_TOOL_ERROR_MESSAGE_LENGTH
    ? redacted.slice(0, MAX_TOOL_ERROR_MESSAGE_LENGTH) + "…"
    : redacted;
}

export function sanitizeToolErrorMessage(value: string): string {
  return boundToolErrorMessage(redactToolErrorMessage(value));
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// 16+ characters of an id alphabet with a digit in them: Google file ids, Gmail
// message ids, ObjectIds, session ids. Plain identifiers have no digit.
const OPAQUE_ID_PATTERN = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}\b/g;
const TOOL_ERROR_PREFIX_PATTERN = /^Error running [^\s:]+:\s*/;

/**
 * The part of a tool failure that is always recorded, even with
 * captureToolResults off: the first non-blank line, bounded. It is stored
 * without the owner opting in, so beyond credentials (a quoted secret can span
 * lines, so redact the whole text first) it also drops the emails and opaque
 * ids a failing tool echoes back. The `Error running <tool>: ` prefix is
 * dropped so signatures group by cause, and a JSON `{ error, message }` result
 * is summarized as `error: message` rather than its opening brace. Never
 * empty — an empty `error_message` reads as "no reason was captured", which is
 * a different fact from "the tool gave no text".
 */
export function toolErrorSignature(value: unknown): string {
  const text = (typeof value === "string" ? value : "")
    .trim()
    .replace(TOOL_ERROR_PREFIX_PATTERN, "");
  const redacted = redactToolErrorMessage(jsonErrorSummary(text) ?? text)
    .replace(EMAIL_PATTERN, "[email]")
    .replace(OPAQUE_ID_PATTERN, "[id]");
  const firstLine = redacted.split(/\r?\n/).find((line) => line.trim());
  return boundToolErrorMessage(
    firstLine?.trim() || "Tool failed with no error text",
  );
}

/** `error: message` for a JSON `{ error, message }` result; `undefined` when the text is not one. */
function jsonErrorSummary(text: string): string | undefined {
  if (!text.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    // coercion-ok: unparseable text is not a JSON error result; the caller still records its first line
  } catch {
    return undefined;
  }
  const { error, message } = (parsed ?? {}) as Record<string, unknown>;
  if (typeof error !== "string" || !error.trim()) return undefined;
  return typeof message === "string" && message.trim()
    ? `${error}: ${message}`
    : error;
}
