import {
  forwardRef,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export const GRID_COLUMNS = 3;

function GridLines({ gridLines }: { gridLines: "all" | "edges" }) {
  const columns = gridLines === "all" ? GRID_COLUMNS : 1;
  return (
    <div
      aria-hidden="true"
      className={[
        "pointer-events-none absolute inset-y-0 left-1/2 z-0 box-border grid w-full max-w-site -translate-x-1/2 gap-px",
        "border-x border-solid border-[var(--b-border-subtle)]",
        columns === GRID_COLUMNS ? "grid-cols-3" : "grid-cols-1",
      ].join(" ")}
    >
      {Array.from({ length: columns }, (_, i) => (
        <div
          key={i}
          className={
            i > 0
              ? "-ml-px border-l border-solid border-[var(--b-border-subtle)]"
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
