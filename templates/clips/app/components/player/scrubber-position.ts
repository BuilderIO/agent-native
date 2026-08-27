export interface ScrubberTrackRect {
  left: number;
  width: number;
}

export function scrubberPositionFromClientX(
  clientX: number,
  rect: ScrubberTrackRect,
  durationMs: number,
): { ms: number; x: number } {
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const ratio = rect.width > 0 ? x / rect.width : 0;
  return { ms: Math.floor(ratio * durationMs), x };
}

export function scrubberFillPercent(
  currentMs: number,
  durationMs: number,
): number {
  if (!Number.isFinite(currentMs) || !Number.isFinite(durationMs)) return 0;
  if (durationMs <= 0) return 0;
  return Math.max(0, Math.min(100, (currentMs / durationMs) * 100));
}

export function timelineMarkerMs(ms: number): number {
  return Math.round(ms / 500) * 500;
}

export function timelineMarkerLanes(
  markerTimes: number[],
  markerWidths: Map<number, number>,
  durationMs: number,
  trackWidth: number,
): Map<number, number> {
  if (!markerTimes.length) return new Map();
  if (!(trackWidth > 0) || !(durationMs > 0)) {
    return new Map(markerTimes.map((ms, index) => [ms, index]));
  }

  const laneEnds: number[] = [];
  return new Map(
    markerTimes.map((ms) => {
      const markerWidth = markerWidths.get(ms) ?? 28;
      const markerX = Math.min(
        trackWidth,
        Math.max(0, (ms / durationMs) * trackWidth),
      );
      const markerStart =
        ms <= 0
          ? 0
          : ms >= durationMs
            ? Math.max(0, trackWidth - markerWidth)
            : Math.max(0, markerX - markerWidth / 2);
      const markerEnd = markerStart + markerWidth + 2;
      let lane = laneEnds.findIndex((end) => markerStart >= end);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = markerEnd;
      return [ms, lane] as const;
    }),
  );
}
