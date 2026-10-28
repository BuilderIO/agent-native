// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useForwardCanvasZoom } from "./use-forward-canvas-zoom";

function Harness({ onWheel }: { onWheel: (event: WheelEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useForwardCanvasZoom(ref);
  return (
    <div>
      <div
        ref={(node) => {
          ref.current = node;
          if (!node) return;
          node.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
          node.onwheel = onWheel;
        }}
        data-testid="canvas"
      />
      <button data-testid="overlay" />
      <div role="menu">
        <button data-testid="menu-item" />
      </div>
    </div>
  );
}

function pinch(target: Element, clientX: number, clientY: number) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    deltaY: -10,
    clientX,
    clientY,
  });
  target.dispatchEvent(event);
  return event;
}

describe("useForwardCanvasZoom", () => {
  afterEach(cleanup);

  it("hands a pinch over an overlay on the canvas to the container", () => {
    const onWheel = vi.fn();
    const { getByTestId } = render(<Harness onWheel={onWheel} />);
    const event = pinch(getByTestId("overlay"), 100, 100);
    expect(event.defaultPrevented).toBe(true);
    expect(onWheel).toHaveBeenCalledTimes(1);
    expect(onWheel.mock.calls[0]![0].ctrlKey).toBe(true);
  });

  it("leaves a pinch outside the canvas bounds to the browser", () => {
    const onWheel = vi.fn();
    const { getByTestId } = render(<Harness onWheel={onWheel} />);
    const event = pinch(getByTestId("overlay"), 900, 100);
    expect(event.defaultPrevented).toBe(false);
    expect(onWheel).not.toHaveBeenCalled();
  });

  it("leaves menus alone and ignores plain wheel", () => {
    const onWheel = vi.fn();
    const { getByTestId } = render(<Harness onWheel={onWheel} />);
    expect(pinch(getByTestId("menu-item"), 100, 100).defaultPrevented).toBe(
      false,
    );
    const plain = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 10,
      clientX: 100,
      clientY: 100,
    });
    getByTestId("overlay").dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(onWheel).not.toHaveBeenCalled();
  });
});
