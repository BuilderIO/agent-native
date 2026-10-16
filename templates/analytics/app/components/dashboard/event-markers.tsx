import {
  formatPanelEventDate,
  formatPanelEventWhen,
  groupPanelEvents,
  resolvePanelEvents,
  type PanelEventGroup,
} from "@shared/panel-events";
import { useMemo, type ReactNode } from "react";
import { ReferenceLine } from "recharts";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import { useChartHoverCardOpen } from "./chart-hover-card";

const DEFAULT_EVENT_COLOR = "hsl(var(--foreground))";
/** How far a marker's hover target reaches from its x, the widest part of it. */
const MARKER_REACH = 11;

interface MarkerViewBox {
  x?: number;
  y?: number;
  height?: number;
}

function EventMarkerBadge({
  viewBox,
  group,
  color,
  onHoverChange,
}: {
  viewBox?: MarkerViewBox;
  group: PanelEventGroup;
  color: string;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const [open, setOpen] = useChartHoverCardOpen(onHoverChange);
  if (viewBox?.x == null || viewBox.y == null || viewBox.height == null) {
    return null;
  }
  const cx = viewBox.x;
  const cy = viewBox.y + viewBox.height;
  const headerDate = group.events[0].date;
  return (
    // The card renders in a portal: drawn inside the SVG it was clipped at
    // the chart's edges and painted under series dots.
    <HoverCard open={open} onOpenChange={setOpen} openDelay={0} closeDelay={80}>
      <HoverCardTrigger asChild>
        <g
          data-event-marker=""
          style={{ cursor: "default" }}
          onMouseMove={(e) => e.stopPropagation()}
        >
          <circle cx={cx} cy={cy} r={11} fill="transparent" />
          {group.events.length > 1 && (
            <circle
              cx={cx}
              cy={cy}
              r={9}
              fill="none"
              stroke={color}
              strokeOpacity={0.45}
              strokeWidth={1.5}
            />
          )}
          <circle
            cx={cx}
            cy={cy}
            r={6}
            fill={color}
            stroke="hsl(var(--background))"
            strokeWidth={2}
          />
        </g>
      </HoverCardTrigger>
      {/* Markers sit on the x-axis, so the card opens up over the chart, as a
          data note's opens down from its pill. */}
      <HoverCardContent
        side="top"
        collisionPadding={8}
        className="w-auto max-w-72 p-2.5 text-xs"
      >
        <div className="mb-1.5 text-[11px] text-muted-foreground">
          {formatPanelEventDate(headerDate)}
        </div>
        <ul className="space-y-1">
          {group.events.map((event, index) => {
            const when = formatPanelEventWhen(event, headerDate);
            return (
              <li
                key={`${event.date}-${event.time ?? ""}-${index}`}
                className="flex items-center gap-2"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: event.color ?? DEFAULT_EVENT_COLOR }}
                />
                <span className="font-medium text-popover-foreground">
                  {event.label}
                </span>
                {when && (
                  <span className="ml-auto pl-3 tabular-nums text-muted-foreground">
                    {when}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * A chart's markers, worked out again only when its events, rows, or x key
 * change: a chart renders again on every hover.
 */
export function useEventMarkerGroups(
  events: unknown,
  rows: Record<string, unknown>[],
  xKey: string,
): PanelEventGroup[] {
  return useMemo(
    () =>
      groupPanelEvents(
        resolvePanelEvents(
          events,
          rows.map((row) => row[xKey]),
        ),
      ),
    [events, rows, xKey],
  );
}

/**
 * Padding for a date x-axis with a marker on its first or last value. A line
 * or area chart puts those values on the plot's edges, and a bar sits only
 * half its width in, so a marker there would hang off the plot: clipped by the
 * chart on the right, over the y-axis labels on the left.
 */
export function useEventMarkerAxisPadding(
  groups: readonly PanelEventGroup[],
  rows: readonly Record<string, unknown>[],
  xKey: string,
): { left: number; right: number } {
  const first = rows[0]?.[xKey];
  const last = rows[rows.length - 1]?.[xKey];
  const left = groups.some((group) => group.x === first) ? MARKER_REACH : 0;
  const right = groups.some((group) => group.x === last) ? MARKER_REACH : 0;
  return useMemo(() => ({ left, right }), [left, right]);
}

export function renderEventMarkers(
  groups: readonly PanelEventGroup[],
  yAxisId?: string,
  onHoverChange?: (hovered: boolean) => void,
): ReactNode[] {
  return groups.map((group) => {
    const color = group.events[0].color ?? DEFAULT_EVENT_COLOR;
    return (
      <ReferenceLine
        key={`event-${group.x}`}
        x={group.x}
        yAxisId={yAxisId}
        stroke={color}
        strokeOpacity={0.35}
        strokeDasharray="3 3"
        ifOverflow="visible"
        label={
          <EventMarkerBadge
            group={group}
            color={color}
            onHoverChange={onHoverChange}
          />
        }
      />
    );
  });
}
