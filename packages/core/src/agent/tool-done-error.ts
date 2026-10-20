/**
 * Whether a `tool_done` event failed.
 *
 * Trace instrumentation and trace-to-eval promotion must share this rule.
 * Legacy events omit `isError` and encode failure by prefixing `result` with
 * `"Error"` or `"Error running "`. A boolean `isError` always wins, including
 * `false`, so a successful result that happens to start with those letters is
 * not inferred as a failure when the producer set the flag.
 */
export function isToolDoneFailure(event: {
  isError?: unknown;
  result?: unknown;
}): boolean {
  if (typeof event.isError === "boolean") return event.isError;
  return (
    typeof event.result === "string" &&
    (event.result.startsWith("Error") ||
      event.result.startsWith("Error running "))
  );
}
