export function getTimelineBaseTrackWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth)) return 0;
  return Math.max(0, Math.floor(viewportWidth));
}

export function getTimelineTotalWidth(
  viewportWidth: number,
  zoom: number,
): number {
  const baseTrackWidth = getTimelineBaseTrackWidth(viewportWidth);
  return Math.max(
    baseTrackWidth,
    Math.floor(baseTrackWidth * Math.max(1, zoom)),
  );
}
