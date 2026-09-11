const DEFAULT_SELECTION_WINDOW_MS = 1_000;

export function defaultSelectionRange(
  playheadMs: number,
  durationMs: number,
): { startMs: number; endMs: number } {
  const clipDuration =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : DEFAULT_SELECTION_WINDOW_MS;
  const playhead = Number.isFinite(playheadMs)
    ? Math.max(0, Math.min(clipDuration, playheadMs))
    : 0;

  return {
    startMs: Math.max(0, playhead - DEFAULT_SELECTION_WINDOW_MS),
    endMs: Math.min(clipDuration, playhead + DEFAULT_SELECTION_WINDOW_MS),
  };
}
