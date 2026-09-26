const STORAGE_KEY = "clips:debug-diagnostics-viewed.v1";
const MAX_ENTRIES = 50;

export function countSurfacedDebugEvents(
  summary: { consoleErrorCount: number; networkFailureCount: number } | null,
): number {
  if (!summary) return 0;
  return summary.consoleErrorCount + summary.networkFailureCount;
}

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

export function getViewedDebugEventCount(recordingId: string): number {
  return readAll()[recordingId]?.count ?? 0;
}

export function markDebugEventsViewed(
  recordingId: string,
  count: number,
): void {
  const entries = readAll();
  const nextSeq =
    Math.max(0, ...Object.values(entries).map((entry) => entry.seq)) + 1;
  entries[recordingId] = { count, seq: nextSeq };
  const newest = Object.entries(entries)
    .sort(([, left], [, right]) => right.seq - left.seq)
    .slice(0, MAX_ENTRIES);
  writeAll(Object.fromEntries(newest));
}
