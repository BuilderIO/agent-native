import {
  forwardRef,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

// The one content measure — `--site-max-width` in global.css, aliased into
// Tailwind's theme as the `site` container, so every consumer spells it
// `max-w-site` and the gridlines, the header, and each page body cannot drift.
//
// Tailwind cannot build a class from a runtime value, so the `grid-cols-3`
// utilities below spell this number out. Changing it means changing those too.
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
      className={[
        "pointer-events-none absolute inset-y-0 left-1/2 z-0 box-border grid w-full max-w-site -translate-x-1/2",
        "border-x border-solid border-[var(--b-border-subtle)]",
        columns === GRID_COLUMNS ? "grid-cols-3" : "grid-cols-1",
      ].join(" ")}
    >
      {Array.from({ length: columns }, (_, i) => (
        <div
          key={i}
          className={
            i < columns - 1
              ? "border-r border-solid border-[var(--b-border-subtle)]"
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
}

export const PageSection = forwardRef<HTMLElement, PageSectionProps>(
  function PageSection(
    {
      as: Tag = "section",
      showGrid = true,
      gridLines = "all",
      children,
      className,
      ...rest
    },
    ref,
  ) {
    return (
      <Tag
        ref={ref}
        className={["relative w-full overflow-hidden isolate", className]
          .filter(Boolean)
          .join(" ")}
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
}

export function GridInner({
  children,
  className,
  as: Tag = "div",
  ...rest
}: GridInnerProps) {
  return (
    <Tag
      className={[
        "relative z-[1] mx-auto box-border w-full max-w-site",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </Tag>
  );
}

interface GridColsProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function GridCols({ children, className, ...rest }: GridColsProps) {
  return (
    <div
      className={["grid grid-cols-3", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
