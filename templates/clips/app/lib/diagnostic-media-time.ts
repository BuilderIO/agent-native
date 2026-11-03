import type { AppActivityEvent } from "@shared/app-activity";

export function diagnosticEventMediaTime(
  event: AppActivityEvent,
  media: {
    recordingStartedAt: string;
    pauses: Array<{ from: string; to: string }>;
    durationMs: number;
  },
): number | null {
  const start = Date.parse(media.recordingStartedAt);
  const at = event.timestampMs;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(at) ||
    at < start ||
    event.duringPause
  )
    return null;
  let pausedMs = 0;
  for (const pause of media.pauses) {
    const from = Date.parse(pause.from);
    const to = Date.parse(pause.to);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < start ||
      to < from
    )
      return null;
    if (at >= from && at < to) return null;
    pausedMs += Math.max(0, Math.min(at, to) - from);
  }
  const offset = at - start - pausedMs;
  return offset >= 0 && offset <= media.durationMs ? offset : null;
}
