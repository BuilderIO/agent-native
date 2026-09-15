import {
  DATABASE_TABLE_GUTTER_WIDTH,
  databaseFrozenColumnIds,
  databaseTableColumnIds,
} from "@shared/database-table-columns";
import {
  createContext,
  createElement,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export const DatabaseTableColumnOrder = createContext<readonly string[]>([]);

export type DatabaseTableLayoutValue = {
  frozenThroughColumnId: string | null | undefined;
  viewportWidth: number | undefined;
};

export const DatabaseTableLayout = createContext<DatabaseTableLayoutValue>({
  frozenThroughColumnId: undefined,
  viewportWidth: undefined,
});

export function DatabaseTableGrid({
  as = "div",
  propertyIds,
  widths,
  className,
  selectionCell,
  gutterWidth = DATABASE_TABLE_GUTTER_WIDTH,
  nameCell,
  propertyCells,
  actions,
  actionWidth = 36,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "button";
  type?: "button";
  disabled?: boolean;
  propertyIds: string[];
  widths: Record<string, number>;
  selectionCell?: ReactNode;
  gutterWidth?: number;
  nameCell: ReactNode;
  propertyCells: ReactNode[];
  actions?: ReactNode;
  actionWidth?: number;
}) {
  const Cell = as === "button" ? "span" : "div";
  const order = databaseTableColumnIds(
    propertyIds,
    useContext(DatabaseTableColumnOrder),
  );
  const { frozenThroughColumnId, viewportWidth } =
    useContext(DatabaseTableLayout);
  const frozenColumnIds = new Set(
    databaseFrozenColumnIds({ frozenThroughColumnId }, order, {
      widths,
      viewportWidth,
      gutterWidth,
    }),
  );
  const cells = new Map(
    propertyIds.map((id, index) => [id, propertyCells[index]]),
  );
  let stickyLeft = gutterWidth;
  return createElement(
    as,
    {
      ...props,
      className: cn("bg-background", className),
      style: {
        ...props.style,
        gridTemplateColumns: [
          `${gutterWidth}px`,
          ...order.map((id) => `${widths[id]}px`),
          ...(actions ? [`${actionWidth}px`] : []),
        ].join(" "),
      },
    },
    <Cell
      key="selection-gutter"
      data-table-selection-gutter=""
      className="sticky left-0 z-20 flex min-w-0 items-center justify-start bg-inherit"
    >
      {selectionCell}
    </Cell>,
    ...order.map((id, index) => {
      const frozen = frozenColumnIds.has(id);
      const freezeBoundary = frozen && !frozenColumnIds.has(order[index + 1]);
      const left = stickyLeft;
      stickyLeft += widths[id];
      return (
        <Cell
          key={id}
          data-table-column={id}
          data-table-frozen={frozen ? "" : undefined}
          data-table-freeze-boundary={freezeBoundary ? "" : undefined}
          className={cn(
            "grid min-w-0",
            frozen && "sticky z-10 bg-inherit",
            freezeBoundary && "border-r border-border/60",
          )}
          style={frozen ? { left } : undefined}
        >
          {id === "name" ? nameCell : cells.get(id)}
        </Cell>
      );
    }),
    actions,
  );
}
