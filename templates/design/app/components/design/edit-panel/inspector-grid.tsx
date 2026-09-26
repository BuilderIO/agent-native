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
