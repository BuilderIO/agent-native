import { useEffect, useState } from "react";

import {
  countSurfacedDebugEvents,
  countUnviewedDebugEvents,
  getViewedDebugEventCount,
  markDebugEventsViewed,
} from "@/lib/debug-diagnostics-viewed";

/**
 * Number to badge on the Debug tab: errors + failed requests captured since
 * the tab was last actively viewed for this recording. Set `isDebugTabActive`
 * true only while the Debug tab is the one currently open — opening it marks
 * every currently-known event as viewed, so the badge clears; new events
 * arriving on another tab bump the count back up.
 */
export function useUnviewedDebugEventCount(
  recordingId: string | undefined,
  summary: { consoleErrorCount: number; networkFailureCount: number } | null,
  isDebugTabActive: boolean,
): number {
  const debugEventCount = countSurfacedDebugEvents(summary);
  const [viewedCount, setViewedCount] = useState(() =>
    recordingId ? getViewedDebugEventCount(recordingId) : 0,
  );

  useEffect(() => {
    setViewedCount(recordingId ? getViewedDebugEventCount(recordingId) : 0);
  }, [recordingId]);

  useEffect(() => {
    if (!isDebugTabActive || !recordingId || debugEventCount === 0) return;
    markDebugEventsViewed(recordingId, debugEventCount);
    setViewedCount(debugEventCount);
  }, [isDebugTabActive, recordingId, debugEventCount]);

  return countUnviewedDebugEvents(debugEventCount, viewedCount);
}
