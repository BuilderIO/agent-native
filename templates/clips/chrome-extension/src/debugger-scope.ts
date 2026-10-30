import { BROWSER_DIAGNOSTIC_LOOKBACK_MS } from "@shared/browser-diagnostics";

// Which tabs the diagnostics debugger covers, and how far back it reaches.
// These are product promises, so they live apart from the chrome.* calls in
// background.ts and are unit-tested here.

export const MAX_DEBUGGED_TABS = 5;
export const RECENT_TAB_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_ACTIVATIONS = 50;

export type TabActivation = {
  tabId: number;
  lastActiveMs: number;
  windowId?: number;
};

// The recording's own tab first, then tabs in the same window active within
// the recent window, most recent first, capped at MAX_DEBUGGED_TABS. Chrome
// shows its "started debugging this browser" bar in every window with an
// attached tab, so tabs in other windows are never attached.
export function pickDebugTabIds(input: {
  targetTabId: number;
  targetWindowId: number | undefined;
  activations: readonly TabActivation[];
  nowMs: number;
}): number[] {
  const recent = input.activations
    .filter(
      (tab) =>
        tab.tabId !== input.targetTabId &&
        input.targetWindowId !== undefined &&
        tab.windowId === input.targetWindowId &&
        input.nowMs - tab.lastActiveMs <= RECENT_TAB_WINDOW_MS,
    )
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs)
    .map((tab) => tab.tabId);
  return [input.targetTabId, ...recent].slice(0, MAX_DEBUGGED_TABS);
}

export function recordTabActivation(
  activations: readonly TabActivation[],
  tabId: number,
  nowMs: number,
  windowId?: number,
): TabActivation[] {
  return [
    { tabId, lastActiveMs: nowMs, windowId },
    ...activations.filter(
      (tab) =>
        tab.tabId !== tabId && nowMs - tab.lastActiveMs <= RECENT_TAB_WINDOW_MS,
    ),
  ]
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs)
    .slice(0, MAX_TRACKED_ACTIVATIONS);
}

export function removeTabActivation(
  activations: readonly TabActivation[],
  tabId: number,
): TabActivation[] {
  return activations.filter((tab) => tab.tabId !== tabId);
}

// The attached tab to detach to make room: least recently active, never keepTabId.
export function chooseTabToDetach(input: {
  attached: readonly TabActivation[];
  keepTabId: number;
}): number | null {
  let victim: TabActivation | null = null;
  for (const tab of input.attached) {
    if (tab.tabId === input.keepTabId) continue;
    if (!victim || tab.lastActiveMs < victim.lastActiveMs) victim = tab;
  }
  return victim ? victim.tabId : null;
}

// Negative offset for an entry from before the recording started, or null if
// it is at or after the start, or further back than the lookback window.
export function lookbackElapsedMs(
  timestampMs: number,
  recordingStartMs: number,
): number | null {
  const elapsedMs = timestampMs - recordingStartMs;
  if (elapsedMs >= 0 || elapsedMs < -BROWSER_DIAGNOSTIC_LOOKBACK_MS) {
    return null;
  }
  return Math.round(elapsedMs);
}

export type ResourceTimingSnapshot = {
  name: string;
  initiatorType: string;
  startTime: number;
  duration: number;
  responseStatus?: number;
};

// Resource timing has no method, headers, or bodies, so callers record the
// method for these entries as UNKNOWN.
export function fetchXhrFromResourceTiming(
  entries: readonly ResourceTimingSnapshot[],
  timeOriginMs: number,
): Array<{
  timestampMs: number;
  durationMs: number;
  type: "fetch" | "xhr";
  url: string;
  status?: number;
}> {
  return entries.flatMap((entry) => {
    const type =
      entry.initiatorType === "fetch"
        ? "fetch"
        : entry.initiatorType === "xmlhttprequest"
          ? "xhr"
          : null;
    const timestampMs = timeOriginMs + entry.startTime;
    if (
      !type ||
      !Number.isFinite(timestampMs) ||
      !Number.isFinite(entry.duration)
    ) {
      return [];
    }
    return [
      {
        timestampMs: Math.round(timestampMs),
        durationMs: Math.round(entry.duration),
        type,
        url: entry.name,
        ...(entry.responseStatus ? { status: entry.responseStatus } : {}),
      },
    ];
  });
}
