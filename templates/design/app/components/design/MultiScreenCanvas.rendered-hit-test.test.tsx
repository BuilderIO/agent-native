// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTENT_SIZE_REPORT_MESSAGE_TYPE } from "./design-canvas/content-size-report";
import { SURFACE_PADDING } from "./multi-screen/overview-layout";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

/**
 * drag-reparent-1: getFrameEntryAtPoint (via getSelectableFrameEntries) hit-
 * tested the persisted geometry (frameGeometryRef) instead of the rendered,
 * content-fit-corrected geometry (renderedFrameGeometryRef) canvasFrames
 * already computes for painting. Once a screen's measured content pushed its
 * on-canvas card taller than its saved geometry, a pointer visibly over the
 * card resolved to no-frame-under-pointer — reproduced here at the marquee
 * hit-test (host-only, no cross-iframe drag machinery needed), the same
 * getSelectableFrameEntries() the cross-screen element-drop path also calls.
 *
 * A top-level screen only joins a marquee selection once the marquee box
 * fully encloses it (parity-unique-paths.spec.ts's full-enclosure ground
 * truth), and the rendered card fully contains the persisted geometry here
 * (same x/y origin, only height differs) — so a marquee sized to enclose the
 * rendered card would enclose the persisted one too either way and prove
 * nothing. Discriminate the other direction instead: a marquee that fully
 * encloses only the smaller PERSISTED bounds must NOT select the screen,
 * because the real (rendered) card is taller and so is not fully enclosed —
 * selecting it here would mean hit-testing fell back to the stale persisted
 * geometry.
 */
describe("frame hit-testing uses rendered (content-fit) geometry", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        right: 2000,
        bottom: 1400,
        left: 0,
        width: 2000,
        height: 1400,
        toJSON: () => ({}),
      });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy.mockRestore();
    container.remove();
  });

  it("does not select a screen via a marquee that only encloses its stale, pre-measurement geometry", async () => {
    const onSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "a",
              filename: "a.html",
              content: "<!doctype html><html><body></body></html>",
            },
            {
              id: "b",
              filename: "b.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={100}
          activeTool="move"
          // b's saved geometry is only 100 tall. Its metadata width (1280,
          // the resolver's default) floors auto-fit at 900 once a
          // measurement arrives, so the rendered card ends up far taller
          // than what's persisted here.
          geometryById={{
            a: { x: 0, y: 0, width: 400, height: 200 },
            b: { x: 600, y: 0, width: 400, height: 100 },
          }}
          onPick={() => {}}
          onSelectionChange={onSelectionChange}
        />,
      );
    });

    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();

    const iframeB = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="b"]',
    );
    expect(iframeB).not.toBeNull();

    // Deliver b's real content-size measurement, as the injected bridge does.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: CONTENT_SIZE_REPORT_MESSAGE_TYPE,
            height: 950,
            width: 400,
            viewportHeight: 950,
          },
          source: iframeB!.contentWindow as unknown as Window,
        }),
      );
    });

    const worldLayer = surface!.firstElementChild as HTMLElement;
    const transformMatch = worldLayer.style.transform.match(
      /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/,
    );
    expect(transformMatch).not.toBeNull();
    const [, panXStr, panYStr, scaleStr] = transformMatch!;
    const panX = Number.parseFloat(panXStr);
    const panY = Number.parseFloat(panYStr);
    const scale = Number.parseFloat(scaleStr);
    // Mirrors screenToCanvasPoint's inverse (SURFACE_PADDING cancels out
    // between a start/end pair drawn entirely in one screen's rendered card).
    const clientPointForCanvas = (canvasX: number, canvasY: number) => ({
      clientX: panX + (SURFACE_PADDING + canvasX) * scale,
      clientY: panY + (SURFACE_PADDING + canvasY) * scale,
    });

    // Fully encloses b's PERSISTED geometry (x:600-1000, y:0-100, plus the
    // frame-label chrome above it) but stops well short of its RENDERED
    // height (950) — see the discrimination this needs, in the doc comment
    // above.
    const start = clientPointForCanvas(590, -40);
    const end = clientPointForCanvas(1010, 150);

    const dispatch = (
      target: EventTarget,
      type: "mousedown" | "mousemove" | "mouseup",
      clientX: number,
      clientY: number,
    ) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === "mouseup" ? 0 : 1,
          clientX,
          clientY,
        }),
      );

    await act(async () => {
      dispatch(surface!, "mousedown", start.clientX, start.clientY);
      dispatch(window, "mousemove", end.clientX, end.clientY);
      dispatch(window, "mouseup", end.clientX, end.clientY);
    });

    expect(onSelectionChange).not.toHaveBeenCalledWith(["b"]);
  });
});
