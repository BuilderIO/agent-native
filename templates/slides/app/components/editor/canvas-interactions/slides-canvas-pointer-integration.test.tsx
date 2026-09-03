// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSlidesCanvasGestureController,
  resolveSlidesCanvasPointerIntent,
} from "./slides-canvas-adapter";

function SelectedTextObjectHarness() {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [editing, setEditing] = useState(false);
  const selected = true;
  const originRef = useRef(position);
  const suppressClickRef = useRef(false);
  const controllerRef = useRef<ReturnType<
    typeof createSlidesCanvasGestureController
  > | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const intent = resolveSlidesCanvasPointerIntent({
      hasSelectedObject: selected,
      targetWithinSelectedObject: true,
      targetContainsSelectedObject: false,
      pointerWithinMoveBand: false,
      targetIsEditableText: true,
    });
    if (intent !== "move-object-body") return;

    originRef.current = position;
    const controller = createSlidesCanvasGestureController({
      preview: (gesture) => {
        suppressClickRef.current = true;
        setPosition({
          x: originRef.current.x + gesture.canvasDelta.x,
          y: originRef.current.y + gesture.canvasDelta.y,
        });
        return { handled: true };
      },
      commit: () => ({ handled: true }),
    });
    controllerRef.current = controller;
    controller.pointerDown({
      kind: "move",
      objectIds: ["selected-title"],
      pointer: { x: event.clientX, y: event.clientY },
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      canvas: { width: 100, height: 100 },
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    controllerRef.current?.pointerMove({
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    controllerRef.current?.pointerUp({
      x: event.clientX,
      y: event.clientY,
    });
    controllerRef.current = null;
  };

  return (
    <div
      data-testid="selected-text-object"
      data-selected={selected}
      data-editing={editing}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        setEditing(true);
      }}
    >
      Selected title
    </div>
  );
}

afterEach(cleanup);

describe("mounted selected text body interaction", () => {
  it("keeps a selected text body's pointer stream available for native selection", () => {
    const { getByTestId } = render(<SelectedTextObjectHarness />);
    const object = getByTestId("selected-text-object");

    fireEvent.pointerDown(object, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(object, { clientX: 50, clientY: 30 });
    fireEvent.pointerUp(object, { clientX: 50, clientY: 30 });
    // Text interiors are not move candidates. The browser owns the pointer
    // stream so a drag can select text instead of moving the block.
    fireEvent.click(object);

    expect(object.style.left).toBe("0px");
    expect(object.style.top).toBe("0px");
    expect(object.getAttribute("data-selected")).toBe("true");
    expect(object.getAttribute("data-editing")).toBe("true");

    // A subsequent stationary click remains in text editing as well.
    fireEvent.pointerDown(object, { button: 0, clientX: 50, clientY: 30 });
    fireEvent.pointerUp(object, { clientX: 50, clientY: 30 });
    fireEvent.click(object);

    expect(object.style.left).toBe("0px");
    expect(object.style.top).toBe("0px");
    expect(object.getAttribute("data-selected")).toBe("true");
    expect(object.getAttribute("data-editing")).toBe("true");
  });

  it("re-enters text editing when pointer-up has no movement", () => {
    const { getByTestId } = render(<SelectedTextObjectHarness />);
    const object = getByTestId("selected-text-object");

    fireEvent.pointerDown(object, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(object, { clientX: 10, clientY: 10 });
    fireEvent.click(object);

    expect(object.style.left).toBe("0px");
    expect(object.style.top).toBe("0px");
    expect(object.getAttribute("data-selected")).toBe("true");
    expect(object.getAttribute("data-editing")).toBe("true");
  });

  it("round trips 125% move and north-resize geometry through persisted HTML", async () => {
    const objectId = "durable-title";
    const initialContent = `<div class="fmd-slide"><div data-slide-object-id="${objectId}" style="position:absolute;left:25px;top:85px;width:740px;height:218px">Title</div></div>`;
    let persistedContent = initialContent;
    let pendingWrite = Promise.resolve();
    let writeCount = 0;
    const view = render(
      <div
        data-testid="zoomed-slide"
        style={{ transform: "scale(1.25)", transformOrigin: "top left" }}
        dangerouslySetInnerHTML={{ __html: persistedContent }}
      />,
    );
    const canvas = view.getByTestId("zoomed-slide");
    const selected = () =>
      canvas.querySelector<HTMLElement>(
        `[data-slide-object-id="${objectId}"]`,
      )!;
    const geometry = () => ({
      x: Number.parseFloat(selected().style.left),
      y: Number.parseFloat(selected().style.top),
      width: Number.parseFloat(selected().style.width),
      height: Number.parseFloat(selected().style.height),
    });
    const applyGeometry = (rect: ReturnType<typeof geometry>) => {
      selected().style.left = `${rect.x}px`;
      selected().style.top = `${rect.y}px`;
      selected().style.width = `${rect.width}px`;
      selected().style.height = `${rect.height}px`;
    };
    const persist = () => {
      const snapshot = canvas.innerHTML;
      pendingWrite = Promise.resolve().then(() => {
        persistedContent = snapshot;
        writeCount += 1;
      });
      return { handled: true } as const;
    };
    const viewport = { left: 0, top: 0, width: 1200, height: 675 };
    const canvasSize = { width: 960, height: 540 };

    const moveOrigin = geometry();
    const move = createSlidesCanvasGestureController({
      preview: (gesture) => {
        applyGeometry({
          ...moveOrigin,
          x: moveOrigin.x + gesture.canvasDelta.x,
          y: moveOrigin.y + gesture.canvasDelta.y,
        });
        return { handled: true };
      },
      commit: persist,
    });
    move.pointerDown({
      kind: "move",
      objectIds: [objectId],
      pointer: { x: 100, y: 100 },
      viewport,
      canvas: canvasSize,
    });
    move.pointerMove({ x: 150, y: 125 });
    move.pointerUp({ x: 150, y: 125 });
    await pendingWrite;

    expect(geometry()).toEqual({
      x: 65,
      y: 105,
      width: 740,
      height: 218,
    });

    const resizeOrigin = geometry();
    const resize = createSlidesCanvasGestureController({
      preview: (gesture) => {
        if (gesture.kind !== "resize") {
          return { handled: false, reason: "unhandled" };
        }
        applyGeometry(gesture.rect);
        return { handled: true };
      },
      commit: persist,
    });
    resize.pointerDown({
      kind: "resize",
      objectIds: [objectId],
      pointer: { x: 100, y: 100 },
      viewport,
      canvas: canvasSize,
      handle: "n",
      rect: resizeOrigin,
    });
    resize.pointerMove({ x: 100, y: 88 });
    resize.pointerUp({ x: 100, y: 88 });
    await pendingWrite;

    view.rerender(
      <div
        data-testid="zoomed-slide"
        style={{ transform: "scale(1.25)", transformOrigin: "top left" }}
        dangerouslySetInnerHTML={{ __html: persistedContent }}
      />,
    );
    const restored = selected();
    expect({
      x: Number.parseFloat(restored.style.left),
      y: Number.parseFloat(restored.style.top),
      width: Number.parseFloat(restored.style.width),
      height: Number.parseFloat(restored.style.height),
    }).toEqual({
      x: 65,
      y: 95.4,
      width: 740,
      height: 227.6,
    });
    expect(restored.getAttribute("data-slide-object-id")).toBe(objectId);
    expect(writeCount).toBe(2);
  });
});
