// @vitest-environment happy-dom

/**
 * The gradient pane: pins above the bar (a click on the bar adds one, a drag
 * moves one, Backspace removes one while two or more remain), and the Stops
 * list with a row per stop: `0% · swatch · 171717 · 100 % · −`.
 */

import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: ({ children }: { children?: unknown }) => children as never,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

import type { RenderNestedColorPicker } from "./color-picker-nested";
import {
  GradientEditor,
  nextStopPosition,
  type GradientValue,
} from "./GradientEditor";

const twoStops: GradientValue = {
  kind: "linear",
  angle: 90,
  stops: [
    { id: "a", color: "#171717", position: 0 },
    { id: "b", color: "#0a6bd6", position: 100 },
  ],
};

const threeStops: GradientValue = {
  ...twoStops,
  stops: [...twoStops.stops, { id: "c", color: "#00ff00", position: 50 }],
};

const last = <T,>(items: readonly T[]): T | undefined =>
  items[items.length - 1];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 24,
      width: 200,
      height: 24,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  act(() => root.unmount());
  container.remove();
});

function pointer(type: string, clientX: number) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    pointerId: 1,
  });
}

function Controlled({
  initial,
  onChange,
  onCommit,
  typeControl,
  renderColorPicker,
}: {
  initial: GradientValue;
  onChange?: (value: GradientValue) => void;
  onCommit?: () => void;
  typeControl?: ReactNode;
  renderColorPicker?: RenderNestedColorPicker;
}) {
  const [value, setValue] = useState(initial);
  const [selected, setSelected] = useState(initial.stops[0]!.id);
  return (
    <GradientEditor
      value={value}
      selectedStopId={selected}
      onSelectStop={setSelected}
      typeControl={typeControl}
      renderColorPicker={renderColorPicker}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
      onCommit={onCommit}
    />
  );
}

const rows = () =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-stop-row]"));
const pins = () =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  );
const field = (row: HTMLElement, label: string) =>
  row.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

function typeInto(input: HTMLInputElement, text: string, key = "Enter") {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("Stops list", () => {
  it("has a row per stop in position order, in each color's own notation", () => {
    act(() =>
      root.render(
        <GradientEditor
          value={{
            ...twoStops,
            stops: [
              { id: "b", color: "oklch(72.4% 0.181 153)", position: 100 },
              { id: "a", color: "rgba(23, 23, 23, 0.5)", position: 0 },
            ],
          }}
          selectedStopId="a"
          onSelectStop={vi.fn()}
          onChange={vi.fn()}
        />,
      ),
    );

    const [first, second] = rows();
    expect(field(first!, "Stop position").value).toBe("0");
    expect(field(first!, "Stop color").value).toBe("171717");
    expect(field(first!, "Stop opacity").value).toBe("50");
    expect(field(second!, "Stop position").value).toBe("100");
    expect(field(second!, "Stop color").value).toBe("oklch(72.4% 0.181 153)");
    expect(first!.hasAttribute("data-selected")).toBe(true);
    expect(second!.hasAttribute("data-selected")).toBe(false);
  });

  it("writes a typed color back in the notation it was typed in, keeping the stop's opacity", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() =>
      root.render(
        <Controlled
          initial={{
            ...twoStops,
            stops: [
              { id: "a", color: "rgba(23, 23, 23, 0.5)", position: 0 },
              { id: "b", color: "#0a6bd6", position: 100 },
            ],
          }}
          onChange={onChange}
          onCommit={onCommit}
        />,
      ),
    );

    typeInto(field(rows()[0]!, "Stop color"), "FF0000");

    const written = last(onChange.mock.calls)![0] as GradientValue;
    expect(written.stops.find((stop) => stop.id === "a")?.color).toBe(
      "rgba(255, 0, 0, 0.5)",
    );
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("drops a color that does not parse instead of writing it", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(<Controlled initial={twoStops} onChange={onChange} />),
    );

    typeInto(field(rows()[0]!, "Stop color"), "not a color");

    expect(onChange).not.toHaveBeenCalled();
    expect(field(rows()[0]!, "Stop color").value).toBe("171717");
  });

  it("changes one stop's opacity from its row", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(<Controlled initial={twoStops} onChange={onChange} />),
    );

    typeInto(field(rows()[1]!, "Stop opacity"), "40");

    const written = last(onChange.mock.calls)![0] as GradientValue;
    expect(written.stops.find((stop) => stop.id === "b")?.color).toBe(
      "rgba(10, 107, 214, 0.4)",
    );
  });

  it("moves a stop from its position field and commits once", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() =>
      root.render(
        <Controlled
          initial={twoStops}
          onChange={onChange}
          onCommit={onCommit}
        />,
      ),
    );

    typeInto(field(rows()[0]!, "Stop position"), "30");

    const written = last(onChange.mock.calls)![0] as GradientValue;
    expect(written.stops.find((stop) => stop.id === "a")?.position).toBe(30);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("Add stop puts a new stop halfway across the widest gap, colored from its neighbours", () => {
    expect(
      nextStopPosition([
        { id: "a", color: "#000000", position: 0 },
        { id: "b", color: "#000000", position: 20 },
        { id: "c", color: "#000000", position: 100 },
      ]),
    ).toBe(60);

    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() =>
      root.render(
        <Controlled
          initial={twoStops}
          onChange={onChange}
          onCommit={onCommit}
        />,
      ),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Add stop"]')!
        .click(),
    );

    const written = last(onChange.mock.calls)![0] as GradientValue;
    expect(written.stops).toHaveLength(3);
    const added = written.stops.find(
      (stop) => stop.id !== "a" && stop.id !== "b",
    );
    expect(added?.position).toBe(50);
    expect(added?.color).toBe("#114177");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(3);
    expect(
      rows()
        .find((row) => row.dataset.stopId === added?.id)
        ?.hasAttribute("data-selected"),
    ).toBe(true);
  });

  it("removes a stop from its row, and never the second-to-last", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(<Controlled initial={threeStops} onChange={onChange} />),
    );
    const removeButtons = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="Remove stop"]',
        ),
      );

    // Rows are in position order: a (0), c (50), b (100).
    act(() => removeButtons()[1]!.click());
    const written = last(onChange.mock.calls)![0] as GradientValue;
    expect(written.stops.map((stop) => stop.id).sort()).toEqual(["a", "b"]);

    expect(removeButtons().every((button) => button.disabled)).toBe(true);
    onChange.mockClear();
    act(() => removeButtons()[0]!.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });
});

describe("pins and bar", () => {
  it("adds a pin where the bar is clicked, in the gradient's own color there", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() =>
      root.render(
        <Controlled
          initial={twoStops}
          onChange={onChange}
          onCommit={onCommit}
        />,
      ),
    );
    const bar = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Gradient stops"]',
    )!;

    act(() => {
      bar.dispatchEvent(pointer("pointerdown", 150));
      bar.dispatchEvent(pointer("pointerup", 150));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const written = onChange.mock.calls[0]![0] as GradientValue;
    expect(written.stops).toHaveLength(3);
    const added = written.stops.find(
      (stop) => stop.id !== "a" && stop.id !== "b",
    );
    expect(added?.position).toBe(75);
    expect(added?.color).toBe("#0d56a6");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(pins()).toHaveLength(3);
  });

  it("moves a pin with the pointer, one change per tick and one commit", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() =>
      root.render(
        <Controlled
          initial={twoStops}
          onChange={onChange}
          onCommit={onCommit}
        />,
      ),
    );
    const pin = pins()[0]!;

    act(() => {
      pin.dispatchEvent(pointer("pointerdown", 0));
      pin.dispatchEvent(pointer("pointermove", 40));
      pin.dispatchEvent(pointer("pointermove", 60));
      pin.dispatchEvent(pointer("pointerup", 60));
    });

    expect(onChange).toHaveBeenCalledTimes(2);
    const written = last(onChange.mock.calls)![0] as GradientValue;
    expect(written.stops.find((stop) => stop.id === "a")?.position).toBe(30);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("Backspace removes a focused pin while two or more would remain", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(<Controlled initial={threeStops} onChange={onChange} />),
    );
    const middle = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="#00ff00"]',
    )!;
    act(() => {
      middle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Backspace",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      (onChange.mock.calls[0]![0] as GradientValue).stops.map((s) => s.id),
    ).toEqual(["a", "b"]);

    const last = pins()[0]!;
    onChange.mockClear();
    act(() => {
      last.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Backspace",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(pins()).toHaveLength(2);
  });

  it("Backspace on a row removes the selected stop, but not while typing in a field", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(<Controlled initial={threeStops} onChange={onChange} />),
    );

    act(() => {
      field(rows()[0]!, "Stop color").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Backspace",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();

    const swatch = rows()[0]!.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit stop color"]',
    )!;
    swatch.disabled = false;
    act(() => {
      swatch.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Backspace",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      (onChange.mock.calls[0]![0] as GradientValue).stops.map((s) => s.id),
    ).toEqual(["b", "c"]);
  });
});

describe("reverse and rotate", () => {
  it("reverse mirrors every stop across the bar and commits once", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() =>
      root.render(
        <Controlled
          initial={{
            ...twoStops,
            stops: [
              { id: "a", color: "#171717", position: 20 },
              { id: "b", color: "#0a6bd6", position: 90 },
            ],
          }}
          onChange={onChange}
          onCommit={onCommit}
        />,
      ),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reverse stops"]')!
        .click(),
    );
    const written = last(onChange.mock.calls)![0] as GradientValue;
    expect(written.stops.map((stop) => [stop.id, stop.position])).toEqual([
      ["a", 80],
      ["b", 10],
    ]);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("rotate adds 90 degrees to a linear gradient, and is off for a radial one", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <Controlled
          initial={{ ...twoStops, angle: 315 }}
          onChange={onChange}
        />,
      ),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Rotate gradient"]',
        )!
        .click(),
    );
    expect((last(onChange.mock.calls)![0] as GradientValue).angle).toBe(45);

    act(() =>
      root.render(
        <GradientEditor
          value={{ ...twoStops, kind: "radial" }}
          selectedStopId="a"
          onSelectStop={vi.fn()}
          onChange={vi.fn()}
        />,
      ),
    );
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Rotate gradient"]',
      )!.disabled,
    ).toBe(true);
    expect(container.querySelector('input[aria-label="Gradient angle"]')).toBe(
      null,
    );
  });
});

describe("a stop's color picker", () => {
  it("asks for the picker beside the panel, level with the row, and writes its changes to that stop", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const requests: Array<Parameters<RenderNestedColorPicker>[0]> = [];
    const renderColorPicker: RenderNestedColorPicker = (request) => {
      requests.push(request);
      return <div data-testid="nested-picker" />;
    };
    act(() =>
      root.render(
        <Controlled
          initial={twoStops}
          onChange={onChange}
          onCommit={onCommit}
          renderColorPicker={renderColorPicker}
        />,
      ),
    );
    expect(container.querySelector('[data-testid="nested-picker"]')).toBeNull();

    act(() =>
      rows()[1]!
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Edit stop color"]',
        )!
        .click(),
    );

    const request = last(requests)!;
    expect(
      container.querySelector('[data-testid="nested-picker"]'),
    ).not.toBeNull();
    expect(request.anchor).toBe(rows()[1]);
    expect(request.css).toBe("#0a6bd6");
    expect(request.opaqueSrgb).toBeUndefined();

    act(() => request.onChange("#112233"));
    expect(
      (last(onChange.mock.calls)![0] as GradientValue).stops.find(
        (stop) => stop.id === "b",
      )?.color,
    ).toBe("#112233");
    expect(onCommit).not.toHaveBeenCalled();

    act(() => last(requests)!.onCommit("#445566"));
    expect(onCommit).toHaveBeenCalledTimes(1);

    act(() => last(requests)!.onClose());
    expect(container.querySelector('[data-testid="nested-picker"]')).toBeNull();
  });

  it("is only a swatch when the pane cannot open one", () => {
    act(() => root.render(<Controlled initial={twoStops} />));
    const swatch = rows()[0]!.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit stop color"]',
    )!;
    expect(swatch.disabled).toBe(true);
  });
});
