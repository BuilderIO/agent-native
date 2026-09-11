import { type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export const INSPECTOR_GRID_COLUMNS = 28;
export const INSPECTOR_GRID_UNIT_PX = 8;
export const INSPECTOR_GRID_ROW_PX = 24;
export const INSPECTOR_GRID_PAIR_SPAN = 13;
export const INSPECTOR_GRID_PAIR_GUTTER_SPAN = 2;
export const INSPECTOR_GRID_ACTION_PAIR_SPAN = 11;
export const INSPECTOR_GRID_ACTION_GUTTER_SPAN = 1;
export const INSPECTOR_GRID_ACTION_SPAN = 4;
export const INSPECTOR_GRID_ACTION_WIDTH_PX =
  INSPECTOR_GRID_ACTION_SPAN * INSPECTOR_GRID_UNIT_PX;
export const INSPECTOR_GRID_ACTION_GUTTER_WIDTH_PX =
  INSPECTOR_GRID_ACTION_GUTTER_SPAN * INSPECTOR_GRID_UNIT_PX;
export const INSPECTOR_GRID_PAIR_GUTTER_WIDTH_PX =
  INSPECTOR_GRID_PAIR_GUTTER_SPAN * INSPECTOR_GRID_UNIT_PX;
export const INSPECTOR_GRID_PAINT_FIELD_SPAN = 20;
export const INSPECTOR_GRID_PAINT_ACTION_SPAN = 4;
export const INSPECTOR_GRID_PAINT_ACTION_WIDTH_PX =
  INSPECTOR_GRID_PAINT_ACTION_SPAN * INSPECTOR_GRID_UNIT_PX;
export const INSPECTOR_GRID_STROKE_POSITION_SPAN = 10;
export const INSPECTOR_GRID_STROKE_GUTTER_SPAN = 1;
export const INSPECTOR_GRID_STROKE_WEIGHT_SPAN = 9;

/**
 * Shared row geometry for the Design inspector. At the default 240px panel
 * width, PanelSection's 8px insets leave 28 exact 8px columns. Named layouts
 * keep their baseline gutters and action rails fixed as the panel grows, so
 * only fields absorb the extra width. The authored spans remain useful as the
 * baseline contract and as the fallback for the free-form `columns` layout.
 */
export function InspectorGrid({
  children,
  className,
  layout = "columns",
  ...props
}: {
  children: ReactNode;
  className?: string;
  layout?:
    | "columns"
    | "pair"
    | "pair-flow"
    | "action-pair"
    | "label-action-pair"
    | "field-action"
    | "label-field-action"
    | "label-action-rows"
    | "header-actions"
    | "stroke-details"
    | "paint-row"
    | "drag-paint-row";
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  return (
    <div
      {...props}
      className={cn("design-inspector-grid", className)}
      data-inspector-grid
      data-inspector-layout={layout}
    >
      {children}
    </div>
  );
}

/**
 * Shared right-edge rail for inspector headers. Every action occupies one
 * literal 32px slot (four 8px baseline columns); adding or removing actions
 * grows the rail inward while the terminal slot stays pinned to the same
 * right edge as paint-row visibility/removal controls.
 */
export function InspectorActionRail({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("design-inspector-action-rail", className)}
      data-inspector-action-rail="fixed"
    >
      {children}
    </div>
  );
}

/**
 * Canonical row used by Fill, Stroke, and Effects. At the baseline width it
 * resolves to the authored 20/4/4 split, while wider inspectors give every
 * extra pixel to the content track. The visibility and terminal actions stay
 * pinned to two fixed 32px slots at the right edge. Draggable rows overlay
 * their handle inside the content track instead of consuming another slot.
 */
export function InspectorPaintRow({
  children,
  draggable = false,
  className,
  ...props
}: {
  children: ReactNode;
  draggable?: boolean;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  return (
    <InspectorGrid
      {...props}
      className={cn("group relative items-center", className)}
      layout={draggable ? "drag-paint-row" : "paint-row"}
      data-inspector-action-rail="fixed"
    >
      {children}
    </InspectorGrid>
  );
}

export function InspectorGridCell({
  children,
  span = INSPECTOR_GRID_COLUMNS,
  start,
  rowSpan,
  ariaHidden = false,
  className,
}: {
  children?: ReactNode;
  span?: number;
  start?: number;
  rowSpan?: number;
  ariaHidden?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("min-w-0", className)}
      data-inspector-grid-cell
      data-inspector-span={span}
      aria-hidden={ariaHidden || undefined}
      style={{
        gridColumn: start
          ? `${start} / span ${span}`
          : `span ${span} / span ${span}`,
        ...(rowSpan ? { gridRow: `span ${rowSpan} / span ${rowSpan}` } : {}),
      }}
    >
      {children}
    </div>
  );
}

/**
 * Canonical inspector row for two peer controls plus the trailing action lane.
 * Reserving all five tracks even when `action` is empty keeps Alignment,
 * Position, Rotation, and Layout on identical column starts.
 */
export function InspectorActionPairGrid({
  left,
  right,
  action,
  className,
  leftClassName,
  rightClassName,
  actionClassName,
}: {
  left: ReactNode;
  right: ReactNode;
  action?: ReactNode;
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
  actionClassName?: string;
}) {
  return (
    <InspectorGrid className={className} layout="action-pair">
      <InspectorGridCell
        span={INSPECTOR_GRID_ACTION_PAIR_SPAN}
        className={leftClassName}
      >
        {left}
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_GUTTER_SPAN} ariaHidden />
      <InspectorGridCell
        span={INSPECTOR_GRID_ACTION_PAIR_SPAN}
        className={rightClassName}
      >
        {right}
      </InspectorGridCell>
      <InspectorGridCell span={INSPECTOR_GRID_ACTION_GUTTER_SPAN} ariaHidden />
      <InspectorGridCell
        span={INSPECTOR_GRID_ACTION_SPAN}
        ariaHidden={action == null}
        className={cn("flex items-center justify-center", actionClassName)}
      >
        {action}
      </InspectorGridCell>
    </InspectorGrid>
  );
}
