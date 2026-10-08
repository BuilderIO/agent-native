export function clampCompletionPct(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function isCountedViewerRow(row: { countedView?: unknown }): boolean {
  return Boolean(row.countedView);
}

export const ANONYMOUS_VIEWER_NAME_PREFIX = "anon:";

export function displayViewerName(
  viewerName: string | null | undefined,
): string | null {
  if (viewerName == null) return null;
  return viewerName.startsWith(ANONYMOUS_VIEWER_NAME_PREFIX)
    ? null
    : viewerName;
}
