import { redactSecretsInText } from "../shared/secret-redaction.js";

const MAX_TOOL_ERROR_MESSAGE_LENGTH = 500;

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
  return redactSecretsInText(value, {
    placeholder: "[REDACTED]",
    tail: options.truncated ? "truncated" : true,
  });
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
