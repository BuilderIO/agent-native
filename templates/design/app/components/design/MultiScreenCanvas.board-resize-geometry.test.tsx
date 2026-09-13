// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

/**
 * beginBoardElementResize's move/up handlers are captured once at mousedown
 * and outlive any later render. If they map through the render geometry
 * captured in that mousedown-time closure instead of re-reading it fresh, a
 * wheel/pinch zoom mid-resize (not blocked during a drag) silently maps
 * every subsequent point through a stale origin. Proven here by shifting
 * `boardFrameGeometry` — a simpler, deterministic driver of the same
 * `boardSurfaceRenderGeometry` the real zoom path also feeds — between
 * mousedown and mouseup, and asserting the point the host forwards into the
 * board iframe shifts by exactly the geometry's own delta.
 */
describe("beginBoardElementResize point mapping", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy.mockRestore();
    container.remove();
  });

  it("maps mouseup through the render geometry current at mouseup, not the one captured at mousedown", async () => {
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

    const boardContent = `<!doctype html><html><body>
      <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" style="position:absolute;left:0px;top:0px;width:50px;height:50px"></div>
      <div data-agent-native-edge-handle="e"></div>
    </body></html>`;

    const render = (boardFrameGeometry: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => (
      <MultiScreenCanvas
        screens={[]}
        zoom={100}
        geometryById={{}}
        boardFileId="board"
        boardFileContent={boardContent}
        boardFrameGeometry={boardFrameGeometry}
        boardIsActive
        onPick={() => {}}
      />
    );

    await act(async () => {
      root.render(render({ x: -1000, y: -1000, width: 2000, height: 2000 }));
    });
    // Let the board iframe's srcdoc finish loading into a real contentDocument.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const boardIframe = container.querySelector<HTMLIFrameElement>(
      "[data-board-surface-layer] iframe[data-design-preview-iframe]",
    );
    expect(boardIframe).not.toBeNull();
    const iframeDoc = boardIframe!.contentWindow!.document;

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:board-selection-rect",
            rect: { left: 10, top: 10, width: 50, height: 50 },
            rotationDeg: 0,
          },
          source: boardIframe!.contentWindow,
        }),
      );
    });

    const handle = container.querySelector<HTMLElement>(
      '[data-board-object-selection-box] [data-resize-handle="e"]',
    );
    expect(handle).not.toBeNull();

    const dispatchedPoints: Array<{ type: string; x: number; y: number }> = [];
    iframeDoc.addEventListener("mousedown", (ev) =>
      dispatchedPoints.push({
        type: "mousedown",
        x: (ev as MouseEvent).clientX,
        y: (ev as MouseEvent).clientY,
      }),
    );
    iframeDoc.addEventListener("mouseup", (ev) =>
      dispatchedPoints.push({
        type: "mouseup",
        x: (ev as MouseEvent).clientX,
        y: (ev as MouseEvent).clientY,
      }),
    );

    await act(async () => {
      handle!.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 400,
          clientY: 300,
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Shift the render geometry's origin by (+100, +40) — the render must
    // pick this up before the drag ends.
    await act(async () => {
      root.render(render({ x: -900, y: -960, width: 2000, height: 2000 }));
    });

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          clientX: 400,
          clientY: 300,
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const mousedownPoint = dispatchedPoints.find((p) => p.type === "mousedown");
    const mouseupPoint = dispatchedPoints.find((p) => p.type === "mouseup");
    expect(mousedownPoint).toBeDefined();
    expect(mouseupPoint).toBeDefined();

    // Same client point, only the render geometry's origin shifted by
    // (+100, +40) between mousedown and mouseup — a mapping that re-reads
    // fresh geometry must shift the mapped point by the OPPOSITE delta
    // (-100, -40); a mapping stuck on the stale mousedown-time geometry
    // would report the exact same point twice.
    expect(mouseupPoint!.x - mousedownPoint!.x).toBeCloseTo(-100);
    expect(mouseupPoint!.y - mousedownPoint!.y).toBeCloseTo(-40);
  });
});
