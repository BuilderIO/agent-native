// @vitest-environment happy-dom

/**
 * Gesture-lifecycle tests for GradientEditor's `onCommit` (added alongside
 * this test): `onChange` alone fires on every stop-drag / angle-drag
 * pointermove tick (cheap live preview), while `onCommit` must fire exactly
 * once per gesture — mirroring the onChange/onChangeComplete split already
 * used by DesignColorPicker and the preview/commit `phase` split used by
 * ScrubInput (see ScrubInput.gesture.test.ts). Before this fix, GradientEditor
 * had no way at all to signal "this gesture is done" — every discrete action
 * (add/remove a stop, drag a stop, drag the angle dial, commit a position/
 * angle field) only ever called `onChange`, so a caller wired to persist on
 * "commit" (like DesignColorPicker's `notifyChangeComplete`) never fired
 * during gradient editing, or — if a caller (mis)treated every onChange as a
 * commit — persisted a new history entry on every single pointermove tick of
 * a drag ("commit storm").
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: ({ children }: { children?: unknown }) => children as never,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

import { GradientEditor, type GradientValue } from "./GradientEditor";

const baseValue: GradientValue = {
  kind: "linear",
  angle: 90,
  stops: [
    { id: "a", color: "#ff0000", position: 0 },
    { id: "b", color: "#0000ff", position: 100 },
  ],
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // The bar's position math (`positionFromPointer`) divides by the bar's
  // measured width, which happy-dom reports as 0 with no layout engine —
  // stub a fixed 200px-wide rect starting at x=0 so clientX maps to a
  // predictable 0-100 position.
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 16,
      width: 200,
      height: 16,
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

function pointerEvent(
  type: string,
  init: { clientX: number; pointerId?: number },
) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    pointerId: init.pointerId ?? 1,
  });
}

describe("GradientEditor onCommit", () => {
  it("fires onChange on every tick but onCommit exactly once when dragging a stop handle", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <GradientEditor
          value={baseValue}
          onChange={onChange}
          onCommit={onCommit}
          selectedStopId="a"
          onSelectStop={vi.fn()}
        />,
      );
    });

    const handle = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="#ff0000"]',
    );
    expect(handle).not.toBeNull();

    act(() => {
      handle!.dispatchEvent(pointerEvent("pointerdown", { clientX: 0 }));
      handle!.dispatchEvent(pointerEvent("pointermove", { clientX: 20 }));
      handle!.dispatchEvent(pointerEvent("pointermove", { clientX: 40 }));
      handle!.dispatchEvent(pointerEvent("pointerup", { clientX: 40 }));
    });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does not fire onCommit for a plain click-to-select with no movement", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <GradientEditor
          value={baseValue}
          onChange={onChange}
          onCommit={onCommit}
          selectedStopId="a"
          onSelectStop={vi.fn()}
        />,
      );
    });

    const handle = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="#0000ff"]',
    );
    expect(handle).not.toBeNull();

    act(() => {
      handle!.dispatchEvent(pointerEvent("pointerdown", { clientX: 200 }));
      handle!.dispatchEvent(pointerEvent("pointerup", { clientX: 200 }));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("fires onChange and onCommit exactly once when adding a stop via a bar click", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <GradientEditor
          value={baseValue}
          onChange={onChange}
          onCommit={onCommit}
          selectedStopId="a"
          onSelectStop={vi.fn()}
        />,
      );
    });

    const bar = container.querySelector<HTMLDivElement>(
      '[aria-label="Gradient stops"]',
    );
    expect(bar).not.toBeNull();

    act(() => {
      bar!.dispatchEvent(pointerEvent("pointerdown", { clientX: 100 }));
      bar!.dispatchEvent(pointerEvent("pointerup", { clientX: 100 }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("fires onCommit exactly once when removing the selected stop via the trash button", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    // removeStop no-ops at exactly 2 stops (a gradient needs at least 2), so
    // this needs a 3rd stop for the remove button to actually be enabled.
    const threeStopValue: GradientValue = {
      ...baseValue,
      stops: [...baseValue.stops, { id: "c", color: "#00ff00", position: 50 }],
    };

    act(() => {
      root.render(
        <GradientEditor
          value={threeStopValue}
          onChange={onChange}
          onCommit={onCommit}
          selectedStopId="c"
          onSelectStop={vi.fn()}
        />,
      );
    });

    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove stop"]',
    );
    expect(removeButton).not.toBeNull();

    act(() => removeButton!.click());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("removes a stop on Backspace/Delete when its handle is focused", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const threeStopValue: GradientValue = {
      ...baseValue,
      stops: [...baseValue.stops, { id: "c", color: "#00ff00", position: 50 }],
    };

    act(() => {
      root.render(
        <GradientEditor
          value={threeStopValue}
          onChange={onChange}
          onCommit={onCommit}
          selectedStopId="c"
          onSelectStop={vi.fn()}
        />,
      );
    });

    const handle = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="#00ff00"]',
    );
    expect(handle).not.toBeNull();

    act(() => {
      handle!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
      );
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].stops).toHaveLength(2);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("nudges a focused stop's position by 1 with ArrowRight/ArrowLeft and commits once per press", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <GradientEditor
          value={baseValue}
          onChange={onChange}
          onCommit={onCommit}
          selectedStopId="a"
          onSelectStop={vi.fn()}
        />,
      );
    });

    const handle = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="#ff0000"]',
    );
    expect(handle).not.toBeNull();

    act(() => {
      handle!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const updatedStops = onChange.mock.calls[0][0].stops as Array<{
      id: string;
      position: number;
    }>;
    expect(updatedStops.find((s) => s.id === "a")?.position).toBe(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does not fire onCommit when the angle field is focused and blurred without editing", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <GradientEditor
          value={baseValue}
          onChange={onChange}
          onCommit={onCommit}
          selectedStopId="a"
          onSelectStop={vi.fn()}
        />,
      );
    });

    const angleField = container.querySelector<HTMLInputElement>(
      'input[aria-label="Gradient angle"]',
    );
    expect(angleField).not.toBeNull();

    act(() => {
      // React implements onBlur via the native (bubbling) "focusout" event
      // rather than "blur" (which doesn't bubble) — see React's
      // SimpleEventPlugin. Dispatch that here so the synthetic handler
      // actually fires.
      angleField!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      angleField!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("fires onCommit exactly once when the angle field is edited and blurred", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <GradientEditor
          value={baseValue}
          onChange={onChange}
          onCommit={onCommit}
          selectedStopId="a"
          onSelectStop={vi.fn()}
        />,
      );
    });

    const angleField = container.querySelector<HTMLInputElement>(
      'input[aria-label="Gradient angle"]',
    );
    expect(angleField).not.toBeNull();

    act(() => {
      // Bypass React's tracked-value setter so the synthetic onChange
      // handler actually observes the new value (a plain `.value =`
      // assignment followed by a bare "input" event dispatch is a no-op
      // under React's controlled-input change detection).
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(angleField, "180");
      angleField!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      angleField!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
