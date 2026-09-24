/**
 * Tracks how many "worth surfacing" debug events (console errors + failed
 * network requests) the viewer has already seen for a recording, so the
 * Debug tab badge shows only the count of *new* events since the tab was
 * last opened, not "any failure ever recorded" (the old always-on red dot).
 *
 * Keyed by recordingId and capped to the most recently viewed 50 recordings
 * so the value never grows unbounded across a long-lived browser profile.
 */
const STORAGE_KEY = "clips:debug-diagnostics-viewed.v1";
const MAX_ENTRIES = 50;

/**
 * Console warnings alone are too noisy to page (nearly every recording has
 * some); only errors and failed network requests count toward the Debug
 * tab's unviewed badge.
 */
export function countSurfacedDebugEvents(
  summary: { consoleErrorCount: number; networkFailureCount: number } | null,
): number {
  if (!summary) return 0;
  return summary.consoleErrorCount + summary.networkFailureCount;
}

/** Unviewed count to badge on the Debug tab; never negative. */
export function countUnviewedDebugEvents(
  totalCount: number,
  viewedCount: number,
): number {
  return Math.max(0, totalCount - viewedCount);
}

interface ViewedEntry {
  count: number;
  seq: number;
}

function readAll(): Record<string, ViewedEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const entries: Record<string, ViewedEntry> = {};
    for (const [recordingId, value] of Object.entries(parsed)) {
      if (
        value &&
        typeof value === "object" &&
        typeof (value as ViewedEntry).count === "number" &&
        typeof (value as ViewedEntry).seq === "number"
      ) {
        entries[recordingId] = value as ViewedEntry;
      }
    }
    return entries;
  } catch {
    // coercion-ok: corrupted/unavailable storage only means the viewer sees
    // an already-seen badge count again; it must never block the Debug tab.
    return {};
  }
}

function writeAll(entries: Record<string, ViewedEntry>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // coercion-ok: losing this preference only brings back an already-seen
    // badge count; never block viewing the Debug tab on a storage write failure.
  }
}

/** Debug events already viewed for `recordingId`, or 0 if never viewed. */
export function getViewedDebugEventCount(recordingId: string): number {
  return readAll()[recordingId]?.count ?? 0;
}

/** Records that the viewer has now seen up through `count` debug events. */
export function markDebugEventsViewed(
  recordingId: string,
  count: number,
): void {
  const entries = readAll();
  // A monotonic sequence (rather than a wall-clock timestamp) decides which
  // entries survive eviction, so rapid successive calls in the same
  // millisecond still evict the oldest recording, not an arbitrary one.
  const nextSeq =
    Math.max(0, ...Object.values(entries).map((entry) => entry.seq)) + 1;
  entries[recordingId] = { count, seq: nextSeq };
  const newest = Object.entries(entries)
    .sort(([, left], [, right]) => right.seq - left.seq)
    .slice(0, MAX_ENTRIES);
  writeAll(Object.fromEntries(newest));
}
