/** A text longer than this is a body, not an identifier, and is not kept. */
const MAX_IDENTIFIER_CHARS = 256;

/**
 * The names a response puts the things it identifies under. A receipt keeps
 * nothing else of a response, so no message text, title, name, email or body
 * lands in SQL through one: only what a later run needs to find the thing
 * again or to point at it. `threadTs` is there for the reply Wait, which
 * watches the thread a post went into.
 */
const IDENTIFYING_KEYS: ReadonlySet<string> = new Set([
  "id",
  "ids",
  "ts",
  "thread_ts",
  "threadTs",
  "channel",
  "number",
  "sha",
  "ref",
  "url",
  "permalink",
  "html_url",
  "key",
  "status",
  "ok",
]);
const IDENTIFYING_SUFFIXES = ["_id", "Id", "_ts", "_url", "_number"] as const;

export function identifiesAThing(key: string): boolean {
  return (
    IDENTIFYING_KEYS.has(key) ||
    IDENTIFYING_SUFFIXES.some((suffix) => key.endsWith(suffix))
  );
}

/** A value that can stand as an identifier: short text, a finite number, true or false. */
export function isIdentifierValue(
  value: unknown,
): value is string | number | boolean | null {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.length <= MAX_IDENTIFIER_CHARS;
}

/** What is wrong with a receipt's response, or null when it holds only identifiers. */
export function receiptOutputProblem(
  output: Readonly<Record<string, unknown>>,
): string | null {
  for (const [key, value] of Object.entries(output)) {
    if (!identifiesAThing(key)) {
      return `"${key}" is not a field that names a thing, so a receipt does not keep it`;
    }
    const fits =
      isIdentifierValue(value) ||
      (Array.isArray(value) && value.every(isIdentifierValue));
    if (!fits) {
      return `"${key}" is not a short text, a number, true or false, or a list of them`;
    }
  }
  return null;
}
