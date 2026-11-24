import {
  type TableCellOwnProps,
  tableCellProps,
  type TableOwnProps,
  tableProps,
  type TableRowOwnProps,
  tableRowProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type * as React from "react";

import { splitProps } from "./props.js";
import { ScrollArea } from "./scroll-area.js";

export interface TableProps
  extends useRender.ComponentProps<"div">, TableOwnProps {}

/**
 * Rows and columns of data, as Radix Themes' Table, which scrolls sideways when
 * it is wider than its container. A row that acts gets `tabIndex` and a role,
 * and then takes the hover fill.
 *
 * @import import { Table, TableHeader, TableBody, TableRow, TableColumnHeaderCell, TableRowHeaderCell, TableCell } from "@agent-native/toolkit/ui/base-ui/table";
 */
function Table(props: TableProps) {
  const [attributes, { render, children, ...rest }] = splitProps(
    tableProps,
    props,
  );
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(
      {
        className: "table-root",
        ...attributes,
        children: (
          <ScrollArea>
            <table className="table">{children}</table>
          </ScrollArea>
        ),
      },
      rest,
    ),
  });
}

export type TableHeaderProps = useRender.ComponentProps<"thead">;

/**
 * The table's head, holding the row of column headings.
 *
 * @import import { TableHeader } from "@agent-native/toolkit/ui/base-ui/table";
 */
function TableHeader({ render, ...props }: TableHeaderProps) {
  return useRender({
    defaultTagName: "thead",
    render,
    props: mergeProps<"thead">({ className: "table-header" }, props),
  });
}

export type TableBodyProps = useRender.ComponentProps<"tbody">;

/**
 * The table's body, holding its rows of records.
 *
 * @import import { TableBody } from "@agent-native/toolkit/ui/base-ui/table";
 */
function TableBody({ render, ...props }: TableBodyProps) {
  return useRender({
    defaultTagName: "tbody",
    render,
    props: mergeProps<"tbody">({ className: "table-body" }, props),
  });
}

export interface TableRowProps
  extends Omit<useRender.ComponentProps<"tr">, "align">, TableRowOwnProps {}

/**
 * One row of the table, in its header or body.
 *
 * @import import { TableRow } from "@agent-native/toolkit/ui/base-ui/table";
 */
function TableRow(props: TableRowProps) {
  const [attributes, { render, ...rest }] = splitProps(tableRowProps, props);
  return useRender({
    defaultTagName: "tr",
    render,
    props: mergeProps<"tr">({ className: "table-row", ...attributes }, rest),
  });
}

interface CellWidths {
  width?: string;
  minWidth?: string;
  maxWidth?: string;
}

export interface TableCellProps
  extends
    Omit<useRender.ComponentProps<"td">, "width" | "align">,
    TableCellOwnProps,
    CellWidths {}

export interface TableColumnHeaderCellProps
  extends
    Omit<useRender.ComponentProps<"th">, "width" | "align">,
    TableCellOwnProps,
    CellWidths {}

export type TableRowHeaderCellProps = TableColumnHeaderCellProps;

function cellProps<P extends TableCellOwnProps & CellWidths>(
  className: string,
  props: P,
) {
  const [attributes, rest] = splitProps(tableCellProps, props);
  const { width, minWidth, maxWidth } = props;
  const style: React.CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (minWidth !== undefined) style.minWidth = minWidth;
  if (maxWidth !== undefined) style.maxWidth = maxWidth;
  return [{ className, ...attributes, style }, rest] as const;
}

/**
 * One cell of data in a row.
 *
 * @import import { TableCell } from "@agent-native/toolkit/ui/base-ui/table";
 */
function TableCell(props: TableCellProps) {
  const [own, { render, ...rest }] = cellProps("table-cell", props);
  return useRender({
    defaultTagName: "td",
    render,
    props: mergeProps<"td">(own, rest),
  });
}

/**
 * A column's heading, in the TableHeader.
 *
 * @import import { TableColumnHeaderCell } from "@agent-native/toolkit/ui/base-ui/table";
 */
function TableColumnHeaderCell(props: TableColumnHeaderCellProps) {
  const [own, { render, ...rest }] = cellProps(
    "table-cell table-column-header-cell",
    props,
  );
  return useRender({
    defaultTagName: "th",
    render,
    props: mergeProps<"th">({ ...own, scope: "col" }, rest),
  });
}

/**
 * A row's heading, its first cell, naming the record.
 *
 * @import import { TableRowHeaderCell } from "@agent-native/toolkit/ui/base-ui/table";
 */
function TableRowHeaderCell(props: TableRowHeaderCellProps) {
  const [own, { render, ...rest }] = cellProps(
    "table-cell table-row-header-cell",
    props,
  );
  return useRender({
    defaultTagName: "th",
    render,
    props: mergeProps<"th">({ ...own, scope: "row" }, rest),
  });
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeaderCell,
  TableRowHeaderCell,
  TableCell,
};
