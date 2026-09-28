// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { DesignColorPicker } from "./DesignColorPicker";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let originalCaptureDescriptors: Record<string, PropertyDescriptor | undefined>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  originalCaptureDescriptors = Object.fromEntries(
    ["hasPointerCapture", "releasePointerCapture", "setPointerCapture"].map(
      (name) => [
        name,
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
      ],
    ),
  );
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value: () => true,
    },
    releasePointerCapture: {
      configurable: true,
      value: () => undefined,
    },
    setPointerCapture: {
      configurable: true,
      value: () => undefined,
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const [name, descriptor] of Object.entries(originalCaptureDescriptors)) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, name, descriptor);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
        name
      ];
    }
  }
  vi.unstubAllGlobals();
});

function pointerEvent(type: string, clientX: number) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: "mouse",
    clientX,
  });
}

describe("DesignColorPicker active opacity gesture cancellation", () => {
  it("restores the gesture start on Undo, suppresses pointer-up commit, and allows a later gesture", async () => {
    const onChange = vi.fn();
    const onChangeComplete = vi.fn();
    const onChangeCancel = vi.fn();

    function PickerHarness() {
      const [value, setValue] = useState("#3b82f6");
      return (
        <TooltipProvider>
          <DesignColorPicker
            value={value}
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
            onChangeComplete={onChangeComplete}
            onChangeCancel={onChangeCancel}
            trigger={<button type="button">Open picker</button>}
          />
        </TooltipProvider>
      );
    }

    await act(() => root.render(<PickerHarness />));
    await act(() =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    const slider = document.querySelector<HTMLDivElement>(
      '[role="slider"][aria-label="Opacity"]',
    );
    expect(slider).not.toBeNull();
    Object.defineProperty(slider!, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 100,
          bottom: 14,
          width: 100,
          height: 14,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    await act(() => slider!.dispatchEvent(pointerEvent("pointerdown", 50)));
    expect(document.activeElement).toBe(slider);
    expect(slider!.getAttribute("aria-valuenow")).toBe("50");

    const undo = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(() => slider!.dispatchEvent(undo));
    expect(undo.defaultPrevented).toBe(true);
    expect(slider!.getAttribute("aria-valuenow")).toBe("100");
    expect(onChangeCancel).toHaveBeenCalledTimes(1);
    expect(onChangeCancel.mock.calls[0]?.[0]).not.toMatch(/0\.5|50%/);
    expect(onChangeComplete).not.toHaveBeenCalled();

    await act(() => slider!.dispatchEvent(pointerEvent("pointerup", 50)));
    expect(onChangeComplete).not.toHaveBeenCalled();

    await act(() => slider!.dispatchEvent(pointerEvent("pointerdown", 40)));
    await act(() => slider!.dispatchEvent(pointerEvent("pointerup", 40)));
    expect(onChangeComplete).toHaveBeenCalledTimes(1);
    expect(onChangeComplete.mock.calls[0]?.[0]).toMatch(/0\.4|40%/);
  });
});
