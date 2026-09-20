export function clampCompletionPct(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * In-memory twin of `countedViewCondition` / `countRecordingViews` in
 * `server/lib/recordings.ts`: a view is one `recording_viewers` row whose
 * `countedView` flag is set. Use it whenever the rows are already loaded so
 * every surface reports the same number.
 */
export function isCountedViewerRow(row: { countedView?: unknown }): boolean {
  return Boolean(row.countedView);
}

export const ANONYMOUS_VIEWER_NAME_PREFIX = "anon:";

/**
 * Anonymous rows keep their `anon:<sessionId>` dedup key in `viewer_name`.
 * That key is storage plumbing, never a display name — return null so callers
 * render their own "Someone" placeholder instead of leaking the session key.
 */
export function displayViewerName(
  viewerName: string | null | undefined,
): string | null {
  if (viewerName == null) return null;
  return viewerName.startsWith(ANONYMOUS_VIEWER_NAME_PREFIX)
    ? null
    : viewerName;
}
