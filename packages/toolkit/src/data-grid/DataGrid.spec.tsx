// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DataGrid,
  dataGridColumnTemplate,
  type DataGridColumn,
} from "./index.js";

interface Row {
  id: string;
  name: string;
  status: string;
}

const columns: readonly DataGridColumn<Row>[] = [
  {
    id: "name",
    label: "Name",
    width: 180,
    getValue: (row) => row.name,
    renderCell: ({ value }) => String(value ?? ""),
  },
  {
    id: "status",
    label: "Status",
    width: 120,
    getValue: (row) => row.status,
    renderCell: ({ value }) => String(value ?? ""),
    renderEditor: ({ value, onCommit }) => (
      <input
        aria-label="Status editor"
        defaultValue={String(value ?? "")}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit(event.currentTarget.value);
        }}
      />
    ),
  },
];

const rows: readonly Row[] = [
  { id: "row-1", name: "First", status: "Open" },
  { id: "row-2", name: "Second", status: "Closed" },
];

describe("data-grid", () => {
  it("builds a bounded template and includes the selection column only when requested", () => {
    expect(dataGridColumnTemplate(columns, { name: 40 }, "none")).toBe(
      "96px 120px",
    );
    expect(dataGridColumnTemplate(columns, { name: 220 }, "multiple")).toBe(
      "40px 220px 120px",
    );
  });

  describe("DataGrid", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    });

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("moves the active cell with arrows and commits an editor value", () => {
      const onActiveCellChange = vi.fn();
      const onCellCommit = vi.fn();

      act(() => {
        root.render(
          <DataGrid
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            onActiveCellChange={onActiveCellChange}
            onCellCommit={onCellCommit}
          />,
        );
      });

      const firstNameCell = container.querySelector<HTMLElement>(
        '[data-data-grid-row-id="row-1"][data-data-grid-column-id="name"]',
      );
      expect(firstNameCell?.getAttribute("tabindex")).toBe("0");

      act(() => {
        firstNameCell?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
        );
      });
      expect(onActiveCellChange).toHaveBeenCalledWith({
        rowId: "row-1",
        columnId: "status",
        editing: false,
      });

      const statusCell = container.querySelector<HTMLElement>(
        '[data-data-grid-row-id="row-1"][data-data-grid-column-id="status"]',
      );
      act(() => {
        statusCell?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
        );
      });
      expect(
        container.querySelector('input[aria-label="Status editor"]'),
      ).not.toBeNull();

      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label="Status editor"]',
      );
      expect(input).not.toBeNull();
      if (input) {
        input.value = "In progress";
        act(() => {
          input.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
          );
        });
      }
      expect(onCellCommit).toHaveBeenCalledWith({
        row: rows[0],
        rowIndex: 0,
        column: columns[1],
        previousValue: "Open",
        value: "In progress",
      });
    });

    it("supports controlled multi-row selection", () => {
      const onSelectedRowIdsChange = vi.fn();

      act(() => {
        root.render(
          <DataGrid
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            selection="multiple"
            onSelectedRowIdsChange={onSelectedRowIdsChange}
          />,
        );
      });

      const rowCheckbox = container.querySelector<HTMLInputElement>(
        '[aria-label="Select row row-1"]',
      );
      act(() => rowCheckbox?.click());
      expect(onSelectedRowIdsChange).toHaveBeenCalledTimes(1);
      expect(Array.from(onSelectedRowIdsChange.mock.calls[0][0])).toEqual([
        "row-1",
      ]);
    });

    it("reports pointer-based column resizing through the app callback", () => {
      const onColumnWidthsChange = vi.fn();

      act(() => {
        root.render(
          <DataGrid
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            onColumnWidthsChange={onColumnWidthsChange}
          />,
        );
      });

      const resizeHandle = container.querySelector<HTMLButtonElement>(
        '[aria-label="Resize name column"]',
      );
      expect(resizeHandle).not.toBeNull();

      act(() => {
        resizeHandle?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 100,
          }),
        );
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 180,
          }),
        );
        document.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, clientX: 180 }),
        );
      });

      expect(onColumnWidthsChange).toHaveBeenLastCalledWith({ name: 260 });
    });

    it("lets an app own the outer header and body while sharing the grid template", () => {
      const renderHeader = vi.fn(({ gridTemplateColumns }) => (
        <div data-testid="custom-header" style={{ gridTemplateColumns }} />
      ));
      const renderBody = vi.fn(({ gridTemplateColumns }) => (
        <div data-testid="custom-body" style={{ gridTemplateColumns }} />
      ));

      act(() => {
        root.render(
          <DataGrid
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            renderHeader={renderHeader}
            renderBody={renderBody}
          />,
        );
      });

      expect(
        container.querySelector("[data-testid=custom-header]"),
      ).not.toBeNull();
      expect(
        container.querySelector("[data-testid=custom-body]"),
      ).not.toBeNull();
      expect(renderHeader).toHaveBeenCalledWith(
        expect.objectContaining({ gridTemplateColumns: "180px 120px" }),
      );
      expect(renderBody).toHaveBeenCalledWith(
        expect.objectContaining({ rows, columns }),
      );
    });
  });
});
