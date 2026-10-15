import {
  formatPanelEventDate,
  formatPanelEventWhen,
  groupPanelEvents,
  resolvePanelEvents,
  type PanelEventGroup,
} from "@shared/panel-events";
import { useState, type ReactNode } from "react";
import { ReferenceLine } from "recharts";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

const DEFAULT_EVENT_COLOR = "hsl(var(--foreground))";

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
  const [open, setOpenState] = useState(false);
  const setOpen = (value: boolean) => {
    setOpenState(value);
    onHoverChange?.(value);
  };
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

export function renderEventMarkers(
  events: unknown,
  rows: Record<string, unknown>[],
  xKey: string,
  yAxisId?: string,
  onHoverChange?: (hovered: boolean) => void,
): ReactNode[] {
  return groupPanelEvents(
    resolvePanelEvents(
      events,
      rows.map((row) => row[xKey]),
    ),
  ).map((group) => {
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
