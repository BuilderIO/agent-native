import { EMBED_TOKEN_QUERY_PARAM } from "@agent-native/core/shared";

export const DASHBOARD_REPORT_BOOTSTRAP_TIMEOUT_MS = 12_000;
export const DASHBOARD_REPORT_BOOTSTRAP_RETRY_DELAY_MS = 500;
export const DASHBOARD_REPORT_CAPTURE_ERROR_LIMIT = 240;

export type DashboardReportCapturePhase =
  | "loading"
  | "error"
  | "missing"
  | "ready";

export function isDashboardReportScreenshot(search: string): boolean {
  return new URLSearchParams(search).get("reportScreenshot") === "1";
}

/**
 * The server verifies this scoped token on every action. This only prevents
 * the client session gate from redirecting an otherwise authorized capture.
 */
export function hasDashboardReportEmbedToken(
  search: string,
  storedEmbedToken?: string | null,
): boolean {
  if (!isDashboardReportScreenshot(search)) return false;
  return Boolean(
    new URLSearchParams(search).get(EMBED_TOKEN_QUERY_PARAM)?.trim() ||
    storedEmbedToken?.trim(),
  );
}

export function dashboardReportCaptureError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(
      new RegExp(`(${EMBED_TOKEN_QUERY_PARAM}=)[^&\\s]+`, "g"),
      "$1[REDACTED]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DASHBOARD_REPORT_CAPTURE_ERROR_LIMIT);
}
