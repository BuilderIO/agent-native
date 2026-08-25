import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

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
  gridLines?: "all" | "edges" | "middle";
  children?: ReactNode;
  style?: CSSProperties;
}

// Sections that render their own bordered box flush with the 0%/100% edges
// (e.g. the logos grid) already draw a crisp edge themselves; layering the
// decorative edge line from GridLines at that exact same coordinate produces
// a doubled/fuzzed line where the two independently-antialiased 1px strokes
// don't quite land on the same device pixel. "middle" keeps the 1/3 and 2/3
// lines for visual consistency with the rest of the page, but skips 0/100%.
function gridLinePositions(gridLines: PageSectionProps["gridLines"]) {
  if (gridLines === "edges") return [0, 1];
  if (gridLines === "middle") return [1 / 3, 2 / 3];
  return LINE_POSITIONS;
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
        {showGrid && <GridLines positions={gridLinePositions(gridLines)} />}
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
