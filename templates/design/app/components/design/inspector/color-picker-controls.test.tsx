// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ColorTrack,
  SaturationBrightnessField,
  ScrubbyNumberInput,
} from "./color-picker-controls";
import type { HsvaColor } from "./color-picker-utils";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;
let mockRect = { width: 200, height: 200 };

function requireElement<T extends Element>(
  parent: ParentNode,
  selector: string,
): T {
  const el = parent.querySelector<T>(selector);
  expect(el).not.toBeNull();
  if (!el) throw new Error(`Missing element for selector: ${selector}`);
  return el;
}

function makePointerEvent(
  type: string,
  init: {
    clientX?: number;
    clientY?: number;
    button?: number;
    buttons?: number;
    pointerId?: number;
  } = {},
) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    buttons: init.buttons ?? (type === "pointerup" ? 0 : 1),
    pointerId: init.pointerId ?? 1,
  });
}

beforeEach(() => {
  mockRect = { width: 200, height: 200 };
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
      right: mockRect.width,
      bottom: mockRect.height,
      width: mockRect.width,
      height: mockRect.height,
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
  vi.restoreAllMocks();
});

describe("SaturationBrightnessField pointer resilience", () => {
  const initial: HsvaColor = { h: 200, s: 50, v: 50, a: 1 };

  it("commits once and stops dragging on lostpointercapture", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <SaturationBrightnessField
          hsv={initial}
          label="Saturation and brightness"
          disabled={false}
          onChange={onChange}
          onCommit={onCommit}
        />,
      );
    });
    const field = requireElement<HTMLDivElement>(
      container,
      '[aria-label="Saturation and brightness"]',
    );

    act(() => {
      field.dispatchEvent(
        makePointerEvent("pointerdown", { clientX: 100, clientY: 100 }),
      );
      field.dispatchEvent(
        makePointerEvent("pointermove", { clientX: 160, clientY: 40 }),
      );
      field.dispatchEvent(makePointerEvent("lostpointercapture"));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const changesBeforeHover = onChange.mock.calls.length;
    expect(changesBeforeHover).toBe(2);

    act(() => {
      field.dispatchEvent(
        makePointerEvent("pointermove", { clientX: 20, clientY: 180 }),
      );
      field.dispatchEvent(
        makePointerEvent("pointerup", { clientX: 20, clientY: 180 }),
      );
    });
    expect(onChange).toHaveBeenCalledTimes(changesBeforeHover);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("falls back to window pointer listeners when setPointerCapture throws DOMException", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <SaturationBrightnessField
          hsv={initial}
          label="Saturation and brightness"
          disabled={false}
          onChange={onChange}
          onCommit={onCommit}
        />,
      );
    });
    const field = requireElement<HTMLDivElement>(
      container,
      '[aria-label="Saturation and brightness"]',
    );
    field.setPointerCapture = vi.fn(() => {
      throw new DOMException("No active pointer", "NotFoundError");
    });

    act(() => {
      field.dispatchEvent(
        makePointerEvent("pointerdown", { clientX: 40, clientY: 100 }),
      );
      window.dispatchEvent(
        makePointerEvent("pointermove", { clientX: 180, clientY: 20 }),
      );
      window.dispatchEvent(
        makePointerEvent("pointerup", { clientX: 180, clientY: 20 }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith({
      h: 200,
      s: 90,
      v: 90,
      a: 1,
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("ignores non-primary mouse buttons and zero-size rects without emitting NaN", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <SaturationBrightnessField
          hsv={initial}
          label="Saturation and brightness"
          disabled={false}
          onChange={onChange}
          onCommit={onCommit}
        />,
      );
    });
    const field = requireElement<HTMLDivElement>(
      container,
      '[aria-label="Saturation and brightness"]',
    );

    act(() => {
      field.dispatchEvent(
        makePointerEvent("pointerdown", {
          clientX: 100,
          clientY: 100,
          button: 2,
          buttons: 2,
        }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();

    mockRect = { width: 0, height: 0 };
    act(() => {
      field.dispatchEvent(
        makePointerEvent("pointerdown", { clientX: 100, clientY: 100 }),
      );
      field.dispatchEvent(makePointerEvent("pointerup"));
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ColorTrack pointer resilience", () => {
  it("commits once on lostpointercapture and ignores subsequent hover moves", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <ColorTrack
          label="Hue"
          value={90}
          min={0}
          max={360}
          disabled={false}
          backgroundImage="linear-gradient(to right, red, blue)"
          onChange={onChange}
          onCommit={onCommit}
        />,
      );
    });
    const track = requireElement<HTMLDivElement>(
      container,
      '[aria-label="Hue"]',
    );

    act(() => {
      track.dispatchEvent(makePointerEvent("pointerdown", { clientX: 100 }));
      track.dispatchEvent(makePointerEvent("pointermove", { clientX: 150 }));
      track.dispatchEvent(makePointerEvent("lostpointercapture"));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const changes = onChange.mock.calls.length;

    act(() => {
      track.dispatchEvent(makePointerEvent("pointermove", { clientX: 20 }));
      track.dispatchEvent(makePointerEvent("pointerup", { clientX: 20 }));
    });
    expect(onChange).toHaveBeenCalledTimes(changes);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("falls back to window listeners when setPointerCapture throws and ignores right-click", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <ColorTrack
          label="Opacity"
          value={50}
          min={0}
          max={100}
          disabled={false}
          backgroundImage="linear-gradient(to right, transparent, black)"
          onChange={onChange}
          onCommit={onCommit}
        />,
      );
    });
    const track = requireElement<HTMLDivElement>(
      container,
      '[aria-label="Opacity"]',
    );
    track.setPointerCapture = vi.fn(() => {
      throw new DOMException("No active pointer", "NotFoundError");
    });

    act(() => {
      track.dispatchEvent(
        makePointerEvent("pointerdown", {
          clientX: 100,
          button: 2,
          buttons: 2,
        }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      track.dispatchEvent(makePointerEvent("pointerdown", { clientX: 100 }));
      window.dispatchEvent(makePointerEvent("pointermove", { clientX: 192 }));
      window.dispatchEvent(makePointerEvent("pointerup", { clientX: 192 }));
    });
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe("ScrubbyNumberInput pointer & keyboard resilience", () => {
  function ControlledScrub({
    initialValue,
    onChange,
    onCommit,
  }: {
    initialValue: number;
    onChange: (value: number) => void;
    onCommit: () => void;
  }) {
    const [val, setVal] = useState(initialValue);
    return (
      <ScrubbyNumberInput
        aria-label="Red"
        value={val}
        min={0}
        max={255}
        disabled={false}
        onChange={(next) => {
          setVal(next);
          onChange(next);
        }}
        onCommit={onCommit}
      />
    );
  }

  it("commits once on lostpointercapture during scrub without double-committing on blur", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <ControlledScrub
          initialValue={100}
          onChange={onChange}
          onCommit={onCommit}
        />,
      );
    });
    const input = requireElement<HTMLInputElement>(
      container,
      'input[aria-label="Red"]',
    );

    act(() => {
      input.dispatchEvent(makePointerEvent("pointerdown", { clientX: 50 }));
      input.dispatchEvent(makePointerEvent("pointermove", { clientX: 90 }));
      input.dispatchEvent(makePointerEvent("lostpointercapture"));
    });
    expect(onChange).toHaveBeenLastCalledWith(110);
    expect(onCommit).toHaveBeenCalledTimes(1);

    act(() => {
      input.dispatchEvent(makePointerEvent("pointermove", { clientX: 150 }));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith(110);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("steps from current value instead of 0 when pressing ArrowUp on an empty draft", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    act(() => {
      root.render(
        <ControlledScrub
          initialValue={120}
          onChange={onChange}
          onCommit={onCommit}
        />,
      );
    });
    const input = requireElement<HTMLInputElement>(
      container,
      'input[aria-label="Red"]',
    );
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    expect(setValue).toBeDefined();

    act(() => {
      input.focus();
      setValue?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith(121);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
