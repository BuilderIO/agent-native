// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AlignmentPicker,
  type AlignmentPickerProps,
  type AlignmentValue,
} from "./alignment-picker.js";

afterEach(cleanup);

function focused(): Element {
  const element = document.activeElement;
  if (element === null) throw new Error("Nothing is focused.");
  return element;
}

function Example(props: Partial<AlignmentPickerProps>) {
  return <AlignmentPicker aria-label="Alignment" {...props} />;
}

const radioNames = () =>
  screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"));

const checkedName = () =>
  screen
    .getAllByRole("radio")
    .find((radio) => radio.getAttribute("aria-checked") === "true")
    ?.getAttribute("aria-label");

describe("AlignmentPicker part", () => {
  it("writes its props, surface row by default", () => {
    render(<Example />);
    const group = screen.getByRole("radiogroup", { name: "Alignment" });
    expect(group.classList.contains("alignment-picker")).toBe(true);
    expect(group.dataset.variant).toBe("surface");
    expect(group.dataset.direction).toBe("row");
    expect(group.dataset.justify).toBe("start");
    expect(group.dataset.align).toBe("start");
  });

  it("refuses a direction it doesn't have", () => {
    const props = { direction: "grid" } as unknown as AlignmentPickerProps;
    expect(() => render(<Example {...props} />)).toThrow(
      /direction="grid" is not one of/,
    );
  });

  it("names nine radios by position, top left to bottom right", () => {
    render(<Example />);
    expect(radioNames()).toEqual([
      "Top left",
      "Top center",
      "Top right",
      "Center left",
      "Center",
      "Center right",
      "Bottom left",
      "Bottom center",
      "Bottom right",
    ]);
  });

  it("keeps one tab stop, on the checked radio", () => {
    render(<Example defaultValue={{ justify: "end", align: "center" }} />);
    const stops = screen
      .getAllByRole("radio")
      .filter((radio) => radio.tabIndex === 0);
    expect(stops.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Center right",
    ]);
  });
});

describe("AlignmentPicker value mapping", () => {
  it.each<[AlignmentValue, "row" | "column", string]>([
    [{ justify: "start", align: "start" }, "row", "Top left"],
    [{ justify: "end", align: "start" }, "row", "Top right"],
    [{ justify: "center", align: "end" }, "row", "Bottom center"],
    [{ justify: "end", align: "start" }, "column", "Bottom left"],
    [{ justify: "start", align: "end" }, "column", "Top right"],
    [{ justify: "center", align: "baseline" }, "row", "Top center"],
  ])("checks %j in a %s layout at %s", (value, direction, name) => {
    render(<Example value={value} direction={direction} />);
    expect(checkedName()).toBe(name);
  });

  it("reports justify along the main axis and align across it", () => {
    const onValueChange = vi.fn();
    const { unmount } = render(<Example onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Bottom right" }));
    expect(onValueChange).toHaveBeenLastCalledWith({
      justify: "end",
      align: "end",
    });
    fireEvent.click(screen.getByRole("radio", { name: "Top center" }));
    expect(onValueChange).toHaveBeenLastCalledWith({
      justify: "center",
      align: "start",
    });
    unmount();
    render(<Example direction="column" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Top center" }));
    expect(onValueChange).toHaveBeenLastCalledWith({
      justify: "start",
      align: "center",
    });
  });

  it("collapses to three cells across the main axis for space-between", () => {
    const onValueChange = vi.fn();
    render(
      <Example
        defaultValue={{ justify: "space-between", align: "center" }}
        onValueChange={onValueChange}
      />,
    );
    expect(radioNames()).toEqual(["Top", "Center", "Bottom"]);
    expect(checkedName()).toBe("Center");
    const bottom = screen.getByRole("radio", { name: "Bottom" });
    expect(bottom.dataset.column).toBe("all");
    fireEvent.click(bottom);
    expect(onValueChange).toHaveBeenLastCalledWith({
      justify: "space-between",
      align: "end",
    });
  });

  it("keeps nine cells for stretch, checking the centre of the main position", () => {
    render(
      <Example
        direction="column"
        defaultValue={{ justify: "end", align: "stretch" }}
      />,
    );
    expect(radioNames()).toHaveLength(9);
    expect(checkedName()).toBe("Bottom center");
    expect(screen.getByRole("radiogroup").dataset.align).toBe("stretch");
  });

  it("switches a cell to space-between and back on double-click", () => {
    const onValueChange = vi.fn();
    render(<Example onValueChange={onValueChange} />);
    fireEvent.doubleClick(screen.getByRole("radio", { name: "Bottom right" }));
    expect(onValueChange).toHaveBeenLastCalledWith({
      justify: "space-between",
      align: "end",
    });
    expect(radioNames()).toEqual(["Top", "Center", "Bottom"]);
    expect(checkedName()).toBe("Bottom");
    fireEvent.doubleClick(screen.getByRole("radio", { name: "Bottom" }));
    expect(onValueChange).toHaveBeenLastCalledWith({
      justify: "center",
      align: "end",
    });
    expect(checkedName()).toBe("Bottom center");
  });

  it.each<["row" | "column", number, number, AlignmentValue["justify"]]>([
    ["row", 10, 0, "start"],
    ["row", 50, 0, "center"],
    ["row", 90, 0, "end"],
    ["column", 0, 10, "start"],
    ["column", 0, 90, "end"],
  ])(
    "returns a %s layout from space-between to the position under the pointer (%i, %i)",
    (direction, clientX, clientY, justify) => {
      const onValueChange = vi.fn();
      render(
        <Example
          direction={direction}
          defaultValue={{ justify: "space-between", align: "start" }}
          onValueChange={onValueChange}
        />,
      );
      const cell = screen.getByRole("radio", {
        name: direction === "row" ? "Top" : "Left",
      });
      vi.spyOn(cell, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 0, width: 100, height: 100 }),
      );
      fireEvent.doubleClick(cell, { clientX, clientY });
      expect(onValueChange).toHaveBeenLastCalledWith({
        justify,
        align: "start",
      });
    },
  );

  it("keeps stretch when its checked cell switches to space-between", () => {
    const onValueChange = vi.fn();
    render(
      <Example
        defaultValue={{ justify: "start", align: "stretch" }}
        onValueChange={onValueChange}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("radio", { name: "Center left" }));
    expect(onValueChange).toHaveBeenLastCalledWith({
      justify: "space-between",
      align: "stretch",
    });
  });

  it("takes its names from getCellLabel", () => {
    render(
      <Example
        getCellLabel={({ row, column }) => `${row ?? "*"}/${column ?? "*"}`}
      />,
    );
    expect(radioNames()[0]).toBe("start/start");
    expect(radioNames()[8]).toBe("end/end");
  });
});

describe("AlignmentPicker keyboard", () => {
  it("preserves focus and value during assistive navigation", () => {
    const onValueChange = vi.fn();
    render(<Example onValueChange={onValueChange} />);
    const current = screen.getByRole("radio", { name: "Top left" });
    current.focus();
    expect(
      fireEvent.keyDown(current, {
        key: "ArrowRight",
        altKey: true,
        ctrlKey: true,
      }),
    ).toBe(true);
    expect(document.activeElement).toBe(current);
    expect(onValueChange).not.toHaveBeenCalled();
  });
  it("moves and checks in two dimensions, stopping at the edges", () => {
    const onValueChange = vi.fn();
    render(<Example onValueChange={onValueChange} />);
    const topLeft = screen.getByRole("radio", { name: "Top left" });
    topLeft.focus();
    fireEvent.keyDown(topLeft, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Top center",
    );
    expect(checkedName()).toBe("Top center");
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    expect(checkedName()).toBe("Bottom center");
    expect(onValueChange).toHaveBeenLastCalledWith({
      justify: "center",
      align: "end",
    });
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    expect(checkedName()).toBe("Bottom center");
    expect(onValueChange).toHaveBeenCalledTimes(3);
  });

  it("moves only along the axis a collapsed matrix still has", () => {
    render(
      <Example defaultValue={{ justify: "space-between", align: "start" }} />,
    );
    const top = screen.getByRole("radio", { name: "Top" });
    top.focus();
    fireEvent.keyDown(top, { key: "ArrowRight" });
    expect(checkedName()).toBe("Top");
    fireEvent.keyDown(top, { key: "ArrowDown" });
    expect(checkedName()).toBe("Center");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Center");
  });

  it("switches to space-between on Enter and keeps focus on the checked cell", () => {
    render(<Example defaultValue={{ justify: "center", align: "start" }} />);
    const cell = screen.getByRole("radio", { name: "Top center" });
    cell.focus();
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(checkedName()).toBe("Top");
    expect(focused().getAttribute("aria-label")).toBe("Top");
    fireEvent.keyDown(focused(), { key: "Enter", repeat: true });
    expect(checkedName()).toBe("Top");
    fireEvent.keyDown(focused(), { key: "Enter" });
    expect(checkedName()).toBe("Top center");
    expect(focused().getAttribute("aria-label")).toBe("Top center");
  });

  it("keeps focus inside an externally reconfigured matrix", () => {
    const { rerender } = render(
      <Example value={{ justify: "center", align: "end" }} />,
    );
    screen.getByRole("radio", { name: "Bottom center" }).focus();
    rerender(<Example value={{ justify: "space-between", align: "end" }} />);
    expect(focused()).toBe(screen.getByRole("radio", { name: "Bottom" }));
    rerender(
      <Example
        direction="column"
        value={{ justify: "space-between", align: "end" }}
      />,
    );
    expect(focused()).toBe(screen.getByRole("radio", { name: "Right" }));
  });

  it("restores keyboard focus after the matrix changes inside a shadow root", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = host.attachShadow({ mode: "open" });
    const container = root.appendChild(document.createElement("div"));
    const view = render(<Example />, { container });
    try {
      const controls = within(container);
      const first = controls.getByRole("radio", { name: "Top left" });
      first.focus();
      fireEvent.keyDown(first, { key: "Enter" });
      const top = controls.getByRole("radio", { name: "Top" });
      expect(root.activeElement).toBe(top);
      fireEvent.keyDown(top, { key: "ArrowDown" });
      expect(root.activeElement).toBe(
        controls.getByRole("radio", { name: "Center" }),
      );
    } finally {
      view.unmount();
      host.remove();
    }
  });

  it("leaves focus on the next control when a deferred change arrives", () => {
    const panel = (justify: AlignmentValue["justify"]) => (
      <>
        <Example value={{ justify, align: "start" }} />
        <button>Next property</button>
      </>
    );
    const { rerender } = render(panel("center"));
    const radio = screen.getByRole("radio", { name: "Top center" });
    radio.focus();
    fireEvent.keyDown(radio, { key: "Enter" });
    const next = screen.getByRole("button", { name: "Next property" });
    next.focus();
    rerender(panel("space-between"));
    expect(focused()).toBe(next);
  });

  it("disables every radio when disabled", () => {
    const onValueChange = vi.fn();
    render(<Example disabled onValueChange={onValueChange} />);
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByRole("radiogroup").hasAttribute("data-disabled")).toBe(
      true,
    );
  });
});
