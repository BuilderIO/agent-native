export const T3_CODE_SUBMISSION_SOURCE = "t3-code";

/** The attribution source a comment write records for the caller making it. */
export function commentSubmissionSource(
  caller: string | undefined,
): string | null {
  return caller === "mcp" || caller === "webmcp"
    ? "mcp"
    : caller === "tool"
      ? "agent"
      : (caller ?? null);
}
