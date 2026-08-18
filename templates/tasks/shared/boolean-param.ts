/**
 * Coerce booleans from HTTP query strings, CLI flags, or JSON bodies.
 * Returns undefined when the value is absent.
 */
export function coerceBooleanParam(
  value: string | boolean | null | undefined,
): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return undefined;
}

/** URL/query flag written when Show all is enabled. */
export const INCLUDE_DONE_QUERY_VALUE = "true";

/** Parse includeDone from URL search params; defaults to false when absent. */
export function parseIncludeDoneParam(
  value: string | null | undefined,
): boolean {
  return coerceBooleanParam(value) ?? false;
}
