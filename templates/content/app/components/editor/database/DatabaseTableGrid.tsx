import { databaseTableColumnIds } from "@shared/database-table-columns";
import {
  createContext,
  createElement,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export const DatabaseTableColumnOrder = createContext<readonly string[]>([]);

export function DatabaseTableGrid({
  as = "div",
  propertyIds,
  widths,
  className,
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
  const cells = new Map(
    propertyIds.map((id, index) => [id, propertyCells[index]]),
  );
  return createElement(
    as,
    {
      ...props,
      className: cn("bg-background", className),
      style: {
        ...props.style,
        gridTemplateColumns: [
          ...order.map((id) => `${widths[id]}px`),
          ...(actions ? [`${actionWidth}px`] : []),
        ].join(" "),
      },
    },
    ...order.map((id) => (
      <Cell
        key={id}
        data-table-column={id}
        className={
          id === "name"
            ? "sticky left-0 z-10 grid min-w-0 bg-inherit"
            : "grid min-w-0"
        }
      >
        {id === "name" ? nameCell : cells.get(id)}
      </Cell>
    )),
    actions,
  );
}
