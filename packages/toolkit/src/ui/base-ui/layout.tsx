import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type * as React from "react";

export type LayoutGap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export interface LayoutProps extends useRender.ComponentProps<"div"> {
  /** Spacing step from the current density. */
  gap?: LayoutGap;
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  justify?:
    | "start"
    | "center"
    | "end"
    | "space-between"
    | "space-around"
    | "space-evenly";
}
export interface InlineProps extends LayoutProps {
  wrap?: boolean;
}
export interface GridProps extends LayoutProps {
  /** A positive column count or a CSS grid track list (including responsive repeat/minmax). */
  columns?: number | string;
}
function useLayout(
  part: string,
  { render, gap, align, justify, ...props }: LayoutProps,
  extra: React.CSSProperties = {},
) {
  const style: React.CSSProperties = {
    alignItems: align,
    justifyContent: justify,
    ...(gap === undefined
      ? {}
      : { gap: gap === 0 ? 0 : `var(--space-${gap})` }),
    ...extra,
  };
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: part, style }, props),
  });
}
/** A column of children with density-aware spacing.
 * @import import { Stack } from "@agent-native/toolkit/ui/base-ui/layout";
 */
export function Stack(props: LayoutProps) {
  return useLayout("layout-stack", props);
}
/** A logical row; wrapping preserves the DOM's reading order.
 * @import import { Inline } from "@agent-native/toolkit/ui/base-ui/layout";
 */
export function Inline({ wrap, ...props }: InlineProps) {
  return useLayout(
    "layout-inline",
    props,
    wrap === undefined ? {} : { flexWrap: wrap ? "wrap" : "nowrap" },
  );
}
/** A CSS grid that accepts track counts, responsive track lists, or a theme's default.
 * @import import { Grid } from "@agent-native/toolkit/ui/base-ui/layout";
 */
export function Grid({ columns, ...props }: GridProps) {
  if (
    typeof columns === "number" &&
    (!Number.isInteger(columns) || columns < 1)
  )
    throw new RangeError("Grid columns must be a positive integer.");
  return useLayout("layout-grid", props, {
    gridTemplateColumns:
      typeof columns === "number"
        ? `repeat(${columns}, minmax(0, 1fr))`
        : columns,
  });
}
