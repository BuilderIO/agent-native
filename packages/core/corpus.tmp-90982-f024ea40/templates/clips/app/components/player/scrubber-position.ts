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
