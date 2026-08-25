import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export const GRID_MAX_WIDTH = 1200;
export const GRID_COLUMNS = 3;

// Real border-left/border-right on real boxes, not absolutely-positioned 1px
// background divs — sibling elements elsewhere (e.g. the logos grid) draw
// their own edges with `border`, and two independently-computed 1px
// background lines don't reliably land on the same device pixel as a real
// border does, which showed up as a doubled/fuzzed line at shared edges.
// Using `border` here too means both are resolved through the same rounding
// path, so they align.
function GridLines({ gridLines }: { gridLines: "all" | "edges" }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: GRID_MAX_WIDTH,
        boxSizing: "border-box",
        borderLeft: "1px solid var(--b-border-subtle)",
        borderRight: "1px solid var(--b-border-subtle)",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {gridLines === "all" && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: `${(1 / 3) * 100}%`,
            boxSizing: "border-box",
            borderLeft: "1px solid var(--b-border-subtle)",
            borderRight: "1px solid var(--b-border-subtle)",
          }}
        />
      )}
    </div>
  );
}

interface PageSectionProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  showGrid?: boolean;
  gridLines?: "all" | "edges";
  children?: ReactNode;
  style?: CSSProperties;
}

export const PageSection = forwardRef<HTMLElement, PageSectionProps>(
  function PageSection(
    {
      as: Tag = "section",
      showGrid = true,
      gridLines = "all",
      children,
      style,
      ...rest
    },
    ref,
  ) {
    return (
      <Tag
        ref={ref}
        style={{
          position: "relative",
          width: "100%",
          overflow: "hidden",
          isolation: "isolate",
          ...style,
        }}
        {...rest}
      >
        {showGrid && <GridLines gridLines={gridLines} />}
        {children}
      </Tag>
    );
  },
);

interface GridInnerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children?: ReactNode;
  style?: CSSProperties;
}

export function GridInner({
  children,
  style,
  as: Tag = "div",
  ...rest
}: GridInnerProps) {
  return (
    <Tag
      style={{
        maxWidth: GRID_MAX_WIDTH,
        width: "100%",
        margin: "0 auto",
        position: "relative",
        zIndex: 1,
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

interface GridColsProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  style?: CSSProperties;
}

export function GridCols({ children, style, ...rest }: GridColsProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
