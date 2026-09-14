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

const BOARD_CONTENT = `<!doctype html><html><body>
  <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" style="position:absolute;left:0px;top:0px;width:50px;height:50px"></div>
  <div data-agent-native-edge-handle="e"></div>
</body></html>`;

let container: HTMLDivElement;
let root: Root;
let rectSpy: ReturnType<typeof vi.spyOn>;

function renderCanvas(boardFrameGeometry: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <MultiScreenCanvas
      screens={[]}
      zoom={100}
      geometryById={{}}
      boardFileId="board"
      boardFileContent={BOARD_CONTENT}
      boardFrameGeometry={boardFrameGeometry}
      boardIsActive
      onPick={() => {}}
    />
  );
}

async function mountBoardCanvas(boardFrameGeometry: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<HTMLIFrameElement> {
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
  await act(async () => {
    root.render(renderCanvas(boardFrameGeometry));
  });
  // Let the board iframe's srcdoc finish loading into a real contentDocument.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const boardIframe = container.querySelector<HTMLIFrameElement>(
    "[data-board-surface-layer] iframe[data-design-preview-iframe]",
  );
  expect(boardIframe).not.toBeNull();
  return boardIframe!;
}

function postBoardSelectionRect(source: Window | null) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "agent-native:board-selection-rect",
        rect: { left: 10, top: 10, width: 50, height: 50 },
        rotationDeg: 0,
      },
      source,
    }),
  );
}

afterEach(async () => {
  await act(async () => root.unmount());
  rectSpy.mockRestore();
  container.remove();
});

/**
 * The board bridge runs same-origin content the host also renders inside every
 * Screen's preview iframe, so the selection-rect listener must key on the
 * board surface's OWN contentWindow — a rect from any other window would plant
 * host-level resize handles (wired straight into startResize) over geometry
 * that window does not own.
 */
describe("board-selection-rect sender boundary", () => {
  it("ignores the rect unless it came from the board surface iframe's own contentWindow", async () => {
    const boardIframe = await mountBoardCanvas({
      x: -1000,
      y: -1000,
      width: 2000,
      height: 2000,
    });
    const foreignIframe = document.createElement("iframe");
    document.body.append(foreignIframe);
    try {
      expect(foreignIframe.contentWindow).not.toBeNull();
      expect(foreignIframe.contentWindow).not.toBe(boardIframe.contentWindow);

      await act(async () => {
        postBoardSelectionRect(foreignIframe.contentWindow);
      });
      expect(
        container.querySelector("[data-board-object-selection-box]"),
      ).toBeNull();

      // Same payload from the board surface itself does render chrome, so the
      // assertion above is a real source check and not a dead payload.
      await act(async () => {
        postBoardSelectionRect(boardIframe.contentWindow);
      });
      expect(
        container.querySelector("[data-board-object-selection-box]"),
      ).not.toBeNull();
    } finally {
      foreignIframe.remove();
    }
  });
});

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
  it("maps mouseup through the render geometry current at mouseup, not the one captured at mousedown", async () => {
    const boardIframe = await mountBoardCanvas({
      x: -1000,
      y: -1000,
      width: 2000,
      height: 2000,
    });
    const iframeDoc = boardIframe.contentWindow!.document;

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow);
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
      root.render(
        renderCanvas({ x: -900, y: -960, width: 2000, height: 2000 }),
      );
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
