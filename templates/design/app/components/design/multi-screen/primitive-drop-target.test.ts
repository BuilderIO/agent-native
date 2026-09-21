// @vitest-environment happy-dom

import { rotatePoint } from "@shared/canvas-math";
import { beforeEach, describe, expect, it } from "vitest";

import {
  __clearPrimitiveParseCachesForTests,
  findAutoLayoutInsertionAnchor,
  getPrimitiveLowZoomHitRect,
  getPrimitiveDropTargetForPoint,
  parsePrimitivesFromScreen,
  resolveNodeScreenId,
} from "./primitive-drop-target";

beforeEach(() => __clearPrimitiveParseCachesForTests());

describe("primitive drop target authored layout fallback", () => {
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
});

describe("auto-layout drop insertion anchor (WORK ITEM 1)", () => {
  // A flex row with two children: "first" spans local x:[320,370], "second"
  // spans local x:[380,440] (20px left padding + 10px gap, matching the
  // "accounts for padding, gap, and preceding siblings" fixture above).
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
  // 1:1 scale (frame geometry matches the metadata's own 800x600 content
  // size), so board coords equal the authored local absolute-pixel coords
  // directly — same convention the "accounts for padding" fixture above uses.
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
    // Plain rectangle children are never themselves auto-layout containers.
    expect(first?.autoLayoutAxis).toBeUndefined();
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
    ).toBe("x");
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
    // x=310 sits in the container's own left padding (content starts at 320),
    // well left of "first"'s center (345) and far from "second"'s (410).
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
    });
  });

  it("findAutoLayoutInsertionAnchor resolves 'after' the nearest child when the point sits in the gap between children", () => {
    const primitives = parsePrimitivesFromScreen(flexScreen);
    const parent = primitives.find((p) => p.nodeId === "parent")!;
    // x=375 sits in the 10px gap between "first" (ends at 370) and "second"
    // (starts at 380) — nearer to "first"'s center (345) than "second"'s (410).
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
    });
  });

  it("findAutoLayoutInsertionAnchor excludes the dragged node itself (reordering within its own container)", () => {
    const primitives = parsePrimitivesFromScreen(flexScreen);
    const parent = primitives.find((p) => p.nodeId === "parent")!;
    // Excluding "first" (e.g. it's the node being dragged) leaves "second" as
    // the only candidate regardless of which side of it the point falls on.
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
    // Board coords equal screen-local coords here (frame geometry matches the
    // authored absolute offsets 1:1, viewport 800x600 wider than the frame's
    // own 500x300 box — only the frame's own x/y/width/height matter for the
    // 1:1 scale, matching the existing "accounts for padding" fixture).
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
    // The rendered insertion-line rect should track the ANCHOR child's board
    // rect (matching getCrossScreenDropGuideStyle's contract), not the whole
    // container's rect.
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
    // Adjacent coordinate-transform check (item 6): getPrimitiveDropTargetForPoint
    // must map the incoming board-space point back into the screen's own
    // LOCAL space (via boardPointToScreenLocalPoint, rotation-aware) before
    // resolving the auto-layout anchor — otherwise a rotated screen frame
    // would resolve the wrong sibling/placement even though the unrotated
    // case (the "gap between children" test above) works.
    const rotation = 90;
    const frameGeometry = { x: 0, y: 0, width: 800, height: 600, rotation };
    const center = {
      x: frameGeometry.x + frameGeometry.width / 2,
      y: frameGeometry.y + frameGeometry.height / 2,
    };
    // Same local drop point as the "gap between children" test (375, 135),
    // mapped into board/world space through the frame's own rotation.
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
