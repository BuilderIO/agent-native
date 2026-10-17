export function getScreenContentPointFromClient(
  clientX: number,
  clientY: number,
  iframeRect: { left: number; top: number; width: number; height: number },
  iframeContentSize: { width: number; height: number },
  scrollOffset: { left: number; top: number } = { left: 0, top: 0 },
): { x: number; y: number } {
  const scaleX =
    iframeContentSize.width > 0
      ? iframeRect.width / iframeContentSize.width
      : 1;
  const scaleY =
    iframeContentSize.height > 0
      ? iframeRect.height / iframeContentSize.height
      : 1;
  return {
    x: (clientX - iframeRect.left) / (scaleX || 1) + scrollOffset.left,
    y: (clientY - iframeRect.top) / (scaleY || 1) + scrollOffset.top,
  };
}

export function getZoomToCursorScrollDelta(
  anchorClient: { x: number; y: number },
  containerRect: { left: number; top: number },
  scrollOffset: { scrollLeft: number; scrollTop: number },
  zoomRatio: number,
): { dx: number; dy: number } {
  const cx = anchorClient.x - containerRect.left + scrollOffset.scrollLeft;
  const cy = anchorClient.y - containerRect.top + scrollOffset.scrollTop;
  return {
    dx: cx * (zoomRatio - 1),
    dy: cy * (zoomRatio - 1),
  };
}
