// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type GridSize,
  GridSizePicker,
  type GridSizePickerProps,
} from "./grid-size-picker.js";

afterEach(cleanup);

function press(element: Element) {
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.pointerUp(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0 });
}

async function openPicker(props: Partial<GridSizePickerProps> = {}) {
  render(<GridSizePicker {...props} />);
  const trigger = document.querySelector(".grid-size-picker");
  if (trigger === null) throw new Error("No trigger rendered.");
  await act(async () => press(trigger));
  const matrix = await screen.findByRole("grid", { name: "Columns and rows" });
  return { trigger, matrix };
}

function focused(): Element {
  const element = document.activeElement;
  if (element === null) throw new Error("Nothing is focused.");
  return element;
}

const readout = () => screen.getByRole("status").textContent;

describe("GridSizePicker trigger", () => {
  it("writes its props and reads C × R, size 1 surface by default", () => {
    render(<GridSizePicker defaultValue={{ columns: 4, rows: "auto" }} />);
    const trigger = screen.getByRole("button", { name: "4 × Auto" });
    expect(trigger.classList.contains("grid-size-picker")).toBe(true);
    expect(trigger.dataset.size).toBe("1");
    expect(trigger.dataset.variant).toBe("surface");
    expect(trigger.hasAttribute("data-auto")).toBe(true);
  });

  it("draws the grid it sets, up to 12 × 8", () => {
    const preview = () => {
      const tile = document.querySelector<HTMLElement>(".grid-size-picker");
      if (tile === null) throw new Error("No tile rendered.");
      return {
        cells: tile.querySelectorAll(".grid-size-picker-preview-cell").length,
        columns: tile.style.getPropertyValue("--_columns"),
        rows: tile.style.getPropertyValue("--_rows"),
      };
    };
    const { rerender } = render(
      <GridSizePicker value={{ columns: 4, rows: 4 }} />,
    );
    expect(screen.getByRole("button", { name: "4 × 4" })).toBeTruthy();
    expect(preview()).toEqual({ cells: 16, columns: "4", rows: "4" });
    rerender(<GridSizePicker value={{ columns: 3, rows: "auto" }} />);
    expect(preview()).toEqual({ cells: 24, columns: "3", rows: "8" });
    rerender(<GridSizePicker value={{ columns: 20, rows: 30 }} />);
    expect(preview()).toEqual({ cells: 96, columns: "12", rows: "8" });
  });

  it("keeps a caller's style beside its own", () => {
    render(<GridSizePicker style={{ marginTop: 4 }} />);
    const tile = screen.getByRole("button");
    expect(tile.style.marginTop).toBe("4px");
    expect(tile.style.getPropertyValue("--_columns")).toBe("2");
  });

  it("refuses a size it doesn't have", () => {
    const props = { size: "5" } as unknown as GridSizePickerProps;
    expect(() => render(<GridSizePicker {...props} />)).toThrow(
      /size="5" is not one of/,
    );
  });
});

describe("GridSizePicker matrix", () => {
  it("is a 12 × 8 grid whose committed cells are selected", async () => {
    const { matrix } = await openPicker({
      defaultValue: { columns: 3, rows: 2 },
    });
    expect(within(matrix).getAllByRole("row")).toHaveLength(8);
    const cells = within(matrix).getAllByRole("gridcell");
    expect(cells).toHaveLength(96);
    expect(
      cells.filter((cell) => cell.getAttribute("aria-selected") === "true"),
    ).toHaveLength(6);
    expect(readout()).toBe("3 × 2");
  });

  it("selects whole columns while rows are auto", async () => {
    const { matrix } = await openPicker({
      defaultValue: { columns: 2, rows: "auto" },
    });
    expect(
      within(matrix)
        .getAllByRole("gridcell")
        .filter((cell) => cell.getAttribute("aria-selected") === "true"),
    ).toHaveLength(16);
  });

  it("previews on hover and commits on click", async () => {
    const onValueChange = vi.fn();
    const { matrix } = await openPicker({ onValueChange });
    const cell = within(matrix).getByRole("gridcell", { name: "9 × 6" });
    fireEvent.pointerEnter(cell);
    expect(readout()).toBe("9 × 6");
    expect(
      matrix.querySelectorAll(".grid-size-picker-cell[data-highlighted]"),
    ).toHaveLength(54);
    fireEvent.pointerLeave(matrix);
    expect(readout()).toBe("2 × Auto");
    fireEvent.click(cell);
    expect(onValueChange).toHaveBeenLastCalledWith({ columns: 9, rows: 6 });
  });

  it("grows and shrinks with the arrow keys and commits on Enter", async () => {
    const onValueChange = vi.fn();
    const { matrix } = await openPicker({
      defaultValue: { columns: 2, rows: 2 },
      onValueChange,
    });
    const stop = within(matrix)
      .getAllByRole("gridcell")
      .filter((cell) => cell.tabIndex === 0);
    expect(stop.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "2 × 2",
    ]);
    const start = stop.at(0);
    if (start === undefined) throw new Error("No tab stop.");
    act(() => start.focus());
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyDown(focused(), { key: "ArrowRight" });
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    expect(focused().getAttribute("aria-label")).toBe("4 × 3");
    expect(readout()).toBe("4 × 3");
    fireEvent.keyDown(focused(), { key: "ArrowLeft" });
    expect(readout()).toBe("3 × 3");
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.keyDown(focused(), { key: "Enter" });
    expect(onValueChange).toHaveBeenLastCalledWith({ columns: 3, rows: 3 });
  });

  it("stops at the matrix edges", async () => {
    const { matrix } = await openPicker({
      defaultValue: { columns: 1, rows: 1 },
    });
    const cell = within(matrix).getByRole("gridcell", { name: "1 × 1" });
    act(() => cell.focus());
    fireEvent.keyDown(cell, { key: "ArrowLeft" });
    fireEvent.keyDown(focused(), { key: "ArrowUp" });
    expect(focused().getAttribute("aria-label")).toBe("1 × 1");
  });
});

describe("GridSizePicker fields", () => {
  it("sets columns and rows precisely from the number fields", async () => {
    const onValueChange = vi.fn<(value: GridSize) => void>();
    await openPicker({ defaultValue: { columns: 4, rows: 3 }, onValueChange });
    const columns = screen.getByRole("textbox", { name: "Columns" });
    fireEvent.change(columns, { target: { value: "14" } });
    expect(onValueChange).toHaveBeenLastCalledWith({ columns: 14, rows: 3 });
    const rows = screen.getByRole("textbox", { name: "Rows" });
    fireEvent.change(rows, { target: { value: "9" } });
    expect(onValueChange).toHaveBeenLastCalledWith({ columns: 14, rows: 9 });
  });

  it("hides the rows field while rows are auto", async () => {
    await openPicker({ defaultValue: { columns: 4, rows: "auto" } });
    expect(screen.queryByRole("textbox", { name: "Rows" })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Row sizing" }).textContent,
    ).toContain("Auto");
  });
});

describe("GridSizePicker settings", () => {
  it("closes and calls onOpenSettings", async () => {
    const onOpenSettings = vi.fn();
    await openPicker({ onOpenSettings });
    await act(async () =>
      press(screen.getByRole("button", { name: "Open grid settings" })),
    );
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
  });

  it("takes its copy from labels", async () => {
    await openPicker({
      labels: { popup: "Layout grid", openSettings: "More grid options" },
    });
    expect(
      screen.getByRole("button", { name: "More grid options" }),
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Layout grid" })).toBeTruthy();
  });
});
