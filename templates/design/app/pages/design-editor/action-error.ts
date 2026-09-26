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
