/** Pure replay normalization and timeline helpers shared by the UI and CLI. */

export type AnyReplayEvent = Record<string, any>;

export type ReplayViewportDimensions = {
  width: number;
  height: number;
};

export type ReplayViewportChange = ReplayViewportDimensions & {
  offsetMs: number;
};

export const RRWEB_EVENT_TYPE = {
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
} as const;

export const INCREMENTAL_SOURCE = {
  Mutation: 0,
  MouseMove: 1,
  MouseInteraction: 2,
  Scroll: 3,
  ViewportResize: 4,
  Input: 5,
  TouchMove: 6,
  Drag: 12,
} as const;

export const REPLAY_OVERLAY_STYLE_RULES: string[] = [];

/**
 * Stock rrweb consumes event objects directly. Recorded URLs and CSS carry the
 * original snapshots, styles, fonts, and navigation; network privacy belongs
 * at the capture boundary, not in this data normalization step.
 */
export function normalizeReplayEvents(events: unknown[]): AnyReplayEvent[] {
  return events
    .filter((event): event is AnyReplayEvent => isRecord(event))
    .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));
}

export function replayAvailabilityErrorKey(
  events: unknown[],
): "noReplayEvents" | "replayUnavailableDescription" | null {
  if (events.length === 0) return "noReplayEvents";
  let hasFullSnapshot = false;
  let hasMeta = false;
  for (const event of events) {
    if (!isRecord(event)) continue;
    if (event.type === RRWEB_EVENT_TYPE.FullSnapshot) hasFullSnapshot = true;
    if (event.type === RRWEB_EVENT_TYPE.Meta) hasMeta = true;
    if (hasFullSnapshot && hasMeta) return null;
  }
  return "replayUnavailableDescription";
}

export function replayViewportDimensions(
  events: AnyReplayEvent[],
): ReplayViewportDimensions | null {
  let best: ReplayViewportDimensions | null = null;
  for (const event of events) {
    const dimensions = dimensionsFromReplayEvent(event);
    if (dimensions) best = dimensions;
  }
  return best;
}

export function replayInitialViewportDimensions(
  events: AnyReplayEvent[],
): ReplayViewportDimensions | null {
  for (const event of events) {
    if (event.type !== RRWEB_EVENT_TYPE.Meta) continue;
    const dimensions = dimensionsFromReplayEvent(event);
    if (dimensions) return dimensions;
  }
  for (const event of events) {
    const dimensions = dimensionsFromReplayEvent(event);
    if (dimensions) return dimensions;
  }
  return null;
}

export function replayRouteAtOffset(
  events: AnyReplayEvent[],
  offsetMs: number,
): string {
  const target = replayStartedAt(events) + Math.max(0, offsetMs);
  let href = "";
  for (const event of events) {
    if (
      event.type !== RRWEB_EVENT_TYPE.Meta ||
      typeof event.data?.href !== "string"
    ) {
      continue;
    }
    if (Number(event.timestamp ?? 0) > target) break;
    href = event.data.href;
  }
  if (!href) return "";
  try {
    const url = new URL(href);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href.startsWith("/") ? href : "";
  }
}

export function buildReplayViewportTimeline(
  events: AnyReplayEvent[],
): ReplayViewportChange[] {
  const initial = replayInitialViewportDimensions(events);
  if (!initial) return [];
  const startedAt = replayStartedAt(events);
  const firstMetaTimestamp = events.reduce((best, event) => {
    if (event.type !== RRWEB_EVENT_TYPE.Meta) return best;
    const timestamp = Number(event.timestamp ?? 0);
    return Number.isFinite(timestamp) && timestamp > 0
      ? Math.min(best, timestamp)
      : best;
  }, Number.POSITIVE_INFINITY);
  const changes: ReplayViewportChange[] = [{ ...initial, offsetMs: 0 }];
  for (const event of events) {
    const timestamp = Number(event.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= firstMetaTimestamp)
      continue;
    const dimensions = dimensionsFromReplayEvent(event);
    if (!dimensions) continue;
    const previous = changes[changes.length - 1];
    if (
      previous?.width === dimensions.width &&
      previous.height === dimensions.height
    ) {
      continue;
    }
    changes.push({
      ...dimensions,
      offsetMs: Math.max(0, timestamp - startedAt),
    });
  }
  return changes;
}

export function replayViewportDimensionsAtTime(
  changes: ReplayViewportChange[],
  elapsedMs: number,
): ReplayViewportDimensions | null {
  if (changes.length === 0) return null;
  const target = Math.max(0, elapsedMs);
  let low = 0;
  let high = changes.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((changes[middle]?.offsetMs ?? 0) <= target) low = middle;
    else high = middle - 1;
  }
  const match = changes[low];
  return match ? { width: match.width, height: match.height } : null;
}

export function normalizeReplayDimensions(
  width: unknown,
  height: unknown,
): ReplayViewportDimensions | null {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

export function replayStartedAt(events: AnyReplayEvent[]): number {
  let startedAt = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const timestamp = Number(event.timestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      startedAt = Math.min(startedAt, timestamp);
    }
  }
  return Number.isFinite(startedAt) ? startedAt : 0;
}

function dimensionsFromReplayEvent(
  event: AnyReplayEvent,
): ReplayViewportDimensions | null {
  if (event.type === RRWEB_EVENT_TYPE.Meta) {
    return normalizeReplayDimensions(event.data?.width, event.data?.height);
  }
  if (
    event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
    event.data?.source === INCREMENTAL_SOURCE.ViewportResize
  ) {
    return normalizeReplayDimensions(event.data?.width, event.data?.height);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
