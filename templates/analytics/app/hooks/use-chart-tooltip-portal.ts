import { useLayoutEffect, useRef } from "react";

const CHART_EDGE_PADDING = 8;
const CURSOR_OFFSET = 14;

type TooltipCoordinate = { x?: number; y?: number } | undefined;

/**
 * Ancestors of a dashboard chart (the scrollable app shell, the dashboard
 * grid's inline-size container) clip any content that overflows their box,
 * so the tooltip content is rendered through a portal to `document.body`.
 * Recharts positions its own tooltip wrapper by measuring that wrapper's
 * child content size — with the real content portaled away the wrapper has
 * no size to measure and never gets a transform, so we can't read a live
 * position off it. Instead, position the portaled box ourselves from the
 * `coordinate` Recharts already passes to custom tooltip content (the exact
 * pixel the cursor is over, relative to the chart) plus the chart's own
 * `.recharts-wrapper` rect, and clamp against that same rect so the tooltip
 * tracks the cursor but never crosses the chart's own edges.
 */
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

    const pointX = chartRect.left + (coordinate?.x ?? 0);
    const pointY = chartRect.top + (coordinate?.y ?? 0);

    const minLeft = chartRect.left + CHART_EDGE_PADDING;
    const maxLeft = chartRect.right - CHART_EDGE_PADDING - boxRect.width;
    let left = pointX + CURSOR_OFFSET;
    if (left > maxLeft) left = pointX - CURSOR_OFFSET - boxRect.width;
    left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));

    const minTop = chartRect.top + CHART_EDGE_PADDING;
    const maxTop = chartRect.bottom - CHART_EDGE_PADDING - boxRect.height;
    const top = Math.min(
      Math.max(pointY - boxRect.height / 2, minTop),
      Math.max(minTop, maxTop),
    );

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }, [isVisible, coordinate?.x, coordinate?.y]);

  return { anchorRef, boxRef };
}
