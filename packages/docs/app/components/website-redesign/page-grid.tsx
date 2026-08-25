import { forwardRef, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from "react";

export const GRID_MAX_WIDTH = 1200;
export const GRID_COLUMNS = 3;

// Fractional positions of all 4 vertical lines: left edge, 1/3, 2/3, right edge
const LINE_POSITIONS = [0, 1 / 3, 2 / 3, 1] as const;

interface GridLinesProps {
  positions?: readonly number[];
}

function GridLines({ positions = LINE_POSITIONS }: GridLinesProps) {
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
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {positions.map((pos) => (
        <div
          key={pos}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${pos * 100}%`,
            width: 1,
            background: "var(--b-border-subtle)",
          }}
        />
      ))}
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

export const PageSection = forwardRef<HTMLElement, PageSectionProps>(function PageSection(
  { as: Tag = "section", showGrid = true, gridLines = "all", children, style, ...rest },
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
      {showGrid && <GridLines positions={gridLines === "edges" ? [0, 1] : LINE_POSITIONS} />}
      {children}
    </Tag>
  );
});

interface GridInnerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children?: ReactNode;
  style?: CSSProperties;
}

export function GridInner({ children, style, as: Tag = "div", ...rest }: GridInnerProps) {
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
      style={{ display: "grid", gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
