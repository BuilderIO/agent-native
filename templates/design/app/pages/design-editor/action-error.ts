/**
 * The action HTTP surface echoes a real message only for explicit client
 * errors; an unclassified failure comes back as a 5xx "Internal server error"
 * with the cause server-log-only. Show the former as toast detail and drop the
 * latter, so a toast never reads as if it explained something when it didn't.
 */

/** `callAction` prefixes every rejection with `Action <name> failed: `. */
const CALL_ACTION_PREFIX = /^Action [\w.-]+ failed:\s*/;

export function actionErrorDetail(error: unknown): string | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== "number" || status < 400 || status >= 500) {
    return undefined;
  }
  const message = error instanceof Error ? error.message : "";
  const detail = message.replace(CALL_ACTION_PREFIX, "").trim();
  return detail || undefined;
}
