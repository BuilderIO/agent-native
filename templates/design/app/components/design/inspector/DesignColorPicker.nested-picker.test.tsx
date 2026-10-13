// @vitest-environment happy-dom

/**
 * A gradient stop's swatch opens a second picker beside the panel. The main
 * picker stays the one popover owner; the second is a controlled sibling that
 * Escape closes first, putting the stop's color back, and that a click in the
 * gradient pane closes.
 */

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { parseGradientLayer } from "../edit-panel/fill-gradient-helpers";
import { DesignColorPicker } from "./DesignColorPicker";

const GRADIENT = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";

const last = <T,>(items: readonly T[]): T | undefined =>
  items[items.length - 1];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Harness({
  onPaintValueChange,
  onOpenChange,
}: {
  onPaintValueChange: (css: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = useState(GRADIENT);
  const [open, setOpen] = useState(true);
  return (
    <TooltipProvider>
      <DesignColorPicker
        value={value}
        paintType="linear"
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          setOpen(next);
        }}
        onChange={vi.fn()}
        onPaintValueChange={(css) => {
          onPaintValueChange(css);
          setValue(css);
        }}
        trigger={<button type="button">Open picker</button>}
      />
    </TooltipProvider>
  );
}

const panels = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-design-chrome-region="right-panel"]',
    ),
  );
const stopSwatch = (index: number) =>
  document.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Edit stop color"]',
  )[index]!;

async function flush() {
  // Radix registers its outside-pointer listener on the next tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** A mouse press. Radix dismisses on the click that follows the pointerdown. */
async function press(target: HTMLElement) {
  await act(() => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  await flush();
}

function escape() {
  return act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function renderOpen() {
  const onPaintValueChange = vi.fn();
  const onOpenChange = vi.fn();
  await act(async () =>
    root.render(
      <Harness
        onPaintValueChange={onPaintValueChange}
        onOpenChange={onOpenChange}
      />,
    ),
  );
  await flush();
  return { onPaintValueChange, onOpenChange };
}

async function typeHex(input: HTMLInputElement, hex: string) {
  await act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, hex);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

describe("the gradient pane's nested picker", () => {
  it("keeps the inline color controls out of the gradient pane", async () => {
    await renderOpen();

    expect(panels()).toHaveLength(1);
    for (const inline of [
      'input[aria-label="Hex"]',
      '[role="slider"][aria-label="Opacity"]',
    ]) {
      expect(document.querySelector(inline)).toBeNull();
    }
    expect(document.querySelectorAll("[data-stop-row]")).toHaveLength(2);
  });

  it("opens a second picker for the clicked stop, beside the panel", async () => {
    await renderOpen();

    await act(async () => stopSwatch(1).click());

    expect(panels()).toHaveLength(2);
    const nested = panels()[1]!;
    // The nested picker is the stop's color picker alone: no paint row, no
    // Custom | Libraries header.
    expect(nested.querySelector('button[aria-label="Gradient"]')).toBeNull();
    expect(nested.querySelector('[role="tablist"]')).toBeNull();
    expect(
      nested.querySelector<HTMLInputElement>('input[aria-label="Hex"]')?.value,
    ).toBe("0000FF");
    expect(nested.getAttribute("data-side")).toBe("left");
  });

  it("writes the nested picker's color to that stop only", async () => {
    const { onPaintValueChange } = await renderOpen();
    await act(async () => stopSwatch(1).click());

    const hex = panels()[1]!.querySelector<HTMLInputElement>(
      'input[aria-label="Hex"]',
    )!;
    await typeHex(hex, "00FF00");

    const gradient = parseGradientLayer(
      last(onPaintValueChange.mock.calls)![0],
    );
    expect(gradient?.stops[0]?.color).toBe("#ff0000");
    expect(gradient?.stops[1]?.color).toBe("#00ff00");
  });

  it("Escape closes the nested picker first and puts the stop's color back", async () => {
    const { onPaintValueChange, onOpenChange } = await renderOpen();
    await act(async () => stopSwatch(1).click());
    await typeHex(
      panels()[1]!.querySelector<HTMLInputElement>('input[aria-label="Hex"]')!,
      "00FF00",
    );
    expect(
      parseGradientLayer(last(onPaintValueChange.mock.calls)![0])?.stops[1]
        ?.color,
    ).toBe("#00ff00");

    await escape();

    expect(panels()).toHaveLength(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      parseGradientLayer(last(onPaintValueChange.mock.calls)![0])?.stops[1]
        ?.color,
    ).toBe("#0000ff");

    await escape();

    expect(panels()).toHaveLength(0);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Escape with nothing changed closes the nested picker without writing", async () => {
    const { onPaintValueChange } = await renderOpen();
    await act(async () => stopSwatch(0).click());
    expect(panels()).toHaveLength(2);

    await escape();

    expect(panels()).toHaveLength(1);
    expect(onPaintValueChange).not.toHaveBeenCalled();
  });

  it("a click in the gradient pane closes the nested picker and keeps the panel", async () => {
    const { onPaintValueChange } = await renderOpen();
    await act(async () => stopSwatch(0).click());
    await flush();
    expect(panels()).toHaveLength(2);

    await press(document.querySelector<HTMLElement>("[data-stop-row]")!);

    expect(panels()).toHaveLength(1);
    expect(onPaintValueChange).not.toHaveBeenCalled();
  });

  it("a click inside the nested picker does not close either picker", async () => {
    await renderOpen();
    await act(async () => stopSwatch(0).click());
    await flush();

    await press(
      panels()[1]!.querySelector<HTMLElement>('input[aria-label="Hex"]')!,
    );

    expect(panels()).toHaveLength(2);
  });
});
