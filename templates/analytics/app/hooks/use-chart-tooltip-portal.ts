import { useLayoutEffect, useRef } from "react";

const VIEWPORT_EDGE_PADDING = 8;
const CURSOR_OFFSET = 14;

type TooltipCoordinate = { x?: number; y?: number } | undefined;
type Rect = { left: number; right: number; top: number; bottom: number };
type Size = { width: number; height: number };

export function getChartTooltipPortalPosition({
  chartRect,
  coordinate,
  tooltipSize,
  viewport,
}: {
  chartRect: Rect;
  coordinate: TooltipCoordinate;
  tooltipSize: Size;
  viewport: { width: number; height: number; right?: number };
}) {
  const pointX = chartRect.left + (coordinate?.x ?? 0);
  const pointY = chartRect.top + (coordinate?.y ?? 0);
  const minLeft = VIEWPORT_EDGE_PADDING;
  const maxLeft = Math.max(
    minLeft,
    (viewport.right ?? viewport.width) -
      VIEWPORT_EDGE_PADDING -
      tooltipSize.width,
  );
  let left = pointX + CURSOR_OFFSET;
  if (left > maxLeft) left = pointX - CURSOR_OFFSET - tooltipSize.width;
  left = Math.min(Math.max(left, minLeft), maxLeft);

  const minTop = VIEWPORT_EDGE_PADDING;
  const maxTop = Math.max(
    minTop,
    viewport.height - VIEWPORT_EDGE_PADDING - tooltipSize.height,
  );
  const top = Math.min(
    Math.max(pointY - tooltipSize.height / 2, minTop),
    maxTop,
  );

  return { left, top };
}

export function useChartTooltipPortalPosition(
  isVisible: boolean,
  coordinate: TooltipCoordinate,
) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!isVisible) return;
    const anchor = anchorRef.current;
    const box = boxRef.current;
    if (!anchor || !box) return;
    const chartEl = anchor.closest(".recharts-wrapper");
    if (!chartEl) return;

    const chartRect = chartEl.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();

    const sidebar = document.querySelector<HTMLElement>(".agent-sidebar-panel");
    const sidebarRect = sidebar?.getBoundingClientRect();
    const sidebarLeft =
      sidebarRect && sidebarRect.width > 0 && sidebarRect.left > 0
        ? sidebarRect.left
        : window.innerWidth;
    const { left, top } = getChartTooltipPortalPosition({
      chartRect,
      coordinate,
      tooltipSize: boxRect,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        right: sidebarLeft,
      },
    });

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }, [isVisible, coordinate?.x, coordinate?.y]);

  return { anchorRef, boxRef };
}
