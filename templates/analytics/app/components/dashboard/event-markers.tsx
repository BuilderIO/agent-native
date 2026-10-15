import { resolvePanelEvents } from "@shared/panel-events";
import { useState, type ReactNode } from "react";
import { ReferenceLine } from "recharts";

const DEFAULT_EVENT_COLOR = "hsl(var(--foreground))";

interface MarkerViewBox {
  x?: number;
  y?: number;
  height?: number;
}

function EventMarkerBadge({
  viewBox,
  color,
  label,
  date,
  onHoverChange,
}: {
  viewBox?: MarkerViewBox;
  color: string;
  label: string;
  date: string;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const [hovered, setHoveredState] = useState(false);
  const setHovered = (value: boolean) => {
    setHoveredState(value);
    onHoverChange?.(value);
  };
  if (viewBox?.x == null || viewBox.y == null || viewBox.height == null) {
    return null;
  }
  const cx = viewBox.x;
  const cy = viewBox.y + viewBox.height;
  const boxWidth = Math.max(label.length * 7.4, 80) + 24;
  return (
    <g
      style={{ cursor: "default" }}
      onMouseOver={() => setHovered(true)}
      onMouseMove={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill={color}
        stroke="hsl(var(--background))"
        strokeWidth={2}
      />
      {hovered && (
        <g pointerEvents="none">
          <rect
            x={cx - boxWidth / 2}
            y={cy - 64}
            width={boxWidth}
            height={44}
            rx={6}
            fill="hsl(var(--popover))"
            stroke="hsl(var(--border))"
          />
          <text
            x={cx}
            y={cy - 44}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill="hsl(var(--popover-foreground))"
          >
            {label}
          </text>
          <text
            x={cx}
            y={cy - 28}
            textAnchor="middle"
            fontSize={11}
            fill="hsl(var(--muted-foreground))"
          >
            {date}
          </text>
        </g>
      )}
    </g>
  );
}

export function renderEventMarkers(
  events: unknown,
  rows: Record<string, unknown>[],
  xKey: string,
  yAxisId?: string,
  onHoverChange?: (hovered: boolean) => void,
): ReactNode[] {
  return resolvePanelEvents(
    events,
    rows.map((row) => row[xKey]),
  ).map((event) => {
    const color = event.color ?? DEFAULT_EVENT_COLOR;
    return (
      <ReferenceLine
        key={`event-${event.date}-${event.label}`}
        x={event.x}
        yAxisId={yAxisId}
        stroke={color}
        strokeOpacity={0.35}
        strokeDasharray="3 3"
        ifOverflow="visible"
        label={
          <EventMarkerBadge
            color={color}
            label={event.label}
            date={event.date}
            onHoverChange={onHoverChange}
          />
        }
      />
    );
  });
}
