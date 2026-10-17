export function coerceBooleanParam(
  value: string | boolean | null | undefined,
): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return undefined;
}

export const INCLUDE_DONE_QUERY_VALUE = "true";

export function parseIncludeDoneParam(
  value: string | null | undefined,
): boolean {
  return coerceBooleanParam(value) ?? false;
}
