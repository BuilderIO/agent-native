// @vitest-environment happy-dom

import { rotatePoint } from "@shared/canvas-math";
import { beforeEach, describe, expect, it } from "vitest";

import {
  __clearPrimitiveParseCachesForTests,
  findAutoLayoutInsertionAnchor,
  getPrimitiveLowZoomHitRect,
  getPrimitiveDropTargetForPoint,
  parsePrimitivesFromScreen,
} from "./primitive-drop-target";

beforeEach(() => __clearPrimitiveParseCachesForTests());

describe("primitive drop target authored layout fallback", () => {
  it("accumulates nested absolute coordinates for frame targets", () => {
    const screen = {
      id: "screen",
      filename: "screen.html",
      content: `<!doctype html><html><body>
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
    expect(anchor).toEqual({ anchorNodeId: "first", placement: "before" });
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
    expect(anchor).toEqual({ anchorNodeId: "first", placement: "after" });
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
    expect(anchor).toEqual({ anchorNodeId: "second", placement: "before" });
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
});
