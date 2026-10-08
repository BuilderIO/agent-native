import { describe, expect, it } from "vitest";

import {
  placeInFigmaPasteContainer,
  planFigmaPaste,
  type FigmaPasteLayer,
} from "./figma-paste-plan";

const inner = { width: 600, height: 400, visible: null };

describe("placeInFigmaPasteContainer", () => {
  it("keeps the offset from the frame it was copied out of", () => {
    expect(
      placeInFigmaPasteContainer(
        { width: 67, height: 67, sourceOffset: { x: 29.6, y: 29.6 } },
        inner,
      ),
    ).toEqual({ x: 29.6, y: 29.6 });
  });

  it("centres a paste copied from the page in the container", () => {
    expect(
      placeInFigmaPasteContainer(
        { width: 24, height: 24, sourceOffset: null },
        inner,
      ),
    ).toEqual({ x: 288, y: 188 });
  });

  it("centres in the visible part when the container is partly off screen", () => {
    expect(
      placeInFigmaPasteContainer(
        { width: 24, height: 24, sourceOffset: null },
        { ...inner, visible: { x: 0, y: 0, width: 541, height: 400 } },
      ),
    ).toEqual({ x: 258.5, y: 188 });
  });

  it("puts a paste larger than the container at its top-left", () => {
    expect(
      placeInFigmaPasteContainer(
        { width: 299, height: 420, sourceOffset: { x: 862, y: 475 } },
        inner,
      ),
    ).toEqual({ x: 0, y: 0 });
  });
});

const jev: FigmaPasteLayer = {
  title: "Vector",
  width: 299,
  height: 420,
  content: "",
  wrapsLooseNode: true,
  origin: { x: 2902, y: 608 },
  sourceOffset: { x: 862, y: 475 },
};
const tabler: FigmaPasteLayer = {
  ...jev,
  title: "Frame",
  width: 24,
  height: 24,
  wrapsLooseNode: false,
  sourceOffset: null,
};
const hero = { fileId: "hero", x: 0, y: 0, width: 1200, height: 640 };
const noSelection = {
  container: null,
  viewport: { x: 110, y: -90, width: 980, height: 820 },
  screens: [hero],
};

describe("planFigmaPaste with nothing selected", () => {
  it("centres in the viewport, inside the top-level frame that holds it", () => {
    expect(planFigmaPaste([jev], noSelection)).toEqual({
      kind: "layers",
      fileId: "hero",
      selector: null,
      positions: [{ x: 450.5, y: 110 }],
    });
  });

  it("puts a loose layer that no frame holds on the board", () => {
    expect(
      planFigmaPaste([jev], {
        ...noSelection,
        viewport: { x: 2510, y: 2614, width: 980, height: 772 },
      }),
    ).toEqual({ kind: "board", positions: [{ x: 2850.5, y: 2790 }] });
  });

  it("makes a copied frame that no frame holds a screen at the viewport centre", () => {
    expect(
      planFigmaPaste([tabler], {
        ...noSelection,
        viewport: { x: 2510, y: 2614, width: 980, height: 772 },
      }),
    ).toEqual({ kind: "screens", placeAt: { x: 2988, y: 2988 } });
  });
});

describe("planFigmaPaste with a frame selected", () => {
  const container = {
    fileId: "hero",
    selector: '[data-agent-native-node-id="inner"]',
    width: 600,
    height: 400,
    visible: { x: 0, y: 0, width: 600, height: 400 },
    autoLayout: false,
  };

  it("pastes inside the frame", () => {
    expect(planFigmaPaste([tabler], { ...noSelection, container })).toEqual({
      kind: "layers",
      fileId: "hero",
      selector: container.selector,
      positions: [{ x: 288, y: 188 }],
    });
  });

  it("appends to an auto-layout frame as a flow child", () => {
    expect(
      planFigmaPaste([tabler], {
        ...noSelection,
        container: { ...container, autoLayout: true },
      }),
    ).toMatchObject({ kind: "layers", positions: [null] });
  });

  it("falls back to the viewport when the frame is off screen", () => {
    expect(
      planFigmaPaste([jev], {
        ...noSelection,
        container: { ...container, visible: null },
      }),
    ).toMatchObject({ kind: "layers", fileId: "hero", selector: null });
  });
});
