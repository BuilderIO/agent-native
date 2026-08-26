import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

// Defined once in global.css so the gridlines, the header, and every page
// body measure the same. Keep it a var() rather than a number here: a second
// copy of the value is a second thing to forget to change.
export const SITE_MAX_WIDTH = "var(--site-max-width)";
export const GRID_COLUMNS = 3;

// The 1/3 and 2/3 lines are real `repeat(3, 1fr)` grid cells with a
// `border-right` on the non-last ones — the same structure `.pillars-grid`
// uses for its own column dividers below. A centered percentage-width
// overlay box divides its available space with plain percentage math,
// while a CSS Grid divides it via the browser's track-sizing algorithm;
// those two techniques can round sub-pixel remainders differently even over
// the same total width, which showed up as the lines not quite lining up
// with the real feature grid's dividers beneath them. Using the same grid
// technique in both places means they round the same way.
function GridLines({ gridLines }: { gridLines: "all" | "edges" }) {
  const columns = gridLines === "all" ? GRID_COLUMNS : 1;
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
        maxWidth: SITE_MAX_WIDTH,
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        borderLeft: "1px solid var(--b-border-subtle)",
        borderRight: "1px solid var(--b-border-subtle)",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {Array.from({ length: columns }, (_, i) => (
        <div
          key={i}
          style={
            i < columns - 1
              ? { borderRight: "1px solid var(--b-border-subtle)" }
              : undefined
          }
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
        maxWidth: SITE_MAX_WIDTH,
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
