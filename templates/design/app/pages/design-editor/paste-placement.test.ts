// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { describeFlowContainer, NO_FLOW_CONTAINER } from "./nudge-intent";
import {
  clipboardEntryPasteBox,
  fitPasteLayersInFrame,
  isPasteContainer,
  pasteTargetFromElementInfo,
  resolveCanvasPastePositions,
  resolveClipboardSourceCanvasRects,
  resolvePastePlacementForSelection,
  type PasteTargetNode,
} from "./paste-placement";

function target(overrides: Partial<PasteTargetNode> = {}): PasteTargetNode {
  return {
    tag: "div",
    hasElementChildren: false,
    hasText: false,
    container: NO_FLOW_CONTAINER,
    ...overrides,
  };
}

describe("isPasteContainer", () => {
  it("accepts an auto layout frame", () => {
    expect(
      isPasteContainer(
        target({
          container: describeFlowContainer({ style: { display: "flex" } }),
        }),
      ),
    ).toBe(true);
  });

  it("accepts a plain frame that already holds children", () => {
    expect(isPasteContainer(target({ hasElementChildren: true }))).toBe(true);
  });

  it("accepts an empty frame", () => {
    expect(isPasteContainer(target())).toBe(true);
  });

  it("rejects a div that is really a text object", () => {
    expect(isPasteContainer(target({ hasText: true }))).toBe(false);
  });

  it("rejects text elements even when they nest inline markup", () => {
    for (const tag of ["p", "h2", "span", "button", "a", "li"]) {
      expect(isPasteContainer(target({ tag, hasElementChildren: true }))).toBe(
        false,
      );
    }
  });

  it("rejects replaced elements", () => {
    for (const tag of ["img", "input", "svg", "video", "canvas"]) {
      expect(isPasteContainer(target({ tag }))).toBe(false);
    }
  });

  it("rejects a canvas primitive that is not a frame", () => {
    expect(isPasteContainer(target({ primitiveKind: "rectangle" }))).toBe(
      false,
    );
    expect(isPasteContainer(target({ primitiveKind: "frame" }))).toBe(true);
  });
});

describe("pasteTargetFromElementInfo", () => {
  const measured = {
    tagName: "div",
    childElementCount: 2,
    textContent: "Card",
    isFlexContainer: false,
  };

  it("reads a live card that holds children as a container", () => {
    const node = pasteTargetFromElementInfo(measured);
    expect(node && isPasteContainer(node)).toBe(true);
  });

  it("reads a live text div without children as a text object", () => {
    const node = pasteTargetFromElementInfo({
      ...measured,
      childElementCount: 0,
    });
    expect(node && isPasteContainer(node)).toBe(false);
  });

  it("reads a live auto layout element as a container in its flow", () => {
    const node = pasteTargetFromElementInfo({
      ...measured,
      isFlexContainer: true,
    });
    expect(node?.container.kind).toBe("flex");
  });

  it("cannot decide a text-bearing element whose child count is unknown", () => {
    expect(
      pasteTargetFromElementInfo({ ...measured, childElementCount: undefined }),
    ).toBeNull();
  });

  it("still decides when the unknown child count cannot change the answer", () => {
    const leaf = pasteTargetFromElementInfo({
      ...measured,
      tagName: "img",
      childElementCount: undefined,
    });
    expect(leaf && isPasteContainer(leaf)).toBe(false);
  });
});

function elementInfoFor(nodeId: string, tagName = "div"): ElementInfo {
  return {
    tagName,
    sourceId: nodeId,
    selector: `[data-agent-native-node-id="${nodeId}"]`,
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as ElementInfo;
}

const SCREEN = `<!doctype html><html><body>
  <section data-agent-native-node-id="card-section" style="display:flex;flex-direction:column;gap:12px">
    <article data-agent-native-node-id="card">
      <h3 data-agent-native-node-id="card-title">Alpha</h3>
    </article>
  </section>
  <div data-agent-native-node-id="free-frame" style="position:relative;width:400px;height:300px"></div>
  <p data-agent-native-node-id="copy">Some body copy</p>
</body></html>`;

describe("resolvePastePlacementForSelection", () => {
  it("pastes into a selected auto layout container, in its flow", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("card-section", "section"),
      }),
    ).toMatchObject({ placement: "inside" });
  });

  it("pastes into a selected free container without joining a flow", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("free-frame"),
      }),
    ).toMatchObject({ placement: "inside" });
  });

  it("pastes after a selected text object", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("copy", "p"),
      }),
    ).toMatchObject({ placement: "after" });
  });

  it("pastes after a selected heading inside a card rather than into it", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("card-title", "h3"),
      }),
    ).toMatchObject({ placement: "after" });
  });

  it("pastes into a selected card that holds children", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("card", "article"),
      }),
    ).toMatchObject({ placement: "inside" });
  });

  it("returns null when there is no selection or no source to resolve", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: null,
      }),
    ).toBeNull();
    expect(
      resolvePastePlacementForSelection({
        content: "",
        selectedElement: elementInfoFor("card"),
      }),
    ).toBeNull();
  });

  it("returns null when the selection cannot be found in the document", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("gone", "aside"),
      }),
    ).toBeNull();
  });
});

describe("fitPasteLayersInFrame", () => {
  it("keeps the copy's offset from its old parent when it fits the new frame", () => {
    expect(
      fitPasteLayersInFrame([{ x: 40, y: 120, width: 200, height: 100 }], {
        width: 390,
        height: 844,
      }),
    ).toEqual([{ x: 40, y: 120 }]);
  });

  it("centers the copy in the frame when its old offset would overflow it", () => {
    expect(
      fitPasteLayersInFrame([{ x: 250, y: 120, width: 200, height: 100 }], {
        width: 300,
        height: 300,
      }),
    ).toEqual([{ x: 50, y: 100 }]);
  });

  it("centers several layers as one group and keeps their spacing", () => {
    expect(
      fitPasteLayersInFrame(
        [
          { x: 300, y: 0, width: 50, height: 50 },
          { x: 400, y: 100, width: 50, height: 50 },
        ],
        { width: 200, height: 200 },
      ),
    ).toEqual([
      { x: 25, y: 25 },
      { x: 125, y: 125 },
    ]);
  });

  it("lands on whole pixels", () => {
    expect(
      fitPasteLayersInFrame([{ x: 10.4, y: 20.6, width: 30, height: 30 }], {
        width: 100,
        height: 100,
      }),
    ).toEqual([{ x: 10, y: 21 }]);
    expect(
      fitPasteLayersInFrame([{ x: 90, y: 0, width: 33, height: 33 }], {
        width: 100,
        height: 100,
      }),
    ).toEqual([{ x: 34, y: 34 }]);
  });
});

describe("resolveCanvasPastePositions", () => {
  const view = { x: 1000, y: 1000, width: 1000, height: 600 };
  const box = { x: 0, y: 0, width: 200, height: 100 };

  it("pastes where the original sits while that spot is in view", () => {
    expect(
      resolveCanvasPastePositions({
        layers: [box],
        original: [{ ...box, x: 1100, y: 1200 }],
        visibleRect: view,
        cascadeOffset: 0,
      }),
    ).toEqual({ at: "original", positions: [{ x: 1100, y: 1200 }] });
  });

  it("centers on the view when the original's spot is off-screen", () => {
    expect(
      resolveCanvasPastePositions({
        layers: [box],
        original: [{ ...box, x: 40, y: 120 }],
        visibleRect: view,
        cascadeOffset: 0,
      }),
    ).toEqual({ at: "view-center", positions: [{ x: 1400, y: 1250 }] });
  });

  it("centers on the view when the original cannot be located", () => {
    expect(
      resolveCanvasPastePositions({
        layers: [box],
        original: null,
        visibleRect: view,
        cascadeOffset: 16,
      }),
    ).toEqual({ at: "view-center", positions: [{ x: 1416, y: 1266 }] });
  });

  it("rounds a fractional view center to whole pixels", () => {
    expect(
      resolveCanvasPastePositions({
        layers: [{ ...box, width: 33, height: 33 }],
        original: null,
        visibleRect: { x: 0.25, y: 0, width: 1001, height: 601 },
        cascadeOffset: 0,
      }),
    ).toEqual({ at: "view-center", positions: [{ x: 484, y: 284 }] });
  });

  it("cannot place an unlocated copy without a view", () => {
    expect(
      resolveCanvasPastePositions({
        layers: [box],
        original: null,
        visibleRect: null,
        cascadeOffset: 0,
      }),
    ).toEqual({ at: "unplaceable" });
  });
});

describe("resolveClipboardSourceCanvasRects", () => {
  const rect =
    '<div data-agent-native-node-id="rect-1" style="position:absolute;left:40px;top:120px;width:200px;height:100px"></div>';
  const screen = `<!doctype html><html><body><div data-agent-native-node-id="frame-1" style="position:absolute;left:10px;top:20px;width:390px;height:844px">${rect}</div></body></html>`;

  it("adds the screen's canvas origin to the layer's document position", () => {
    expect(
      resolveClipboardSourceCanvasRects({
        entries: [{ html: rect, rootNodeId: "rect-1", sourceFileId: "home" }],
        getContent: () => screen,
        frames: [{ id: "home", geometry: { x: 100, y: 200 } }],
        boardFileId: "board",
      }),
    ).toEqual([{ x: 150, y: 340, width: 200, height: 100 }]);
  });

  it("reads board layers in canvas coordinates directly", () => {
    expect(
      resolveClipboardSourceCanvasRects({
        entries: [{ html: rect, rootNodeId: "rect-1", sourceFileId: "board" }],
        getContent: () => screen,
        frames: [],
        boardFileId: "board",
      }),
    ).toEqual([{ x: 50, y: 140, width: 200, height: 100 }]);
  });

  it("cannot locate a copy from a file this design does not have", () => {
    expect(
      resolveClipboardSourceCanvasRects({
        entries: [
          { html: rect, rootNodeId: "rect-1", sourceFileId: "elsewhere" },
        ],
        getContent: () => "",
        frames: [],
        boardFileId: "board",
      }),
    ).toBeNull();
  });
});

describe("clipboardEntryPasteBox", () => {
  it("reads the copied root's inline box, falling back to its captured styles", () => {
    expect(
      clipboardEntryPasteBox(
        {
          html: '<div style="position:absolute;left:12px;top:8px"></div>',
          portableStyleSnapshot: {
            nodes: [{ path: [], styles: { width: "64px", height: "32px" } }],
          },
        },
        0,
      ),
    ).toEqual({ x: 12, y: 8, width: 64, height: 32 });
  });

  it("stacks an unpositioned layer from the parent's corner", () => {
    expect(clipboardEntryPasteBox({ html: "<p>Text</p>" }, 2)).toEqual({
      x: 32,
      y: 32,
      width: 0,
      height: 0,
    });
  });
});
