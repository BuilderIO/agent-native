// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Table,
  TableBody,
  TableCell,
  type TableCellProps,
  TableColumnHeaderCell,
  TableHeader,
  type TableProps,
  TableRow,
  TableRowHeaderCell,
} from "./table.js";

afterEach(cleanup);

function Runs(props: TableProps) {
  return (
    <Table data-testid="root" {...props}>
      <TableHeader>
        <TableRow>
          <TableColumnHeaderCell>Run</TableColumnHeaderCell>
          <TableColumnHeaderCell justify="end">Tokens</TableColumnHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableRowHeaderCell>Nightly sync</TableRowHeaderCell>
          <TableCell justify="end" width="120px">
            4,210
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

describe("Table part", () => {
  it("writes its variant and layout, ghost auto by default", () => {
    render(<Runs />);
    const root = screen.getByTestId("root");
    expect(root.className).toBe("table-root");
    expect(root.dataset.variant).toBe("ghost");
    expect(root.dataset.layout).toBe("auto");
  });

  it("holds a native table that scrolls inside its frame", () => {
    render(<Runs variant="surface" layout="fixed" />);
    const root = screen.getByTestId("root");
    expect(root.dataset.variant).toBe("surface");
    const table = screen.getByRole("table");
    expect(table.className).toBe("table");
    expect(table.closest(".scroll-area")).not.toBeNull();
    expect(root.contains(table)).toBe(true);
  });

  it("scopes its header cells to their column and row", () => {
    render(<Runs />);
    const column = screen.getByRole("columnheader", { name: "Run" });
    expect(column.getAttribute("scope")).toBe("col");
    expect(column.className).toBe("table-cell table-column-header-cell");
    const row = screen.getByRole("rowheader", { name: "Nightly sync" });
    expect(row.getAttribute("scope")).toBe("row");
    expect(row.className).toBe("table-cell table-row-header-cell");
  });

  it("aligns rows to the top and cells to the start by default", () => {
    render(<Runs />);
    const row = screen.getAllByRole("row").at(1);
    expect(row?.dataset.align).toBe("start");
    const cell = screen.getByRole("rowheader", { name: "Nightly sync" });
    expect(cell.dataset.justify).toBe("start");
    expect(cell.getAttribute("style")).toBeNull();
  });

  it("writes a cell's justify and widths, and a row's align", () => {
    render(
      <Table>
        <TableBody>
          <TableRow align="center" data-testid="row">
            <TableCell justify="center" minWidth="80px" maxWidth="50%">
              Paused
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByTestId("row").dataset.align).toBe("center");
    const cell = screen.getByRole("cell", { name: "Paused" });
    expect(cell.className).toBe("table-cell");
    expect(cell.dataset.justify).toBe("center");
    expect(cell.style.minWidth).toBe("80px");
    expect(cell.style.maxWidth).toBe("50%");
    expect(cell.style.width).toBe("");
  });

  it("names its rows and cells as a table does", () => {
    render(<Runs />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(
      within(rows[1] ?? document.body).getByRole("cell", { name: "4,210" })
        .style.width,
    ).toBe("120px");
  });

  it("refuses a variant or justify it doesn't have", () => {
    const props = { variant: "outline" } as unknown as TableProps;
    expect(() => render(<Runs {...props} />)).toThrow(
      /variant="outline" is not one of/,
    );
    const cell = { justify: "left" } as unknown as TableCellProps;
    expect(() =>
      render(
        <table>
          <tbody>
            <tr>
              <TableCell {...cell} />
            </tr>
          </tbody>
        </table>,
      ),
    ).toThrow(/justify="left" is not one of/);
  });
});
