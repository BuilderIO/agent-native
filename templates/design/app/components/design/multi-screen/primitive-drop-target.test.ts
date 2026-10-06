// @vitest-environment happy-dom

import { rotatePoint } from "@shared/canvas-math";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearPrimitiveParseCachesForTests,
  findAutoLayoutInsertionAnchor,
  getPrimitiveLowZoomHitRect,
  getPrimitiveDropTargetForPoint,
  parsePrimitivesFromScreen,
  resolveNodeScreenId,
} from "./primitive-drop-target";

beforeEach(() => __clearPrimitiveParseCachesForTests());

function parseWithImportedStylesheet(
  screen: Parameters<typeof parsePrimitivesFromScreen>[0],
  importedCss: string,
) {
  const NativeDOMParser = globalThis.DOMParser;
  const href = `data:text/css,${encodeURIComponent(importedCss)}`;
  vi.stubGlobal(
    "DOMParser",
    class DOMParserWithImport extends NativeDOMParser {
      override parseFromString(source: string, type: DOMParserSupportedType) {
        const doc = super.parseFromString(source, type);
        const importRule = {
          cssText: `@import url("${href}");`,
          href,
          media: { mediaText: "" },
          styleSheet: null,
        };
        Object.defineProperty(doc, "styleSheets", {
          configurable: true,
          value: [{ cssRules: [importRule] }],
        });
        return doc;
      }
    },
  );
  try {
    return parsePrimitivesFromScreen(screen);
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("primitive drop target authored layout fallback", () => {
  it("prefers the deepest equal-sized nested container", () => {
    const screen = {
      id: "equal-nested-screen",
      filename: "equal-nested-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="outer" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:200px">
          <div data-agent-native-node-id="inner" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:200px"></div>
        </div>
      </body></html>`,
    };
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 50, y: 50 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 200, height: 200 } },
        () => ({ width: 200, height: 200 }),
      )?.nodeId,
    ).toBe("inner");
  });

  it("prefers the later painted overlapping sibling", () => {
    const screen = {
      id: "overlap-screen",
      filename: "overlap-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="back" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:200px"></div>
        <div data-agent-native-node-id="front" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:200px"></div>
      </body></html>`,
    };
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 50, y: 50 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 200, height: 200 } },
        () => ({ width: 200, height: 200 }),
      )?.nodeId,
    ).toBe("front");
  });

  it("honors explicit z-index before DOM order for overlapping siblings", () => {
    const screen = {
      id: "z-index-screen",
      filename: "z-index-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="back" data-an-primitive="frame" style="position:absolute;z-index:10;left:0;top:0;width:200px;height:200px"></div>
        <div data-agent-native-node-id="front" data-an-primitive="frame" style="position:absolute;z-index:1;left:0;top:0;width:200px;height:200px"></div>
      </body></html>`,
    };
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 50, y: 50 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 200, height: 200 } },
        () => ({ width: 200, height: 200 }),
      )?.nodeId,
    ).toBe("back");
  });

  it("uses projection ancestry when authored ids are duplicated", () => {
    const screen = {
      id: "duplicate-id-screen",
      filename: "duplicate-id-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="duplicate" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:200px">
          <div data-agent-native-node-id="duplicate" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:200px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const result = getPrimitiveDropTargetForPoint(
      { x: 50, y: 50 },
      null,
      [screen],
      { [screen.id]: { x: 0, y: 0, width: 200, height: 200 } },
      () => ({ width: 200, height: 200 }),
    );
    expect(result?.nodeId).toBe("duplicate");
    expect(
      primitives.filter((primitive) => primitive.nodeId === "duplicate"),
    ).toHaveLength(2);
    expect(primitives[1]?.parentProjectionNodeId).toBe(
      primitives[0]?.projectionIdentity?.nodeId,
    );
    expect(result?.targetIdentity?.nodeId).toBe(
      primitives[1]?.projectionIdentity?.nodeId,
    );
  });

  it("keeps projection ancestry through duplicate authored ids when choosing a nested drop target", () => {
    const screen = {
      id: "duplicate-ancestor-screen",
      filename: "duplicate-ancestor-screen.html",
      content: `<div data-agent-native-node-id="container" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:240px;height:240px">
        <div data-agent-native-node-id="container" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:240px;height:240px">
          <div data-agent-native-node-id="target" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:240px;height:240px"></div>
        </div>
      </div>`,
    };

    expect(
      getPrimitiveDropTargetForPoint(
        { x: 80, y: 80 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 240, height: 240 } },
        () => ({ width: 240, height: 240 }),
      ),
    ).toMatchObject({ nodeId: "target" });
  });

  it("falls back to authored ancestry across an unannotated projection wrapper", () => {
    const screen = {
      id: "unannotated-wrapper-screen",
      filename: "unannotated-wrapper-screen.html",
      content: `<div data-agent-native-node-id="container" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:240px;height:240px">
        <div style="position:absolute;left:0;top:0;width:240px;height:240px">
          <div data-agent-native-node-id="target" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:240px;height:240px"></div>
        </div>
      </div>`,
    };

    expect(
      getPrimitiveDropTargetForPoint(
        { x: 80, y: 80 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 240, height: 240 } },
        () => ({ width: 240, height: 240 }),
      ),
    ).toMatchObject({ nodeId: "target" });
  });

  it("does not treat a duplicate-id sibling as an ancestor after a wrapper", () => {
    const screen = {
      id: "duplicate-sibling-screen",
      filename: "duplicate-sibling-screen.html",
      content: `<div data-agent-native-node-id="same" data-an-primitive="frame" style="position:absolute;z-index:10;left:0;top:0;width:240px;height:240px"></div>
        <div data-agent-native-node-id="same" data-an-primitive="frame" style="position:absolute;z-index:1;left:0;top:0;width:240px;height:240px">
          <div style="position:absolute;left:0;top:0;width:240px;height:240px">
            <div data-agent-native-node-id="target" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:240px;height:240px"></div>
          </div>
      </div>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const foregroundSibling = primitives.find(
      (primitive) => primitive.nodeId === "same",
    );
    expect(foregroundSibling?.projectionIdentity).toBeDefined();

    const result = getPrimitiveDropTargetForPoint(
      { x: 80, y: 80 },
      null,
      [screen],
      { [screen.id]: { x: 0, y: 0, width: 240, height: 240 } },
      () => ({ width: 240, height: 240 }),
    );
    expect(result).toMatchObject({
      nodeId: "same",
      targetIdentity: { nodeId: foregroundSibling!.projectionIdentity!.nodeId },
    });
  });

  it("treats semantic section containers as nested drop targets", () => {
    const screen = {
      id: "semantic-nested-screen",
      filename: "semantic-nested-screen.html",
      content: `<section data-agent-native-node-id="outer" style="display:flex;width:400px;height:190px">
        <section data-agent-native-node-id="inner" style="display:flex;width:360px;height:92px"></section>
      </section>`,
    };
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 40, y: 40 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 400, height: 190 } },
        () => ({ width: 400, height: 190 }),
      )?.nodeId,
    ).toBe("inner");
  });

  it("resolves percentage sizes against the containing block for overview hits", () => {
    const screen = {
      id: "percentage-screen",
      filename: "percentage-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:400px;height:300px;display:flex;flex-direction:column">
          <div data-agent-native-node-id="child" data-an-primitive="frame" style="width:100%;height:120px"></div>
        </div>
      </body></html>`,
    };

    const child = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "child",
    );
    expect(child).toMatchObject({
      localLeft: 0,
      localTop: 0,
      localWidth: 400,
      localHeight: 120,
    });
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 250, y: 60 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 400, height: 300 } },
        () => ({ width: 400, height: 300 }),
      )?.nodeId,
    ).toBe("child");
  });

  it("resolves flex Fill dimensions before choosing an overview target", () => {
    const screen = {
      id: "fill-screen",
      filename: "fill-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:200px;display:flex;flex-direction:row;gap:10px">
          <div data-agent-native-node-id="fixed" data-an-primitive="rectangle" style="width:80px;height:100px"></div>
          <div data-agent-native-node-id="fill" data-an-primitive="frame" style="height:100px;flex:1 1 0px"></div>
        </div>
      </body></html>`,
    };

    const fill = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "fill",
    );
    const parent = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "parent",
    );
    expect(parent?.autoLayoutOrderKnown).toBe(true);
    expect(fill).toMatchObject({
      localLeft: 90,
      localTop: 0,
      localWidth: 210,
      localHeight: 100,
    });
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 200, y: 60 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 300, height: 200 } },
        () => ({ width: 300, height: 200 }),
      )?.nodeId,
    ).toBe("fill");
  });

  it("subtracts a growing flex child's own main-axis margins", () => {
    const screen = {
      id: "fill-margin-screen",
      filename: "fill-margin-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:flex;gap:10px">
          <div data-agent-native-node-id="fixed" data-an-primitive="rectangle" style="width:80px;height:20px"></div>
          <div data-agent-native-node-id="fill" data-an-primitive="frame" style="flex:1 1 0px;height:20px;margin-left:10px;margin-right:20px"></div>
        </div>
      </body></html>`,
    };

    expect(
      parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "fill",
      ),
    ).toMatchObject({ localLeft: 100, localWidth: 180 });
  });

  it("uses an auto flex basis from in-flow content before distributing Fill space", () => {
    const screen = {
      id: "auto-basis-screen",
      filename: "auto-basis-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:flex;gap:10px">
          <div data-agent-native-node-id="content" data-an-primitive="frame" style="flex:0 1 auto;height:20px">
            <div data-agent-native-node-id="content-child" data-an-primitive="rectangle" style="width:80px;height:20px"></div>
          </div>
          <div data-agent-native-node-id="fill" data-an-primitive="frame" style="flex:1 1 0px;height:20px"></div>
        </div>
      </body></html>`,
    };

    expect(
      parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "content",
      ),
    ).toMatchObject({ localWidth: 80 });
    expect(
      parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "fill",
      ),
    ).toMatchObject({ localLeft: 90, localWidth: 210 });
  });

  it("keeps unitless zero sizes collapsed in the overview fallback", () => {
    const screen = {
      id: "zero-size-screen",
      filename: "zero-size-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:flex">
          <div data-agent-native-node-id="collapsed" data-an-primitive="frame" style="width:0;height:-0;flex:1 1 auto">
            <div style="width:80px;height:20px"></div>
          </div>
        </div>
      </body></html>`,
    };

    expect(
      parsePrimitivesFromScreen(screen).map((primitive) => primitive.nodeId),
    ).toEqual(["parent"]);
  });

  it("uses the row flex gap for both positioning and Fill allocation", () => {
    const screen = {
      id: "axis-gap-screen",
      filename: "axis-gap-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:flex;gap:10px 20px">
          <div data-agent-native-node-id="fixed" data-an-primitive="rectangle" style="width:80px;height:20px"></div>
          <div data-agent-native-node-id="fill" data-an-primitive="frame" style="flex:1 1 0px;height:20px"></div>
        </div>
      </body></html>`,
    };

    expect(
      parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "fill",
      ),
    ).toMatchObject({ localLeft: 100, localWidth: 200 });
  });

  it("leaves grid descendants to the live bridge instead of using whole-grid bounds", () => {
    const screen = {
      id: "grid-fallback-screen",
      filename: "grid-fallback-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="grid" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:200px;display:grid;grid-template-columns:100px 200px;grid-template-rows:100px 100px">
          <div data-agent-native-node-id="grid-child" data-an-primitive="frame" style="grid-column:2;grid-row:1;width:auto;height:auto">
            <div data-agent-native-node-id="nested" data-an-primitive="rectangle" style="width:20px;height:20px"></div>
          </div>
        </div>
      </body></html>`,
    };

    expect(
      parsePrimitivesFromScreen(screen).map((primitive) => primitive.nodeId),
    ).toEqual(["grid", "grid-child"]);
  });

  it("sizes an auto grid child from its authored track", () => {
    const screen = {
      id: "grid-auto-size-screen",
      filename: "grid-auto-size-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="grid" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:grid;grid-template-columns:100px 200px;grid-template-rows:100px">
          <div data-agent-native-node-id="child" data-an-primitive="rectangle" style="grid-column:2;grid-row:1;width:auto;height:auto"></div>
        </div>
      </body></html>`,
    };
    expect(
      parsePrimitivesFromScreen(screen).find((p) => p.nodeId === "child"),
    ).toMatchObject({ localWidth: 200, localHeight: 100 });
  });

  it("uses flex-basis for fixed items when estimating a Fill sibling", () => {
    const screen = {
      id: "basis-screen",
      filename: "basis-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:flex;gap:10px">
          <div data-agent-native-node-id="fixed" data-an-primitive="rectangle" style="flex:0 0 80px;height:20px"></div>
          <div data-agent-native-node-id="fill" data-an-primitive="frame" style="flex:1 1 0px;height:20px"></div>
        </div>
      </body></html>`,
    };

    expect(
      parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "fixed",
      ),
    ).toMatchObject({ localWidth: 80 });
    expect(
      parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "fill",
      ),
    ).toMatchObject({ localLeft: 90, localWidth: 210 });
  });

  it("resolves percentage children against a border-box content box", () => {
    const screen = {
      id: "border-box-screen",
      filename: "border-box-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:200px;box-sizing:border-box;border:10px solid #111;padding:10px;display:flex;flex-direction:column">
          <div data-agent-native-node-id="child" data-an-primitive="frame" style="width:100%;height:100%"></div>
        </div>
      </body></html>`,
    };

    expect(
      parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "child",
      ),
    ).toMatchObject({
      localLeft: 20,
      localTop: 20,
      localWidth: 260,
      localHeight: 160,
    });
  });

  it("does not let out-of-flow flex children consume Fill space", () => {
    const screen = {
      id: "out-of-flow-screen",
      filename: "out-of-flow-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:flex;gap:10px">
          <div data-agent-native-node-id="absolute" data-an-primitive="rectangle" style="position:absolute;left:0;top:0;width:100px;height:20px"></div>
          <div data-agent-native-node-id="fill" data-an-primitive="frame" style="flex:1 1 0px;height:20px"></div>
        </div>
      </body></html>`,
    };

    expect(
      parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "fill",
      ),
    ).toMatchObject({ localLeft: 0, localWidth: 300 });
  });

  it("resolves non-text Hug containers from their in-flow content", () => {
    const screen = {
      id: "hug-screen",
      filename: "hug-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:400px;height:300px">
          <div data-agent-native-node-id="hug" data-an-primitive="frame" style="width:fit-content;height:fit-content;display:flex;gap:5px;padding:10px">
            <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:80px;height:20px"></div>
            <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:30px"></div>
          </div>
        </div>
      </body></html>`,
    };

    const primitives = parsePrimitivesFromScreen(screen);
    expect(
      primitives.find((primitive) => primitive.nodeId === "hug"),
    ).toMatchObject({ localWidth: 145, localHeight: 50 });
  });

  it("accumulates nested absolute coordinates for frame targets", () => {
    const screen = {
      id: "screen",
      filename: "screen.html",
      content: `<!doctype html><html><body data-agent-native-node-id="body">
        <div data-agent-native-node-id="parent" style="position:absolute;left:300px;top:100px;width:400px;height:300px">
          <div data-agent-native-node-id="frame" data-an-primitive="frame" style="position:absolute;left:20px;top:30px;width:120px;height:90px"></div>
        </div>
      </body></html>`,
    };

    const frame = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "frame",
    );
    expect(frame).toMatchObject({
      localLeft: 320,
      localTop: 130,
      localWidth: 120,
      localHeight: 90,
      isContainer: true,
    });

    expect(
      getPrimitiveDropTargetForPoint(
        { x: 350, y: 160 },
        null,
        [screen],
        { screen: { x: 0, y: 0, width: 800, height: 600 } },
        () => ({ width: 800, height: 600 }),
      )?.nodeId,
    ).toBe("frame");
  });

  it("accounts for padding, gap, and preceding siblings in a flex frame", () => {
    const screen = {
      id: "screen",
      filename: "screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" style="position:absolute;left:300px;top:100px;width:500px;height:300px;display:flex;flex-direction:row;padding-left:20px;padding-top:15px;gap:10px">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:50px;height:40px"></div>
          <div data-agent-native-node-id="frame" data-an-primitive="frame" style="width:100px;height:80px"></div>
        </div>
      </body></html>`,
    };

    const frame = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "frame",
    );
    expect(frame).toMatchObject({
      localLeft: 380,
      localTop: 115,
      localWidth: 100,
      localHeight: 80,
      isContainer: true,
    });
  });

  it("derives intrinsic low-zoom hit bounds from drawn text typography and wrapping only", () => {
    const screen = {
      id: "board",
      filename: "__board__.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="label" data-an-primitive="text" style="position:absolute;left:35000px;top:100px">Edge label</div>
        <div data-agent-native-node-id="large" data-an-primitive="text" style="position:absolute;left:35000px;top:300px;font-size:40px;letter-spacing:2px">MMMM</div>
        <div data-agent-native-node-id="wrapped" data-an-primitive="text" style="position:absolute;left:35000px;top:500px;width:100px;font-size:20px;line-height:30px;white-space:normal">WWWWWWWWWWWWWWWWWWWW</div>
        <div data-agent-native-node-id="sizeless-rect" data-an-primitive="rectangle" style="position:absolute;left:36000px;top:100px"></div>
      </body></html>`,
    };

    const primitives = parsePrimitivesFromScreen(screen);
    expect(primitives.map((primitive) => primitive.nodeId)).toEqual([
      "label",
      "large",
      "wrapped",
    ]);
    expect(primitives[0]).toEqual(
      expect.objectContaining({
        nodeId: "label",
        localLeft: 35000,
        localTop: 100,
        localWidth: expect.closeTo(77.6, 3),
        localHeight: expect.closeTo(19.2, 3),
      }),
    );
    expect(primitives[1]).toEqual(
      expect.objectContaining({
        nodeId: "large",
        localWidth: expect.closeTo(137.2, 3),
        localHeight: 48,
      }),
    );
    expect(primitives[2]).toEqual(
      expect.objectContaining({
        nodeId: "wrapped",
        localWidth: 100,
        localHeight: 120,
      }),
    );
    const lowZoomHitRect = getPrimitiveLowZoomHitRect(primitives[0]!, 2);
    expect(lowZoomHitRect.x).toBeCloseTo(34888.8, 3);
    expect(lowZoomHitRect.y).toBeCloseTo(-40.4, 3);
    expect(lowZoomHitRect.width).toBe(300);
    expect(lowZoomHitRect.height).toBe(300);
  });
  it("ignores z-index on static non-flex/grid items", () => {
    const screen = {
      id: "static-z",
      filename: "static-z.html",
      content: `<!doctype html><html><body><div data-agent-native-node-id="a" data-an-primitive="frame" style="position:static;z-index:10;width:100px;height:100px"></div></body></html>`,
    };
    expect(parsePrimitivesFromScreen(screen)[0]?.zIndex).toBeUndefined();
  });

  it("orders ancestor stacking context before descendant z-index", () => {
    const screen = {
      id: "nested-z",
      filename: "nested-z.html",
      content: `<!doctype html><html><body><div data-agent-native-node-id="low" data-an-primitive="frame" style="position:absolute;z-index:1;left:0;top:0;width:100px;height:100px"><div data-agent-native-node-id="child" data-an-primitive="frame" style="position:absolute;z-index:999;left:0;top:0;width:100px;height:100px"></div></div><div data-agent-native-node-id="high" data-an-primitive="frame" style="position:absolute;z-index:2;left:0;top:0;width:100px;height:100px"></div></body></html>`,
    };
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 10, y: 10 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 100, height: 100 } },
        () => ({ width: 100, height: 100 }),
      )?.nodeId,
    ).toBe("high");
  });

  it("keeps DOM order for equal-z sibling stacking contexts", () => {
    const screen = {
      id: "equal-context-z",
      filename: "equal-context-z.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="early-context" data-an-primitive="frame" style="position:absolute;z-index:1;left:0;top:0;width:100px;height:100px">
          <div data-agent-native-node-id="early-child" data-an-primitive="frame" style="position:absolute;z-index:999;left:0;top:0;width:100px;height:100px"></div>
        </div>
        <div data-agent-native-node-id="late-context" data-an-primitive="frame" style="position:absolute;z-index:1;left:0;top:0;width:100px;height:100px">
          <div data-agent-native-node-id="late-child" data-an-primitive="frame" style="position:absolute;z-index:0;left:0;top:0;width:100px;height:100px"></div>
        </div>
      </body></html>`,
    };
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 10, y: 10 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 100, height: 100 } },
        () => ({ width: 100, height: 100 }),
      )?.nodeId,
    ).toBe("late-child");
  });

  it("keeps descendant z-index inside an auto stacking context", () => {
    const screen = {
      id: "auto-context-z",
      filename: "auto-context-z.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="auto-context" data-an-primitive="frame" style="transform:translateZ(0);left:0;top:0;width:100px;height:100px">
          <div data-agent-native-node-id="early-child" data-an-primitive="frame" style="position:absolute;z-index:999;left:0;top:0;width:100px;height:100px"></div>
        </div>
        <div data-agent-native-node-id="later" data-an-primitive="frame" style="position:absolute;z-index:1;left:0;top:0;width:100px;height:100px"></div>
      </body></html>`,
    };
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 10, y: 10 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 100, height: 100 } },
        () => ({ width: 100, height: 100 }),
      )?.nodeId,
    ).toBe("later");
  });
});

describe("auto-layout drop insertion anchor (WORK ITEM 1)", () => {
  const flexScreen = {
    id: "screen",
    filename: "screen.html",
    content: `<!doctype html><html><body>
      <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:300px;top:100px;width:500px;height:300px;display:flex;flex-direction:row;padding-left:20px;padding-top:15px;gap:10px">
        <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:50px;height:40px"></div>
        <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:60px;height:40px"></div>
      </div>
    </body></html>`,
  };
  const identityFrameGeometry = {
    screen: { x: 0, y: 0, width: 800, height: 600 },
  };
  const identityMetadata = () => ({ width: 800, height: 600 });

  it("parses the flex container's own auto-layout axis and each child's parent link", () => {
    const primitives = parsePrimitivesFromScreen(flexScreen);
    const parent = primitives.find((p) => p.nodeId === "parent");
    const first = primitives.find((p) => p.nodeId === "first");
    const second = primitives.find((p) => p.nodeId === "second");
    expect(parent?.autoLayoutAxis).toBe("x");
    expect(first?.parentNodeId).toBe("parent");
    expect(second?.parentNodeId).toBe("parent");
    expect(first?.autoLayoutAxis).toBeUndefined();
  });

  it("preserves flex direction in parsed auto-layout metadata", () => {
    for (const [flexDirection, axis] of [
      ["row-reverse", "x"],
      ["column-reverse", "y"],
    ] as const) {
      const screen = {
        ...flexScreen,
        id: `${flexDirection}-screen`,
        content: flexScreen.content.replace(
          "flex-direction:row",
          `flex-direction:${flexDirection}`,
        ),
      };
      expect(
        parsePrimitivesFromScreen(screen).find((p) => p.nodeId === "parent"),
      ).toMatchObject({
        autoLayoutAxis: axis,
        autoLayoutFlexDirection: flexDirection,
      });
    }
  });

  it("counts repeat grid columns and respects column auto-flow", () => {
    const screen = {
      ...flexScreen,
      content: flexScreen.content.replace(
        "display:flex;flex-direction:row",
        "display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));grid-auto-flow:row dense",
      ),
    };
    expect(
      parsePrimitivesFromScreen(screen).find((p) => p.nodeId === "parent")
        ?.autoLayoutAxis,
    ).toBe("x");

    const columnFlow = {
      ...screen,
      content: screen.content.replace(
        "grid-auto-flow:row dense",
        "grid-auto-flow:column dense",
      ),
    };
    expect(
      parsePrimitivesFromScreen(columnFlow).find((p) => p.nodeId === "parent")
        ?.autoLayoutAxis,
    ).toBe("y");
  });

  it("counts repeated tracks while ignoring multi-name grid lines", () => {
    const screen = {
      ...flexScreen,
      content: flexScreen.content.replace(
        "display:flex;flex-direction:row",
        "display:grid;grid-template-columns:[a b] repeat(2, 1fr 2fr) [c d]",
      ),
    };
    expect(
      parsePrimitivesFromScreen(screen).find((p) => p.nodeId === "parent")
        ?.autoLayoutAxis,
    ).toBe("x");
  });

  it("keeps multi-name bracket groups as one grid line", () => {
    const screen = {
      ...flexScreen,
      content: flexScreen.content.replace(
        "display:flex;flex-direction:row",
        "display:grid;grid-template-columns:[content-start sidebar-start] 1fr 1fr [content-end]",
      ),
    };
    expect(
      parsePrimitivesFromScreen(screen).find((p) => p.nodeId === "parent")
        ?.autoLayoutAxis,
    ).toBe("x");
  });

  it("skips an occupied explicit grid column during auto placement", () => {
    const screen = {
      id: "grid-occupancy-screen",
      filename: "grid-occupancy-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="grid" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:grid;grid-template-columns:100px 100px;grid-template-rows:50px 50px">
          <div data-agent-native-node-id="explicit" data-an-primitive="rectangle" style="grid-column:2;width:100px;height:50px"></div>
          <div data-agent-native-node-id="first-auto" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
          <div data-agent-native-node-id="second-auto" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
        </div>
      </body></html>`,
    };
    expect(parsePrimitivesFromScreen(screen)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "first-auto",
          localLeft: 0,
          localTop: 0,
        }),
        expect.objectContaining({
          nodeId: "second-auto",
          localLeft: 0,
          localTop: 50,
        }),
      ]),
    );
  });

  it("resolves named, negative, and spanning grid starts for fallback geometry", () => {
    const screen = {
      id: "grid-line-variants-screen",
      filename: "grid-line-variants-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="grid" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:grid;grid-template-columns:[first] 100px [second] 100px [third] 100px;grid-template-rows:50px 50px">
          <div data-agent-native-node-id="named" data-an-primitive="rectangle" style="grid-column:second;grid-row:1;width:100px;height:50px"></div>
          <div data-agent-native-node-id="negative" data-an-primitive="rectangle" style="grid-column:-2;grid-row:2;width:100px;height:50px"></div>
          <div data-agent-native-node-id="spanning" data-an-primitive="rectangle" style="grid-column:span 2;width:100px;height:50px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    expect(primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "named",
          localLeft: 100,
          localTop: 0,
        }),
        expect.objectContaining({
          nodeId: "negative",
          localLeft: 200,
          localTop: 50,
        }),
        expect.objectContaining({
          nodeId: "spanning",
          localLeft: 0,
          localTop: 50,
        }),
      ]),
    );
  });

  it("distributes remaining space above a minmax grid minimum", () => {
    const screen = {
      id: "grid-minmax-screen",
      filename: "grid-minmax-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="grid" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:grid;grid-template-columns:minmax(100px,1fr) 1fr;gap:10px">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="height:20px"></div>
        </div>
      </body></html>`,
    };
    expect(parsePrimitivesFromScreen(screen)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "second", localLeft: 155 }),
      ]),
    );
  });

  it("does not reserve row one for a one-axis explicit grid placement", () => {
    const screen = {
      id: "grid-one-axis-screen",
      filename: "grid-one-axis-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="grid" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:grid;grid-template-columns:100px 100px">
          <div data-agent-native-node-id="explicit" data-an-primitive="rectangle" style="grid-column:2;width:100px;height:50px"></div>
          <div data-agent-native-node-id="auto" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
        </div>
      </body></html>`,
    };
    const auto = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "auto",
    );
    expect(auto).toMatchObject({ localLeft: 0, localTop: 0 });
  });

  it("places later auto children on modeled implicit rows", () => {
    const screen = {
      id: "grid-implicit-rows-screen",
      filename: "grid-implicit-rows-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="grid" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:150px;display:grid;grid-template-columns:100px 100px">
          <div data-agent-native-node-id="explicit" data-an-primitive="rectangle" style="grid-column:2;width:100px;height:50px"></div>
          <div data-agent-native-node-id="first-auto" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
          <div data-agent-native-node-id="second-auto" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
          <div data-agent-native-node-id="third-auto" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
        </div>
      </body></html>`,
    };
    const third = parsePrimitivesFromScreen(screen).find(
      (p) => p.nodeId === "third-auto",
    );
    expect(third?.localLeft).toBe(100);
    expect(third?.localTop).toBeGreaterThan(0);
  });

  it("extends a one-row grid for later auto children", () => {
    const screen = {
      id: "grid-explicit-row-screen",
      filename: "grid-explicit-row-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="grid" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:100px;height:200px;display:grid;grid-template-columns:100px;grid-template-rows:50px">
          <div data-agent-native-node-id="one" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
          <div data-agent-native-node-id="two" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
          <div data-agent-native-node-id="three" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
          <div data-agent-native-node-id="four" data-an-primitive="rectangle" style="width:100px;height:50px"></div>
        </div>
      </body></html>`,
    };
    const four = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "four",
    );
    expect(four?.localTop).toBeGreaterThan(0);
    expect(Number.isFinite(four?.localTop)).toBe(true);
  });

  it("does not advertise fallback anchors for opaque auto-fit and auto-fill repeats", () => {
    for (const repeat of ["auto-fit", "auto-fill"]) {
      const screen = {
        ...flexScreen,
        content: flexScreen.content.replace(
          "display:flex;flex-direction:row",
          `display:grid;grid-template-columns:repeat(${repeat}, minmax(120px, 1fr))`,
        ),
      };
      expect(
        parsePrimitivesFromScreen(screen).find((p) => p.nodeId === "parent")
          ?.autoLayoutAxis,
      ).toBeUndefined();
    }
  });

  it("keeps nested minmax functions inside a repeat track", () => {
    const screen = {
      ...flexScreen,
      content: flexScreen.content.replace(
        "display:flex;flex-direction:row",
        "display:grid;grid-template-columns:repeat(1, minmax(0, 1fr))",
      ),
    };
    expect(
      parsePrimitivesFromScreen(screen).find((p) => p.nodeId === "parent")
        ?.autoLayoutAxis,
    ).toBe("y");
  });

  it("keeps direct grid children as before/after insertion anchors", () => {
    const screen = {
      ...flexScreen,
      content: flexScreen.content.replace(
        "display:flex;flex-direction:row",
        "display:grid;grid-template-columns:repeat(2, minmax(0, 1fr))",
      ),
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find((p) => p.nodeId === "parent")!;
    expect(primitives.map((p) => p.nodeId)).toEqual([
      "parent",
      "first",
      "second",
    ]);
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 310, y: 135 },
        null,
      ),
    ).toMatchObject({ anchorNodeId: "first", placement: "before" });
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 375, y: 135 },
        null,
      ),
    ).toMatchObject({ anchorNodeId: "first", placement: "after" });
  });

  it("uses authored grid placement when resolving direct child anchors", () => {
    const screen = {
      ...flexScreen,
      id: "grid-authored-position-screen",
      content: flexScreen.content
        .replace(
          "display:flex;flex-direction:row",
          "display:grid;grid-template-columns:[start] 100px [end] 200px;grid-template-rows:100px;gap:10px",
        )
        .replace(
          'data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:50px;height:40px"',
          'data-agent-native-node-id="first" data-an-primitive="rectangle" style="grid-column:2;grid-row:1;width:200px;height:100px"',
        ),
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find((p) => p.nodeId === "parent")!;
    expect(primitives.find((p) => p.nodeId === "first")).toMatchObject({
      localLeft: 430,
      localTop: 115,
    });
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 450, y: 140 },
        null,
      ),
    ).toMatchObject({ anchorNodeId: "first", placement: "before" });
  });

  it("findAutoLayoutInsertionAnchor resolves 'before' the nearest child when the point sits in the leading padding", () => {
    const primitives = parsePrimitivesFromScreen(flexScreen);
    const parent = primitives.find((p) => p.nodeId === "parent")!;
    const anchor = findAutoLayoutInsertionAnchor(
      parent,
      primitives,
      { x: 310, y: 135 },
      null,
    );
    const firstProjectionNodeId = primitives.find(
      (primitive) => primitive.nodeId === "first",
    )?.projectionIdentity?.nodeId;
    expect(firstProjectionNodeId).toMatch(/\S/);
    expect(anchor).toEqual({
      anchorNodeId: "first",
      anchorProjectionNodeId: firstProjectionNodeId,
      placement: "before",
      guidePlacement: "before",
    });
  });

  it("findAutoLayoutInsertionAnchor resolves 'after' the nearest child when the point sits in the gap between children", () => {
    const primitives = parsePrimitivesFromScreen(flexScreen);
    const parent = primitives.find((p) => p.nodeId === "parent")!;
    const anchor = findAutoLayoutInsertionAnchor(
      parent,
      primitives,
      { x: 375, y: 135 },
      null,
    );
    const firstProjectionNodeId = primitives.find(
      (primitive) => primitive.nodeId === "first",
    )?.projectionIdentity?.nodeId;
    expect(firstProjectionNodeId).toMatch(/\S/);
    expect(anchor).toEqual({
      anchorNodeId: "first",
      anchorProjectionNodeId: firstProjectionNodeId,
      placement: "after",
      guidePlacement: "after",
    });
  });

  it("keeps DOM insertion placement separate from the visual slot in reverse flex layouts", () => {
    const cases = [
      {
        direction: "row-reverse",
        axis: "x",
        firstStyle: "left:140px;top:20px;width:20px;height:20px",
        secondStyle: "left:30px;top:20px;width:20px;height:20px",
        beforePoint: { x: 135, y: 30 },
        afterPoint: { x: 165, y: 30 },
      },
      {
        direction: "column-reverse",
        axis: "y",
        firstStyle: "left:20px;top:80px;width:20px;height:20px",
        secondStyle: "left:20px;top:25px;width:20px;height:20px",
        beforePoint: { x: 30, y: 75 },
        afterPoint: { x: 30, y: 105 },
      },
    ] as const;

    for (const testCase of cases) {
      const screen = {
        id: testCase.direction,
        filename: `${testCase.direction}.html`,
        content: `<!doctype html><html><body>
          <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:${testCase.direction}">
            <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;${testCase.firstStyle}"></div>
            <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="position:absolute;${testCase.secondStyle}"></div>
          </div>
        </body></html>`,
      };
      const primitives = parsePrimitivesFromScreen(screen);
      const parent = primitives.find(
        (primitive) => primitive.nodeId === "parent",
      )!;
      expect(parent).toMatchObject({
        autoLayoutAxis: testCase.axis,
        autoLayoutFlexDirection: testCase.direction,
      });
      expect(
        findAutoLayoutInsertionAnchor(
          parent,
          primitives,
          testCase.beforePoint,
          null,
        ),
      ).toMatchObject({
        anchorNodeId: "first",
        placement: "after",
        guidePlacement: "before",
      });
      expect(
        findAutoLayoutInsertionAnchor(
          parent,
          primitives,
          testCase.afterPoint,
          null,
        ),
      ).toMatchObject({
        anchorNodeId: "first",
        placement: "before",
        guidePlacement: "after",
      });

      if (testCase.direction === "row-reverse") {
        expect(
          getPrimitiveDropTargetForPoint(
            testCase.beforePoint,
            null,
            [screen],
            { [screen.id]: { x: 0, y: 0, width: 200, height: 120 } },
            () => ({ width: 200, height: 120 }),
          ),
        ).toMatchObject({
          nodeId: "parent",
          anchorNodeId: "first",
          placement: "after",
          guidePlacement: "before",
          axis: "x",
        });
      }
    }
  });

  it("uses inherited RTL and nearer inline direction for row insertion", () => {
    const rtlScreen = {
      id: "rtl-row-screen",
      filename: "rtl-row-screen.html",
      content: `<!doctype html><html><body dir="rtl">
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;left:140px;top:20px;width:20px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="position:absolute;left:30px;top:20px;width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const rtlPrimitives = parsePrimitivesFromScreen(rtlScreen);
    const rtlParent = rtlPrimitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;
    expect(rtlParent.autoLayoutDirection).toBe("rtl");
    expect(
      findAutoLayoutInsertionAnchor(
        rtlParent,
        rtlPrimitives,
        { x: 135, y: 30 },
        null,
      ),
    ).toMatchObject({
      anchorNodeId: "first",
      placement: "after",
      guidePlacement: "before",
    });

    const inlineLtrScreen = {
      id: "inline-ltr-row-screen",
      filename: "inline-ltr-row-screen.html",
      content: `<!doctype html><html><body dir="rtl">
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row;direction:ltr">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;left:30px;top:20px;width:20px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="position:absolute;left:140px;top:20px;width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const inlineLtrPrimitives = parsePrimitivesFromScreen(inlineLtrScreen);
    const inlineLtrParent = inlineLtrPrimitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;
    expect(inlineLtrParent.autoLayoutDirection).toBe("ltr");
    expect(
      findAutoLayoutInsertionAnchor(
        inlineLtrParent,
        inlineLtrPrimitives,
        { x: 25, y: 30 },
        null,
      ),
    ).toMatchObject({
      anchorNodeId: "first",
      placement: "before",
      guidePlacement: "before",
    });
  });

  it("does not infer the main axis from a stylesheet flex-direction", () => {
    const screen = {
      ...flexScreen,
      id: "stylesheet-reverse-screen",
      content: `<!doctype html><html><head><style>
        .reversed { flex-direction: row-reverse; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="reversed" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;left:140px;top:20px;width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutAxis).toBeUndefined();
    expect(parent.autoLayoutFlexDirection).toBeUndefined();
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 135, y: 30 },
        null,
      ),
    ).toBeNull();
  });

  it("does not infer left-to-right order from stylesheet direction", () => {
    const screen = {
      ...flexScreen,
      id: "stylesheet-direction-screen",
      content: `<!doctype html><html><head><style>
        .rtl { direction: rtl; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="rtl" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;left:140px;top:20px;width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutAxis).toBe("x");
    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 135, y: 30 },
        null,
      ),
    ).toBeNull();
  });

  it("keeps inline flex ordering when the document links a stylesheet", () => {
    const screen = {
      ...flexScreen,
      id: "linked-stylesheet-inline-flex-screen",
      content: `<!doctype html><html><head>
        <link rel="stylesheet" href="data:text/css,">
      </head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;left:20px;top:20px;width:20px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="position:absolute;left:100px;top:20px;width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent).toMatchObject({
      autoLayoutAxis: "x",
      autoLayoutFlexDirection: "row",
      autoLayoutDirection: "ltr",
      autoLayoutOrderKnown: true,
    });
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 25, y: 30 }, null),
    ).toMatchObject({ anchorNodeId: "first", placement: "before" });
  });

  it("ignores lower-priority stylesheet values overridden by inline flex values", () => {
    const screen = {
      ...flexScreen,
      id: "lower-priority-stylesheet-flex-screen",
      content: `<!doctype html><html><head><style>
        .parent { flex-direction: column; direction: rtl; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row;direction:ltr">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;left:20px;top:20px;width:20px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="position:absolute;left:100px;top:20px;width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent).toMatchObject({
      autoLayoutAxis: "x",
      autoLayoutFlexDirection: "row",
      autoLayoutDirection: "ltr",
      autoLayoutOrderKnown: true,
    });
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 25, y: 30 }, null),
    ).toMatchObject({ anchorNodeId: "first", placement: "before" });
  });

  it("defers stylesheet important overrides unless inline flex values are important", () => {
    for (const inlineImportant of [false, true]) {
      const priority = inlineImportant ? " !important" : "";
      const screen = {
        ...flexScreen,
        id: `important-flex-priority-${inlineImportant}`,
        content: `<!doctype html><html><head><style>
          .parent { flex-direction: column !important; direction: rtl !important; }
        </style></head><body>
          <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row${priority};direction:ltr${priority}">
            <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;left:20px;top:20px;width:20px;height:20px"></div>
            <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="position:absolute;left:100px;top:20px;width:20px;height:20px"></div>
          </div>
        </body></html>`,
      };
      const primitives = parsePrimitivesFromScreen(screen);
      const parent = primitives.find(
        (primitive) => primitive.nodeId === "parent",
      )!;

      if (inlineImportant) {
        expect(parent).toMatchObject({
          autoLayoutAxis: "x",
          autoLayoutFlexDirection: "row",
          autoLayoutDirection: "ltr",
          autoLayoutOrderKnown: true,
        });
      } else {
        expect(parent).toMatchObject({
          autoLayoutAxis: undefined,
          autoLayoutOrderKnown: false,
        });
      }
    }
  });

  it("keeps column-flex ordering when inherited text direction is automatic", () => {
    const screen = {
      ...flexScreen,
      id: "column-flex-auto-direction-screen",
      content: `<!doctype html><html><body dir="auto">
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:200px;display:flex;flex-direction:column">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;left:20px;top:140px;width:20px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="position:absolute;left:20px;top:60px;width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent).toMatchObject({
      autoLayoutAxis: "y",
      autoLayoutOrderKnown: true,
    });
    expect(parent.autoLayoutDirection).toBeUndefined();
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 30, y: 145 },
        null,
      ),
    ).toMatchObject({ anchorNodeId: "first", placement: "before" });
  });

  it("does not fall back to an inside target when flex order is unknown", () => {
    const screen = {
      ...flexScreen,
      id: "unknown-flex-order-target-screen",
      content: `<!doctype html><html><head><style>
        .rtl { direction: rtl; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="rtl" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="position:absolute;left:10px;top:20px;width:20px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="position:absolute;left:80px;top:20px;width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };

    const target = getPrimitiveDropTargetForPoint(
      { x: 150, y: 100 },
      null,
      [screen],
      { [screen.id]: { x: 0, y: 0, width: 200, height: 120 } },
      () => ({ width: 200, height: 120 }),
    );
    expect(target === null).toBe(true);
  });

  it("maps in-flow reverse-flex children to their visual coordinates", () => {
    for (const testCase of [
      {
        id: "row-reverse-in-flow-screen",
        direction: "row-reverse",
        width: 200,
        height: 120,
        childWidth: 50,
        childHeight: 20,
        expectedFirst: { x: 150, y: 0 },
        expectedSecond: { x: 100, y: 0 },
        point: { x: 165, y: 10 },
      },
      {
        id: "column-reverse-in-flow-screen",
        direction: "column-reverse",
        width: 120,
        height: 200,
        childWidth: 20,
        childHeight: 40,
        expectedFirst: { x: 0, y: 160 },
        expectedSecond: { x: 0, y: 120 },
        point: { x: 10, y: 175 },
      },
    ] as const) {
      const screen = {
        id: testCase.id,
        filename: `${testCase.id}.html`,
        content: `<!doctype html><html><body>
          <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:${testCase.width}px;height:${testCase.height}px;display:flex;flex-direction:${testCase.direction}">
            <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:${testCase.childWidth}px;height:${testCase.childHeight}px"></div>
            <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:${testCase.childWidth}px;height:${testCase.childHeight}px"></div>
          </div>
        </body></html>`,
      };
      const primitives = parsePrimitivesFromScreen(screen);
      const parent = primitives.find(
        (primitive) => primitive.nodeId === "parent",
      )!;
      expect(
        primitives.find((primitive) => primitive.nodeId === "first"),
      ).toMatchObject({
        localLeft: testCase.expectedFirst.x,
        localTop: testCase.expectedFirst.y,
      });
      expect(
        primitives.find((primitive) => primitive.nodeId === "second"),
      ).toMatchObject({
        localLeft: testCase.expectedSecond.x,
        localTop: testCase.expectedSecond.y,
      });
      expect(
        findAutoLayoutInsertionAnchor(parent, primitives, testCase.point, null),
      ).toMatchObject({
        anchorNodeId: "first",
        placement: "after",
        guidePlacement: "before",
      });
    }
  });

  it("maps reverse-flow items with padding, borders, gap, and margins", () => {
    const screen = {
      id: "row-reverse-box-model-screen",
      filename: "row-reverse-box-model-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:20px;top:10px;box-sizing:border-box;width:320px;height:120px;display:flex;flex-direction:row-reverse;gap:10px;padding:8px 20px 8px 10px;border:2px solid #111;border-right-width:4px">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:50px;height:20px;margin-left:3px;margin-right:5px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px;margin-left:7px;margin-right:11px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;
    expect(
      primitives
        .filter((primitive) => ["first", "second"].includes(primitive.nodeId))
        .map(({ nodeId, localLeft, localTop }) => ({
          nodeId,
          localLeft,
          localTop,
        })),
    ).toEqual([
      { nodeId: "first", localLeft: 261, localTop: 20 },
      { nodeId: "second", localLeft: 197, localTop: 20 },
    ]);
    expect(parent.autoLayoutOrderKnown).toBe(true);
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 270, y: 30 },
        null,
      ),
    ).toMatchObject({
      anchorNodeId: "first",
      placement: "after",
      guidePlacement: "before",
    });
  });

  it("ignores unrelated imports and inactive conditional flex declarations", () => {
    const screen = {
      ...flexScreen,
      id: "inactive-flex-stylesheet-screen",
      content: `<!doctype html><html><head>
        <style>@import url("data:text/css,%2Eparent%20%7B%20color%3A%20red%3B%20%7D");</style>
        <style>
        @media print { .parent { justify-content: center; } }
        </style>
        <style>
        @supports (display: definitely-not-a-display-value) {
          .parent { justify-content: center; }
        }
        </style>
      </head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;
    expect(parent).toMatchObject({
      autoLayoutAxis: "x",
      autoLayoutFlexDirection: "row",
      autoLayoutOrderKnown: true,
    });
  });

  it.each([
    { id: "initial", value: "initial" },
    { id: "variable", value: "var(--axis)" },
  ])("defers flex ordering for an unresolved direction ($id)", (testCase) => {
    const screen = {
      ...flexScreen,
      id: `unresolved-flex-direction-${testCase.id}`,
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:${testCase.value};--axis:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutAxis).toBeUndefined();
    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 10, y: 10 }, null),
    ).toBeNull();
  });

  it("defers reverse flex ordering for an unresolved flex-flow shorthand", () => {
    const screen = {
      ...flexScreen,
      id: "unresolved-flex-flow-shorthand-screen",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-flow:var(--flow);--flow:row-reverse wrap">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 10, y: 10 }, null),
    ).toBeNull();
  });

  it("defers flex ordering when direct text creates an anonymous flex item", () => {
    const screen = {
      ...flexScreen,
      id: "anonymous-flex-text-item-screen",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
          anonymous flex item
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 10, y: 10 }, null),
    ).toBeNull();
  });

  it.each([
    {
      id: "row-calc-width",
      direction: "row-reverse",
      childStyle: "width:calc(60px + 40px);height:20px",
    },
    {
      id: "row-variable-width",
      direction: "row-reverse",
      childStyle: "width:var(--item-width);--item-width:100px;height:20px",
    },
    {
      id: "row-min-width",
      direction: "row-reverse",
      childStyle: "width:40px;min-width:100px;flex-shrink:0;height:20px",
    },
    {
      id: "row-max-width",
      direction: "row-reverse",
      childStyle: "width:100px;max-width:20px;flex-shrink:0;height:20px",
    },
    {
      id: "column-calc-height",
      direction: "column-reverse",
      childStyle: "width:20px;height:calc(10px + 10px)",
    },
    {
      id: "column-min-height",
      direction: "column-reverse",
      childStyle: "width:20px;height:20px;min-height:50px;flex-shrink:0",
    },
    {
      id: "column-max-height",
      direction: "column-reverse",
      childStyle: "width:20px;height:100px;max-height:10px;flex-shrink:0",
    },
  ])("defers flex ordering for unresolved inline sizing ($id)", (testCase) => {
    const screen = {
      ...flexScreen,
      id: `unresolved-flex-sizing-${testCase.id}`,
      content: `<!doctype html><html><body>
          <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:200px;display:flex;flex-direction:${testCase.direction}">
            <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="${testCase.childStyle}"></div>
            <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
          </div>
        </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 10, y: 10 }, null),
    ).toBeNull();
  });

  it.each([
    {
      id: "destination-narrower",
      width: 400,
      activeBreakpointWidth: undefined,
      editorMatches: false,
      known: false,
    },
    {
      id: "destination-active-breakpoint",
      width: 800,
      activeBreakpointWidth: 400,
      editorMatches: false,
      known: false,
    },
    {
      id: "destination-wider",
      width: 800,
      activeBreakpointWidth: undefined,
      editorMatches: true,
      known: true,
    },
    {
      id: "destination-width-missing",
      width: undefined,
      activeBreakpointWidth: undefined,
      editorMatches: false,
      known: false,
    },
  ])(
    "uses the destination viewport for media flex declarations ($id)",
    (testCase) => {
      const matchMedia = vi
        .spyOn(window, "matchMedia")
        .mockImplementation(
          () => ({ matches: testCase.editorMatches }) as MediaQueryList,
        );
      try {
        const screen = {
          ...flexScreen,
          id: `destination-media-viewport-${testCase.id}`,
          width: testCase.width,
          activeBreakpointWidth: testCase.activeBreakpointWidth,
          content: `<!doctype html><html><head><style>
            @media (max-width: 500px) { .parent { flex-direction: column-reverse; } }
          </style></head><body>
            <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex">
              <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
              <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
            </div>
          </body></html>`,
        };
        const parent = parsePrimitivesFromScreen(screen).find(
          (primitive) => primitive.nodeId === "parent",
        )!;

        expect(parent.autoLayoutOrderKnown).toBe(testCase.known);
        expect(parent.autoLayoutAxis).toBe(testCase.known ? "x" : undefined);
      } finally {
        matchMedia.mockRestore();
      }
    },
  );

  it("recomputes media-dependent primitives when a screen viewport changes", () => {
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockImplementation(() => ({ matches: false }) as MediaQueryList);
    try {
      const content = `<!doctype html><html><head><style>
        @media (max-width: 500px) { .parent { flex-direction: column-reverse; } }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`;
      const narrow = parsePrimitivesFromScreen({
        ...flexScreen,
        id: "destination-media-cache-screen",
        width: 400,
        content,
      }).find((primitive) => primitive.nodeId === "parent")!;
      const wide = parsePrimitivesFromScreen({
        ...flexScreen,
        id: "destination-media-cache-screen",
        width: 800,
        content,
      }).find((primitive) => primitive.nodeId === "parent")!;

      expect(narrow.autoLayoutOrderKnown).toBe(false);
      expect(wide).toMatchObject({
        autoLayoutAxis: "x",
        autoLayoutFlexDirection: "row",
        autoLayoutOrderKnown: true,
      });
    } finally {
      matchMedia.mockRestore();
    }
  });

  it("blocks nested targets under a stylesheet-defined unknown-axis flex ancestor", () => {
    const screen = {
      ...flexScreen,
      id: "unknown-axis-flex-ancestor-screen",
      content: `<!doctype html><html><head><style>
        .reverse { flex-direction: row-reverse; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="reverse" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex">
          <div data-agent-native-node-id="nested" data-an-primitive="frame" style="width:80px;height:60px">
            <div data-agent-native-node-id="child" data-an-primitive="rectangle" style="width:20px;height:20px"></div>
          </div>
        </div>
      </body></html>`,
    };
    const target = getPrimitiveDropTargetForPoint(
      { x: 10, y: 10 },
      null,
      [screen],
      { [screen.id]: { x: 0, y: 0, width: 200, height: 100 } },
      () => ({ width: 200, height: 100 }),
    );

    expect(target).toBeNull();
  });

  it("blocks nested targets under forward flex with unknown ordering geometry", () => {
    const screen = {
      ...flexScreen,
      id: "unknown-forward-flex-ancestor-screen",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row;justify-content:center">
          <div data-agent-native-node-id="nested" data-an-primitive="frame" style="width:80px;height:60px">
            <div data-agent-native-node-id="child" data-an-primitive="rectangle" style="width:20px;height:20px"></div>
          </div>
        </div>
      </body></html>`,
    };
    const target = getPrimitiveDropTargetForPoint(
      { x: 10, y: 10 },
      null,
      [screen],
      { [screen.id]: { x: 0, y: 0, width: 200, height: 100 } },
      () => ({ width: 200, height: 100 }),
    );

    expect(target).toBeNull();
  });

  it("defers flex ordering when inherited writing mode changes the row axis", () => {
    const screen = {
      ...flexScreen,
      id: "vertical-writing-mode-flex-screen",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse;writing-mode:vertical-rl">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 10, y: 10 }, null),
    ).toBeNull();
  });

  it("defers flex ordering when writing mode is inherited from a stylesheet", () => {
    const screen = {
      ...flexScreen,
      id: "stylesheet-inherited-writing-mode-flex-screen",
      content: `<!doctype html><html><head><style>
        html { writing-mode: vertical-lr; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutAxis).toBeUndefined();
    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 10, y: 10 }, null),
    ).toBeNull();
  });

  it("uses border-box flex item sizes when deriving reverse-flow coordinates", () => {
    const screen = {
      ...flexScreen,
      id: "reverse-flex-border-box-item-screen",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;box-sizing:border-box;width:200px;height:100px;display:flex;flex-direction:row-reverse;gap:10px;padding:5px 10px;border:2px solid #111">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="box-sizing:border-box;width:40px;height:20px;padding-left:10px;border-left:2px solid #111;border-right:2px solid #111;margin-left:3px;margin-right:4px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(true);
    expect(parent.localWidth).toBe(200);
    expect(
      primitives.find((primitive) => primitive.nodeId === "first"),
    ).toMatchObject({ localLeft: 144, localWidth: 40 });
    expect(
      primitives.find((primitive) => primitive.nodeId === "second")?.localLeft,
    ).toBe(91);
  });

  it("does not let an unrelated imported rule defer inline flex ordering", () => {
    const importedCss = ".parent { color: red; }";
    const href = `data:text/css,${encodeURIComponent(importedCss)}`;
    const screen = {
      ...flexScreen,
      id: "unrelated-imported-flex-rule-screen",
      content: `<!doctype html><html><head><style>
        @import url("${href}");
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parseWithImportedStylesheet(screen, importedCss);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent).toMatchObject({
      autoLayoutAxis: "x",
      autoLayoutOrderKnown: true,
    });
  });

  it("respects imported important values against inline cascade priority", () => {
    const importedCss = ".parent { justify-content: center !important; }";
    const href = `data:text/css,${encodeURIComponent(importedCss)}`;
    for (const inlineImportant of [false, true]) {
      const priority = inlineImportant ? " !important" : "";
      const screen = {
        ...flexScreen,
        id: `imported-important-flex-override-screen-${inlineImportant}`,
        content: `<!doctype html><html><head><style>
          @import url("${href}");
        </style></head><body>
          <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:200px;height:120px;display:flex;flex-direction:row;justify-content:flex-start${priority}">
            <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:20px;height:20px"></div>
          </div>
        </body></html>`,
      };
      const primitives = parseWithImportedStylesheet(screen, importedCss);
      const parent = primitives.find(
        (primitive) => primitive.nodeId === "parent",
      )!;

      expect(parent).toMatchObject({
        autoLayoutAxis: "x",
        autoLayoutOrderKnown: inlineImportant,
      });
      const anchor = findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 10, y: 10 },
        null,
      );
      if (inlineImportant) expect(anchor).not.toBeNull();
      else expect(anchor).toBeNull();
    }
  });

  it("keeps reverse-flex coordinates in the item border box", () => {
    const screen = {
      id: "reverse-flex-child-border-box-screen",
      filename: "reverse-flex-child-border-box-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;box-sizing:border-box;width:200px;height:100px;display:flex;flex-direction:row-reverse;gap:5px;padding:4px 10px;border:2px solid #111">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:40px;height:20px;padding-left:10px;padding-right:6px;border-left:2px solid #111;border-right:2px solid #111;margin-left:3px;margin-right:5px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:30px;height:20px;margin-left:7px;margin-right:11px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(
      primitives
        .filter((primitive) => ["first", "second"].includes(primitive.nodeId))
        .map(({ nodeId, localLeft, localTop, localWidth }) => ({
          nodeId,
          localLeft,
          localTop,
          localWidth,
        })),
    ).toEqual([
      { nodeId: "first", localLeft: 123, localTop: 6, localWidth: 60 },
      { nodeId: "second", localLeft: 74, localTop: 6, localWidth: 30 },
    ]);
    expect(parent.autoLayoutOrderKnown).toBe(true);
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 165, y: 12 },
        null,
      ),
    ).toMatchObject({ anchorNodeId: "first", placement: "before" });
  });

  it("keeps visual CSS-order coordinates but defers DOM insertion across order groups", () => {
    const screen = {
      id: "reverse-flex-css-order-screen",
      filename: "reverse-flex-css-order-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:100px;display:flex;flex-direction:row-reverse;gap:5px">
          <div data-agent-native-node-id="last" data-an-primitive="rectangle" style="order:2;width:20px;height:20px"></div>
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="order:0;width:30px;height:20px"></div>
          <div data-agent-native-node-id="middle" data-an-primitive="rectangle" style="order:1;width:40px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(
      primitives
        .filter((primitive) =>
          ["first", "middle", "last"].includes(primitive.nodeId),
        )
        .map(({ nodeId, localLeft }) => ({ nodeId, localLeft })),
    ).toEqual([
      { nodeId: "last", localLeft: 200 },
      { nodeId: "first", localLeft: 270 },
      { nodeId: "middle", localLeft: 225 },
    ]);
    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 285, y: 10 },
        null,
      ),
    ).toBeNull();
  });

  it("defers reverse-flex insertion for a non-default shared CSS order group", () => {
    const screen = {
      ...flexScreen,
      id: "reverse-flex-shared-css-order-screen",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="order:1;width:30px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="order:1;width:30px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const parent = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
  });

  it("defers reverse-flex slots when a stylesheet supplies the main-axis gap", () => {
    const screen = {
      ...flexScreen,
      id: "reverse-flex-stylesheet-gap-screen",
      content: `<!doctype html><html><head><style>
        .parent { column-gap: 20px; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:300px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:30px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:30px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 285, y: 10 },
        null,
      ),
    ).toBeNull();
  });

  it("skips provably inactive container queries and defers active queries", () => {
    for (const testCase of [
      {
        id: "inactive-container-query",
        query: "min-width: 400px",
        known: true,
      },
      { id: "active-container-query", query: "min-width: 100px", known: false },
    ]) {
      const screen = {
        ...flexScreen,
        id: testCase.id,
        content: `<!doctype html><html><head><style>
          @container (${testCase.query}) { .parent { justify-content: center; } }
        </style></head><body>
          <div class="query-container" style="container-type:inline-size;width:300px;height:120px">
            <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse">
              <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:30px;height:20px"></div>
              <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:30px;height:20px"></div>
            </div>
          </div>
        </body></html>`,
      };
      const parent = parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "parent",
      )!;

      expect(parent.autoLayoutOrderKnown).toBe(testCase.known);
    }
  });

  it("defers container queries when stylesheet sizing can change the query size", () => {
    const screen = {
      ...flexScreen,
      id: "stylesheet-sized-container-query-screen",
      content: `<!doctype html><html><head><style>
        .query-container { width: 500px !important; }
        @container (min-width: 400px) { .parent { justify-content: center; } }
      </style></head><body>
        <div class="query-container" style="container-type:inline-size;width:300px;height:120px">
          <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse">
            <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:30px;height:20px"></div>
            <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:30px;height:20px"></div>
          </div>
        </div>
      </body></html>`,
    };
    const parent = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
  });

  it.each([
    {
      id: "stylesheet-flex-child-width",
      css: ".child { width: 100px; }",
      parentStyle:
        "position:absolute;left:0;top:0;width:300px;height:100px;display:flex;flex-direction:row-reverse",
      childStyle: "height:20px",
    },
    {
      id: "stylesheet-flex-child-box-decoration",
      css: ".child { padding: 10px; border: 2px solid #111; }",
      parentStyle:
        "position:absolute;left:0;top:0;width:300px;height:100px;display:flex;flex-direction:row-reverse",
      childStyle: "width:30px;height:20px",
    },
    {
      id: "stylesheet-flex-parent-box-sizing",
      css: ".parent { box-sizing: border-box; padding: 20px; }",
      parentStyle:
        "position:absolute;left:0;top:0;width:300px;height:100px;display:flex;flex-direction:row-reverse",
      childStyle: "width:30px;height:20px",
    },
    {
      id: "stylesheet-flex-basis",
      css: ".child { flex-basis: 100px; }",
      parentStyle:
        "position:absolute;left:0;top:0;width:300px;height:100px;display:flex;flex-direction:row-reverse",
      childStyle: "width:30px;height:20px",
    },
  ])(
    "defers reverse-flex geometry changed by stylesheet sizing ($id)",
    (testCase) => {
      const screen = {
        ...flexScreen,
        id: testCase.id,
        content: `<!doctype html><html><head><style>
        ${testCase.css}
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="${testCase.parentStyle}">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" class="child" style="${testCase.childStyle}"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" class="child" style="width:30px;height:20px"></div>
        </div>
      </body></html>`,
      };
      const primitives = parsePrimitivesFromScreen(screen);
      const parent = primitives.find(
        (primitive) => primitive.nodeId === "parent",
      )!;

      expect(parent.autoLayoutOrderKnown).toBe(false);
      expect(
        findAutoLayoutInsertionAnchor(
          parent,
          primitives,
          { x: 285, y: 10 },
          null,
        ),
      ).toBeNull();
    },
  );

  it("defers reverse-flex slots when stylesheet inline-size changes a row main axis", () => {
    const screen = {
      ...flexScreen,
      id: "reverse-flex-stylesheet-inline-size-screen",
      content: `<!doctype html><html><head><style>
        .parent { inline-size: 100px !important; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;width:300px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:30px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:30px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 285, y: 10 },
        null,
      ),
    ).toBeNull();
  });

  it("defers column-reverse slots when stylesheet border-block changes item extents", () => {
    const screen = {
      ...flexScreen,
      id: "reverse-flex-stylesheet-border-block-screen",
      content: `<!doctype html><html><head><style>
        .child { border-block: 2px solid #111; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:100px;height:300px;display:flex;flex-direction:column-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" class="child" style="width:30px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:30px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 10, y: 285 },
        null,
      ),
    ).toBeNull();
  });

  it("keeps inline box and gap values when lower-priority stylesheet rules disagree", () => {
    const screen = {
      ...flexScreen,
      id: "inline-reverse-flex-box-values-screen",
      content: `<!doctype html><html><head><style>
        .parent { inline-size: 100px; gap: 20px; padding-right: 40px; }
        .child { padding-left: 20px; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;box-sizing:border-box;width:200px;height:100px;display:flex;flex-direction:row-reverse;gap:5px;padding-right:5px">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" class="child" style="width:40px;height:20px;padding-left:2px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" class="child" style="width:40px;height:20px;padding-left:2px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(true);
    expect(
      primitives.find((primitive) => primitive.nodeId === "first")?.localLeft,
    ).toBe(153);
    expect(
      findAutoLayoutInsertionAnchor(
        parent,
        primitives,
        { x: 160, y: 10 },
        null,
      ),
    ).not.toBeNull();
  });

  it("keeps inline important geometry ahead of important stylesheet shorthands", () => {
    const screen = {
      ...flexScreen,
      id: "inline-important-reverse-flex-box-values-screen",
      content: `<!doctype html><html><head><style>
        .parent { inline-size: 100px !important; gap: 20px !important; padding: 40px !important; }
        .child { padding: 20px !important; border-block: 20px solid #111 !important; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" class="parent" style="position:absolute;left:0;top:0;box-sizing:border-box;width:200px!important;height:100px;display:flex;flex-direction:row-reverse;gap:5px!important;padding:5px 5px 5px 0!important">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" class="child" style="width:40px;height:20px;padding:0 0 0 2px!important;border-top-width:0!important;border-bottom-width:0!important"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" class="child" style="width:40px;height:20px;padding:0 0 0 2px!important;border-top-width:0!important;border-bottom-width:0!important"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(true);
    expect(
      primitives.find((primitive) => primitive.nodeId === "first")?.localLeft,
    ).toBe(153);
  });

  it("uses a fixed explicit flex-basis instead of the main-axis width", () => {
    const screen = {
      ...flexScreen,
      id: "reverse-flex-basis-overrides-width-screen",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="flex:0 0 100px;width:20px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(
      primitives.find((primitive) => primitive.nodeId === "first")?.localLeft,
    ).toBe(100);
    expect(parent.autoLayoutOrderKnown).toBe(true);
  });

  it("defers reverse-flex ordering for an unsupported non-auto flex-basis", () => {
    const screen = {
      ...flexScreen,
      id: "reverse-flex-unsupported-basis-screen",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="flex-basis:content;width:20px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:20px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const parent = parsePrimitivesFromScreen(screen).find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
  });

  it.each([
    {
      id: "reverse-flex-logical-margin-screen",
      childStyle: "width:40px;height:20px;margin-inline-start:12px",
    },
    {
      id: "reverse-flex-percent-margin-screen",
      childStyle: "width:40px;height:20px;margin-right:10%",
    },
  ])(
    "defers reverse-flex ordering for unmodeled main-axis margins ($id)",
    (testCase) => {
      const screen = {
        ...flexScreen,
        id: testCase.id,
        content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="${testCase.childStyle}"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`,
      };
      const parent = parsePrimitivesFromScreen(screen).find(
        (primitive) => primitive.nodeId === "parent",
      )!;

      expect(parent.autoLayoutOrderKnown).toBe(false);
    },
  );

  it.each([
    {
      id: "reverse-flex-centered-cross-axis-screen",
      parentStyle:
        "position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse;align-items:center",
      childStyle: "width:40px;height:20px",
    },
    {
      id: "reverse-flex-end-self-cross-axis-screen",
      parentStyle:
        "position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse",
      childStyle: "width:40px;height:20px;align-self:flex-end",
    },
  ])(
    "defers slots when cross-axis alignment shifts item geometry ($id)",
    (testCase) => {
      const screen = {
        ...flexScreen,
        id: testCase.id,
        content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="${testCase.parentStyle}">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="${testCase.childStyle}"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`,
      };
      const primitives = parsePrimitivesFromScreen(screen);
      const parent = primitives.find(
        (primitive) => primitive.nodeId === "parent",
      )!;

      expect(parent.autoLayoutOrderKnown).toBe(false);
      expect(
        findAutoLayoutInsertionAnchor(
          parent,
          primitives,
          { x: 190, y: 50 },
          null,
        ),
      ).toBeNull();
    },
  );

  it("defers when a stylesheet can change flex-item order", () => {
    const screen = {
      id: "reverse-flex-stylesheet-order-screen",
      filename: "reverse-flex-stylesheet-order-screen.html",
      content: `<!doctype html><html><head><style>
        .later { order: 2; }
      </style></head><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" class="later" style="width:40px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 50, y: 10 }, null),
    ).toBeNull();
  });

  for (const testCase of [
    {
      label: "main-axis auto margins",
      id: "reverse-flex-auto-margin-screen",
      parentStyle: "flex-direction:row-reverse",
      firstStyle: "margin-left:auto;width:40px;height:20px",
    },
    {
      label: "wrapped lines",
      id: "reverse-flex-wrap-screen",
      parentStyle: "flex-direction:row-reverse;flex-wrap:wrap",
      firstStyle: "width:40px;height:20px",
    },
  ]) {
    it(`defers flex ordering for ${testCase.label}`, () => {
      const screen = {
        id: testCase.id,
        filename: `${testCase.id}.html`,
        content: `<!doctype html><html><body>
          <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;${testCase.parentStyle}">
            <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="${testCase.firstStyle}"></div>
            <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:40px;height:20px"></div>
          </div>
        </body></html>`,
      };
      const primitives = parsePrimitivesFromScreen(screen);
      const parent = primitives.find(
        (primitive) => primitive.nodeId === "parent",
      )!;

      expect(parent.autoLayoutOrderKnown).toBe(false);
      expect(
        findAutoLayoutInsertionAnchor(
          parent,
          primitives,
          { x: 50, y: 10 },
          null,
        ),
      ).toBeNull();
      expect(
        getPrimitiveDropTargetForPoint(
          { x: 50, y: 10 },
          null,
          [screen],
          { [screen.id]: { x: 0, y: 0, width: 200, height: 100 } },
          () => ({ width: 200, height: 100 }),
        ),
      ).toBeNull();
    });
  }

  it("defers reverse-flex ordering when flex grow changes item sizes", () => {
    const screen = {
      id: "reverse-flex-grow-screen",
      filename: "reverse-flex-grow-screen.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="flex:1 1 40px;width:40px;height:20px"></div>
          <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="flex:1 1 40px;width:40px;height:20px"></div>
        </div>
      </body></html>`,
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 50, y: 10 }, null),
    ).toBeNull();
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 50, y: 10 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 200, height: 100 } },
        () => ({ width: 200, height: 100 }),
      ),
    ).toBeNull();
  });

  it("defers flex slots when justification or shrink changes estimated positions", () => {
    const cases = [
      {
        id: "reverse-flex-centered-screen",
        parentStyle:
          "width:200px;height:120px;display:flex;flex-direction:row-reverse;justify-content:center",
      },
      {
        id: "reverse-flex-shrink-screen",
        parentStyle:
          "width:80px;height:120px;display:flex;flex-direction:row-reverse;gap:10px",
      },
    ];

    for (const testCase of cases) {
      const screen = {
        id: testCase.id,
        filename: `${testCase.id}.html`,
        content: `<!doctype html><html><body>
          <div data-agent-native-node-id="parent" data-an-primitive="frame" style="position:absolute;left:0;top:0;${testCase.parentStyle}">
            <div data-agent-native-node-id="first" data-an-primitive="rectangle" style="width:50px;height:20px"></div>
            <div data-agent-native-node-id="second" data-an-primitive="rectangle" style="width:50px;height:20px"></div>
          </div>
        </body></html>`,
      };
      const primitives = parsePrimitivesFromScreen(screen);
      const parent = primitives.find(
        (primitive) => primitive.nodeId === "parent",
      )!;

      expect(parent.autoLayoutOrderKnown).toBe(false);
      expect(
        findAutoLayoutInsertionAnchor(
          parent,
          primitives,
          { x: 50, y: 50 },
          null,
        ),
      ).toBeNull();
      const target = getPrimitiveDropTargetForPoint(
        { x: 150, y: 80 },
        null,
        [screen],
        { [screen.id]: { x: 0, y: 0, width: 200, height: 120 } },
        () => ({ width: 200, height: 120 }),
      );
      expect(target === null).toBe(true);
    }
  });

  it("does not infer left-to-right insertion order for dir=auto", () => {
    const screen = {
      ...flexScreen,
      id: "dir-auto-order-screen",
      content: flexScreen.content.replace("<body>", '<body dir="auto">'),
    };
    const primitives = parsePrimitivesFromScreen(screen);
    const parent = primitives.find(
      (primitive) => primitive.nodeId === "parent",
    )!;

    expect(parent.autoLayoutAxis).toBe("x");
    expect(parent.autoLayoutOrderKnown).toBe(false);
    expect(
      findAutoLayoutInsertionAnchor(parent, primitives, { x: 25, y: 30 }, null),
    ).toBeNull();
  });

  it("findAutoLayoutInsertionAnchor excludes the dragged node itself (reordering within its own container)", () => {
    const primitives = parsePrimitivesFromScreen(flexScreen);
    const parent = primitives.find((p) => p.nodeId === "parent")!;
    const anchor = findAutoLayoutInsertionAnchor(
      parent,
      primitives,
      { x: 310, y: 135 },
      "first",
    );
    const secondProjectionNodeId = primitives.find(
      (primitive) => primitive.nodeId === "second",
    )?.projectionIdentity?.nodeId;
    expect(secondProjectionNodeId).toMatch(/\S/);
    expect(anchor).toEqual({
      anchorNodeId: "second",
      anchorProjectionNodeId: secondProjectionNodeId,
      placement: "before",
      guidePlacement: "before",
    });
  });

  it("findAutoLayoutInsertionAnchor returns null for a non-auto-layout container", () => {
    const primitives = parsePrimitivesFromScreen(flexScreen);
    const first = primitives.find((p) => p.nodeId === "first")!;
    expect(
      findAutoLayoutInsertionAnchor(first, primitives, { x: 0, y: 0 }, null),
    ).toBeNull();
  });

  it("getPrimitiveDropTargetForPoint resolves a before/after flow-insert anchor for a drop inside an auto-layout screen frame", () => {
    const target = getPrimitiveDropTargetForPoint(
      { x: 375, y: 135 },
      null,
      [flexScreen],
      identityFrameGeometry,
      identityMetadata,
    );
    expect(target?.nodeId).toBe("parent");
    expect(target?.anchorNodeId).toBe("first");
    expect(target?.placement).toBe("after");
    expect(target?.axis).toBe("x");
    expect(target?.boardRect.width).toBeCloseTo(50);
  });

  it("falls back to an eligible ancestor when the dragged layer is too large", () => {
    const source = {
      id: "source",
      filename: "source.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="moving" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:100px;height:80px"></div>
      </body></html>`,
    };
    const target = {
      id: "target",
      filename: "target.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="outer" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:500px;height:400px">
          <div data-agent-native-node-id="too-small" data-an-primitive="frame" style="position:absolute;left:20px;top:20px;width:100px;height:70px"></div>
        </div>
      </body></html>`,
    };

    expect(
      getPrimitiveDropTargetForPoint(
        { x: 70, y: 50 },
        "moving",
        [source, target],
        {
          source: { x: 0, y: 0, width: 800, height: 600 },
          target: { x: 0, y: 0, width: 800, height: 600 },
        },
        () => ({ width: 800, height: 600 }),
      ),
    ).toMatchObject({ nodeId: "outer" });
  });

  it("resolves the same auto-layout anchor/placement when the screen frame itself is rotated", () => {
    const rotation = 90;
    const frameGeometry = { x: 0, y: 0, width: 800, height: 600, rotation };
    const center = {
      x: frameGeometry.x + frameGeometry.width / 2,
      y: frameGeometry.y + frameGeometry.height / 2,
    };
    const worldPoint = rotatePoint({ x: 375, y: 135 }, center, rotation);
    const target = getPrimitiveDropTargetForPoint(
      worldPoint,
      null,
      [flexScreen],
      { screen: frameGeometry },
      identityMetadata,
    );
    expect(target?.nodeId).toBe("parent");
    expect(target?.anchorNodeId).toBe("first");
    expect(target?.placement).toBe("after");
    expect(target?.axis).toBe("x");
  });

  it("getPrimitiveDropTargetForPoint falls back to 'inside' (no placement) for a plain non-auto-layout frame", () => {
    const plainScreen = {
      id: "plain",
      filename: "plain.html",
      content: `<!doctype html><html><body>
        <div data-agent-native-node-id="frame" data-an-primitive="frame" style="position:absolute;left:0px;top:0px;width:400px;height:300px"></div>
      </body></html>`,
    };
    const target = getPrimitiveDropTargetForPoint(
      { x: 200, y: 150 },
      null,
      [plainScreen],
      { plain: { x: 0, y: 0, width: 800, height: 600 } },
      () => ({ width: 800, height: 600 }),
    );
    expect(target?.nodeId).toBe("frame");
    expect(target?.placement).toBeUndefined();
    expect(target?.anchorNodeId).toBeUndefined();
  });

  it("falls back to the authored document body for blank Screen canvas space", () => {
    const screen = {
      id: "screen",
      filename: "screen.html",
      content: `<!doctype html><html data-agent-native-node-id="html"><body data-agent-native-node-id="body">
        <div data-agent-native-node-id="title" style="position:absolute;left:40px;top:40px;width:340px">Title</div>
      </body></html>`,
    };

    const target = getPrimitiveDropTargetForPoint(
      { x: 700, y: 500 },
      null,
      [screen],
      { screen: { x: 0, y: 0, width: 800, height: 600 } },
      () => ({ width: 800, height: 600 }),
    );

    expect(target?.nodeId).toBe("body");
    expect(target?.targetIdentity?.authoredNodeId).toBe("body");
    expect(target?.targetIdentity?.nodeId).toMatch(/^html:/);
  });

  it("resolves projection ids used by canvas selection for primitive drags", () => {
    const source = {
      id: "source",
      filename: "source.html",
      content: `<!doctype html><html data-agent-native-node-id="source-html"><body data-agent-native-node-id="source-body">
        <div data-agent-native-node-id="moving" data-an-primitive="rectangle" style="position:absolute;left:40px;top:40px;width:80px;height:60px"></div>
      </body></html>`,
    };
    const target = {
      id: "target",
      filename: "target.html",
      content: `<!doctype html><html data-agent-native-node-id="target-html"><body data-agent-native-node-id="target-body"></body></html>`,
    };
    const moving = parsePrimitivesFromScreen(source).find(
      (primitive) => primitive.nodeId === "moving",
    );
    const projectionNodeId = moving?.projectionIdentity?.nodeId;
    expect(projectionNodeId).toMatch(/^html:/);

    expect(resolveNodeScreenId(projectionNodeId!, [source, target])).toBe(
      "source",
    );
    expect(
      getPrimitiveDropTargetForPoint(
        { x: 500, y: 300 },
        projectionNodeId!,
        [source, target],
        {
          source: { x: 0, y: 0, width: 800, height: 600 },
          target: { x: 400, y: 0, width: 800, height: 600 },
        },
        () => ({ width: 800, height: 600 }),
      )?.nodeId,
    ).toBe("target-body");
  });
});
