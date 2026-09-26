// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreatePrimitiveSpec } from "./design-canvas/creation";
import { DesignCanvas } from "./DesignCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointerup",
  pointerId: number,
  clientX: number,
  clientY: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
    button: { value: 0 },
    buttons: { value: type === "pointerup" ? 0 : 1 },
    shiftKey: { value: false },
    altKey: { value: false },
  });
  target.dispatchEvent(event);
}

describe("DesignCanvas Pen path completion", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        right: 800,
        bottom: 600,
        left: 0,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy.mockRestore();
    container.remove();
  });

  async function renderPenCanvas(
    onCreatePrimitive: (spec: CreatePrimitiveSpec) => string | void,
  ) {
    await act(async () => {
      root.render(
        <DesignCanvas
          content="<!doctype html><html><body></body></html>"
          contentKey="screen"
          screenId="screen"
          zoom={100}
          deviceFrame="none"
          interactMode={false}
          editMode
          registerRuntimeBridge={false}
          embeddedFrame={{
            viewportWidth: 800,
            viewportHeight: 600,
            displayWidth: 800,
            displayHeight: 600,
          }}
          activeCreationTool="pen"
          onCreatePrimitive={onCreatePrimitive}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />,
      );
    });

    const overlay = container.querySelector<HTMLDivElement>(
      "[data-design-canvas-creation-overlay]",
    );
    expect(overlay).not.toBeNull();
    const capturedPointers = new Set<number>();
    const releasePointerCapture = vi.fn((pointerId: number) => {
      capturedPointers.delete(pointerId);
    });
    Object.defineProperties(overlay!, {
      setPointerCapture: {
        value: (pointerId: number) => capturedPointers.add(pointerId),
      },
      hasPointerCapture: {
        value: (pointerId: number) => capturedPointers.has(pointerId),
      },
      releasePointerCapture: { value: releasePointerCapture },
    });

    const sendPointer = async (
      type: "pointerdown" | "pointerup",
      pointerId: number,
      x: number,
      y: number,
    ) => {
      await act(async () => dispatchPointer(overlay!, type, pointerId, x, y));
    };
    const click = async (pointerId: number, x: number, y: number) => {
      await sendPointer("pointerdown", pointerId, x, y);
      await sendPointer("pointerup", pointerId, x, y);
    };
    const pressKey = async (key: "Enter" | "Escape") => {
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    };

    return { releasePointerCapture, click, pressKey, sendPointer };
  }

  it("releases an active anchor or closing gesture without restoring or committing it", async () => {
    const onCreatePrimitive = vi.fn(() => "created-path");
    const { releasePointerCapture, sendPointer, click, pressKey } =
      await renderPenCanvas(onCreatePrimitive);

    await click(1, 120, 120);
    await sendPointer("pointerdown", 2, 180, 180);
    await pressKey("Escape");
    expect(releasePointerCapture).toHaveBeenCalledWith(2);
    await sendPointer("pointerup", 2, 180, 180);
    expect(container.querySelector("[data-pen-path-overlay]")).toBeNull();
    expect(onCreatePrimitive).not.toHaveBeenCalled();

    await click(3, 120, 120);
    await click(4, 180, 180);
    await sendPointer("pointerdown", 5, 120, 120);
    await pressKey("Escape");
    expect(releasePointerCapture).toHaveBeenCalledWith(5);
    await sendPointer("pointerup", 5, 120, 120);
    expect(container.querySelector("[data-pen-path-overlay]")).toBeNull();
    expect(onCreatePrimitive).not.toHaveBeenCalled();
  });

  it("passes Move intent when Enter finishes a new Pen path", async () => {
    const onCreatePrimitive = vi.fn(() => "created-path");
    const { click, pressKey } = await renderPenCanvas(onCreatePrimitive);

    await click(1, 120, 120);
    await click(2, 180, 180);
    expect(container.querySelectorAll("[data-pen-anchor]")).toHaveLength(2);

    await pressKey("Enter");

    expect(container.querySelector("[data-pen-path-overlay]")).toBeNull();
    expect(onCreatePrimitive).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "pen",
        nextTool: "move",
        preserveActiveTool: false,
      }),
    );
  });
});
