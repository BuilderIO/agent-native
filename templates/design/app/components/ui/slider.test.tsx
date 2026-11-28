// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Slider } from "./slider";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;

function makePointerEvent(
  type: string,
  init: {
    clientX?: number;
    button?: number;
    pointerId?: number;
  } = {},
) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: 10,
    button: init.button ?? 0,
    pointerId: init.pointerId ?? 1,
  });
}

function ControlledSlider({
  initial = 50,
  ariaLabel = "Opacity",
  thumbAriaLabel,
  onValueChange,
  onValueCommit,
}: {
  initial?: number;
  ariaLabel?: string;
  thumbAriaLabel?: string;
  onValueChange?: (values: number[]) => void;
  onValueCommit?: (values: number[]) => void;
}) {
  const [val, setVal] = useState([initial]);
  return (
    <Slider
      aria-label={ariaLabel}
      {...(thumbAriaLabel !== undefined ? { thumbAriaLabel } : {})}
      min={0}
      max={100}
      step={1}
      value={val}
      onValueChange={(next) => {
        setVal(next);
        onValueChange?.(next);
      }}
      {...(onValueCommit !== undefined ? { onValueCommit } : {})}
    />
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 20,
      width: 200,
      height: 20,
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

describe("Slider pointer-capture and input resilience", () => {
  it("forwards aria-label to the slider thumb for accessible queries", () => {
    act(() => {
      root.render(<ControlledSlider ariaLabel="Blur radius" />);
    });
    const thumb = container.querySelector('[role="slider"]');
    expect(thumb?.getAttribute("aria-label")).toBe("Blur radius");
  });

  it("ignores right-click without changing or committing the value", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <ControlledSlider onValueChange={onChange} onValueCommit={onCommit} />,
      );
    });
    const sliderRoot = container.firstElementChild as HTMLElement;

    act(() => {
      sliderRoot.dispatchEvent(
        makePointerEvent("pointerdown", { clientX: 180, button: 2 }),
      );
      sliderRoot.dispatchEvent(
        makePointerEvent("pointerup", { clientX: 180, button: 2 }),
      );
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the dragged value exactly once when pointer capture is lost mid-drag", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <ControlledSlider onValueChange={onChange} onValueCommit={onCommit} />,
      );
    });
    const sliderRoot = container.firstElementChild as HTMLElement;

    let captured = false;
    sliderRoot.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    sliderRoot.hasPointerCapture = vi.fn(() => captured);
    sliderRoot.releasePointerCapture = vi.fn(() => {
      captured = false;
    });

    act(() => {
      sliderRoot.dispatchEvent(
        makePointerEvent("pointerdown", { clientX: 100 }),
      );
      sliderRoot.dispatchEvent(
        makePointerEvent("pointermove", { clientX: 160 }),
      );
      captured = false;
      sliderRoot.dispatchEvent(makePointerEvent("lostpointercapture"));
      sliderRoot.dispatchEvent(makePointerEvent("pointerup", { clientX: 160 }));
    });

    expect(onChange).toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([80]);

    const thumb = container.querySelector<HTMLElement>('[role="slider"]');
    expect(thumb).not.toBeNull();
    if (!thumb) throw new Error("Missing slider thumb");
    act(() => {
      thumb.focus();
      thumb.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith([81]);
  });

  it("does not commit after pointercancel", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <ControlledSlider onValueChange={onChange} onValueCommit={onCommit} />,
      );
    });
    const sliderRoot = container.firstElementChild as HTMLElement;

    act(() => {
      sliderRoot.dispatchEvent(
        makePointerEvent("pointerdown", { clientX: 100 }),
      );
      sliderRoot.dispatchEvent(
        makePointerEvent("pointermove", { clientX: 150 }),
      );
      sliderRoot.dispatchEvent(makePointerEvent("pointercancel"));
      sliderRoot.dispatchEvent(makePointerEvent("lostpointercapture"));
    });

    expect(onCommit).not.toHaveBeenCalled();
  });
});
