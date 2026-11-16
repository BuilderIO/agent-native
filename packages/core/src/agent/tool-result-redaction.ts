import {
  redactSensitiveFields,
  sanitizeToolErrorText,
} from "./tool-error-redaction.js";

/**
 * A successful tool result as it is streamed, saved to a thread, and shown to
 * anyone the thread is shared with. The live turn keeps the raw result.
 *
 * A JSON result stays JSON: the text patterns replace a quoted value with a
 * bare placeholder, which would leave a result that widgets and automation
 * evidence readers parse unreadable. A result with nothing to redact comes
 * back byte for byte, so numbers and spacing survive the round trip.
 */
export function redactToolResultForHistory(result: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return sanitizeToolErrorText(result);
  }
  if (parsed === null || typeof parsed !== "object") {
    return sanitizeToolErrorText(result);
  }
  const redacted = JSON.stringify(
    redactSensitiveFields(parsed),
    (_key, value) =>
      typeof value === "string" ? sanitizeToolErrorText(value) : value,
  );
  return redacted === JSON.stringify(parsed) ? result : redacted;
}
